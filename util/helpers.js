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
translate.engine = "google";

// Africa is talking
const credentials = {
  apiKey: process.env.AFRICASTALKING_TOKEN,
  username: process.env.AFRICASTALKING_USERNAME,
};

const sms = Africastalking(credentials).SMS;

export async function wordTranslate(word) {
  const text = await translate(word, "sw");

  return text;
}

// insert user into DB
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

// get Doctor types
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
    console.error("Error getting  Doctors:", e);
  }
}

// Get Doctors from DB
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

//get Doctots name
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

// Get Doctors from DB
export async function getDoctorDetails(name) {
  try {
    const doctorsArray = [];
    const doc = await doctor.findOne({
      attributes: ["name", "contact_info", "location", "email", "address"],
      where: { name: name },
    });
    // doctors.forEach((doctor) => {
    //   doctorsArray.push({ doctor_id: doctor.doctor_id, name: doctor.name });
    // });
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

//get Doctor by ID
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

// Record appointment in DB
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

// convert 12hrs to 24hrs
export function convertTo24Hour(time12h) {
  const [time, modifier] = time12h.split(" ");
  let [hours, minutes] = time.split(":");

  // Ensure hours is treated as a string
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

//Get User By PhoneNumber
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
