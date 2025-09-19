// ====================== UPDATED HELPERS.JS ====================== //

import * as dotenv from "dotenv";
dotenv.config();
import {
  user,
  appointment,
  doctor,
  teleappointment,
  googleappointment,
} from "../db/db.js";
import Africastalking from "africastalking";
import { Op } from "sequelize";
import translate from "translate";
import OpenAI from "openai"; // Add this import

translate.engine = "google";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Africa is talking
const credentials = {
  apiKey: process.env.AFRICASTALKING_TOKEN,
  username: process.env.AFRICASTALKING_USERNAME,
};

const sms = Africastalking(credentials).SMS;

// ====================== NEW AI FUNCTIONS ====================== //

/**
 * Analyze symptoms using OpenAI GPT-4o-mini
 * @param {string} symptoms - User's symptom description
 * @param {string} language - User's preferred language ('English' or 'Kiswahili')
 * @param {string} userAge - User's age for context
 * @param {string} userLocation - User's location
 * @returns {Object} AI analysis result
 */
export async function analyzeSymptoms(symptoms, language = 'English', userAge = null, userLocation = null) {
  try {
    // Get available doctor types for recommendation
    const availableSpecialists = await getDoctorType();
    const uniqueSpecialists = [...new Set(availableSpecialists)];

    const systemPrompt = `You are a medical triage AI assistant for a USSD-based healthcare system in Kenya. 
    
Your task is to analyze symptoms and provide:
1. Urgency level (Emergency, Urgent, Routine, Self-care)
2. Recommended specialist from available options
3. Brief explanation in the user's language
4. Warning flags if immediate medical attention is needed

Available specialists: ${uniqueSpecialists.join(', ')}

CRITICAL SAFETY RULES:
- Always err on the side of caution
- For chest pain, difficulty breathing, severe bleeding, loss of consciousness, or stroke symptoms: classify as "Emergency"
- Never provide specific medical diagnosis
- Always recommend consulting healthcare professionals
- If unsure, escalate urgency level

Response format (JSON):
{
  "urgency": "Emergency|Urgent|Routine|Self-care",
  "specialist": "recommended specialist from available list",
  "summary": "brief explanation in requested language",
  "emergency_flag": true/false,
  "confidence": 0.1-1.0
}`;

    const userPrompt = `Analyze these symptoms:
Symptoms: "${symptoms}"
Patient age: ${userAge || 'Not provided'}
Location: ${userLocation || 'Kenya'}
Language: ${language}

Provide analysis in ${language === 'Kiswahili' ? 'Kiswahili' : 'English'}.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3, // Lower temperature for more consistent medical advice
      max_tokens: 500,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0].message.content);
    
    // Validate and sanitize the response
    const validUrgencies = ['Emergency', 'Urgent', 'Routine', 'Self-care'];
    if (!validUrgencies.includes(result.urgency)) {
      result.urgency = 'Urgent'; // Default to urgent if invalid
    }

    // Ensure recommended specialist exists in our system
    if (!uniqueSpecialists.includes(result.specialist)) {
      result.specialist = uniqueSpecialists[0] || 'General Practitioner';
    }

    return result;

  } catch (error) {
    console.error('Error analyzing symptoms:', error);
    // Fallback response in case of AI failure
    return {
      urgency: 'Urgent',
      specialist: 'General Practitioner',
      summary: language === 'Kiswahili' 
        ? 'Tumeshindwa kuchambua dalili zako. Tafadhali tembelea daktari.'
        : 'Unable to analyze symptoms. Please consult a doctor.',
      emergency_flag: false,
      confidence: 0.1
    };
  }
}

/**
 * Get smart appointment recommendations based on urgency and availability
 * @param {string} urgency - Urgency level from AI analysis
 * @param {number} doctorId - Selected doctor ID
 * @param {string} date - Requested date
 * @param {string} language - User language
 * @returns {Array} Recommended time slots
 */
export async function getSmartAppointmentSlots(urgency, doctorId, date, language = 'English') {
  try {
    const existingAppointments = await getGoogleAppointments(date, doctorId);
    const bookedSlots = existingAppointments.map(apt => apt.start_time);

    const allSlots = [
      "09:00", "10:00", "11:00", "13:00", "14:00", "15:00"
    ];

    const availableSlots = allSlots.filter(slot => 
      !bookedSlots.includes(slot + ":00")
    );

    // Prioritize slots based on urgency
    let prioritizedSlots;
    if (urgency === 'Emergency') {
      // For emergencies, show earliest available slots first
      prioritizedSlots = availableSlots.slice(0, 2);
    } else if (urgency === 'Urgent') {
      // For urgent cases, show morning and early afternoon slots
      prioritizedSlots = availableSlots.filter(slot => 
        ['09:00', '10:00', '13:00', '14:00'].includes(slot)
      );
    } else {
      // For routine cases, show all available slots
      prioritizedSlots = availableSlots;
    }

    // Format slots based on language
    return prioritizedSlots.map(slot => {
      const hour = parseInt(slot.split(':')[0]);
      if (language === 'Kiswahili') {
        const period = hour < 12 ? 'Asubuhi' : 'Mchana';
        const displayHour = hour > 12 ? hour - 12 : hour;
        return `${displayHour.toString().padStart(2, '0')}:00 ${period}`;
      } else {
        const period = hour < 12 ? 'AM' : 'PM';
        const displayHour = hour > 12 ? hour - 12 : hour;
        return `${displayHour.toString().padStart(2, '0')}:00 ${period}`;
      }
    });

  } catch (error) {
    console.error('Error getting smart appointment slots:', error);
    // Return default slots on error
    return language === 'Kiswahili' 
      ? ["09:00 Asubuhi", "10:00 Asubuhi", "13:00 Mchana"]
      : ["09:00 AM", "10:00 AM", "01:00 PM"];
  }
}

/**
 * Generate follow-up message based on urgency and appointment details
 * @param {Object} appointmentDetails - Appointment information
 * @param {string} urgency - Urgency level
 * @param {string} language - User language
 * @returns {string} Follow-up message
 */
export async function generateFollowUpMessage(appointmentDetails, urgency, language = 'English') {
  try {
    const { doctorName, date, time, patientName } = appointmentDetails;

    let baseMessage;
    if (language === 'Kiswahili') {
      baseMessage = `Hujambo ${patientName}, miadi yako na ${doctorName} tarehe ${date} saa ${time} imepangwa.`;
    } else {
      baseMessage = `Hello ${patientName}, your appointment with ${doctorName} on ${date} at ${time} is confirmed.`;
    }

    // Add urgency-specific advice
    let urgencyAdvice = '';
    if (urgency === 'Emergency') {
      urgencyAdvice = language === 'Kiswahili'
        ? ' MUHIMU: Hii ni hali ya haraka. Ikiwa dalili zitaongezeka, nenda hospitali mara moja.'
        : ' IMPORTANT: This is urgent. If symptoms worsen, go to emergency room immediately.';
    } else if (urgency === 'Urgent') {
      urgencyAdvice = language === 'Kiswahili'
        ? ' Tafadhali usiache miadi hii. Wasiliana na daktari ikiwa dalili zitabadilika.'
        : ' Please do not miss this appointment. Contact doctor if symptoms change.';
    }

    return baseMessage + urgencyAdvice;

  } catch (error) {
    console.error('Error generating follow-up message:', error);
    return appointmentDetails.patientName 
      ? `Hello ${appointmentDetails.patientName}, your appointment is confirmed.`
      : 'Your appointment is confirmed.';
  }
}

// ====================== EXISTING FUNCTIONS (unchanged) ====================== //

export async function wordTranslate(word) {
  const text = await translate(word, "sw");
  return text;
}

export async function insertUser(name, age, phoneNumber, location) {
  const newUser = {
    name: name,
    age: age,
    phone_number: phoneNumber,
    location: location,
  };
  try {
    await user.create(newUser);
  } catch (e) {
    console.error("Error inserting data:", e);
  }
}

export async function getDoctorType() {
  try {
    const doctorsArray = [];
    const doctors = await doctor.findAll({
      attributes: ["type"],
    });
   
    doctors.forEach((doctor) => {
      doctorsArray.push(doctor.type);
    });
    return doctorsArray;
  } catch (e) {
    console.error("Error getting Doctors:", e);
  }
}

export async function getDoctors() {
  try {
    const doctorsArray = [];
    const doctors = await doctor.findAll({
      attributes: ["doctor_id", "name"],
    });
    doctors.forEach((doctor) => {
      doctorsArray.push({ doctor_id: doctor.doctor_id, name: doctor.name });
    });
    return doctorsArray;
  } catch (error) {
    console.log(error);
  }
}

export async function getDoctorsNames(type, location) {
  try {
    const doctorsArray = [];
    const doctors = await doctor.findAll({
      attributes: ["name"],
      where: { type: type, location: location },
    });

    doctors.forEach((doctor) => {
      doctorsArray.push(doctor.name);
    });
    return doctorsArray;
  } catch (e) {
    console.error("Error getting user ID:", e);
  }
}

export async function getDoctorDetails(name) {
  try {
    const doc = await doctor.findOne({
      attributes: ["name", "contact_info", "location", "email", "address"],
      where: { name: name },
    });
    return {
      contact: doc.contact_info,
      location: doc.location,
      email: doc.email,
      address: doc.address,
    };
  } catch (error) {
    console.log(error);
  }
}

export async function getDoctorId(name) {
  try {
    const doc = await doctor.findOne({
      attributes: ["doctor_id"],
      where: { name: name },
    });
    return doc.doctor_id;
  } catch (e) {
    console.error("Error getting user ID:", e);
  }
}

export async function recordAppointment(userId, doctorId, date, time) {
  try {
    await appointment.create({
      user_id: userId,
      doctor_id: doctorId,
      date: date,
      time: time,
      status: "Scheduled",
    });
  } catch (e) {
    console.error("Error inserting data:", e);
  }
}

export async function recordTeleppointment(userId, doctorId, date, time) {
  try {
    await teleappointment.create({
      user_id: userId,
      doctor_id: doctorId,
      date: date,
      time: time,
      status: "Scheduled",
    });
  } catch (e) {
    console.error("Error inserting data:", e);
  }
}

export async function sendSms(phoneNumber, message) {
  const options = {
    to: [phoneNumber],
    message: message,
  };
  console.log(options);
  async function sendSMS() {
    try {
      const result = await sms.send(options);
      console.log(result);
    } catch (err) {
      console.error(err);
    }
  }
  sendSMS();
}

export function convertTo24Hour(time12h) {
  const [time, modifier] = time12h.split(" ");
  let [hours, minutes] = time.split(":");

  hours = hours === "12" ? "00" : hours;

  if (modifier === "PM" && hours !== "12") {
    hours = String(parseInt(hours, 10) + 12);
  }

  return `${hours.padStart(2, "0")}:${minutes}`;
}

export async function getGoogleAppointments(date, doctorId) {
  try {
    const appointments = await googleappointment.findAll({
      where: {
        date: {
          [Op.eq]: date,
        },
        doctor_id: doctorId,
      },
    });

    return appointments;
  } catch (e) {
    console.error("Error inserting data:", e);
  }
}

export async function checkUserExist(phone_number) {
  try {
    const User = await user.findOne({
      attributes: ["user_id"],
      where: { phone_number: phone_number },
    });
    return User.user_id;
  } catch (e) {
    console.error("Error getting user ID:", e);
  }
}