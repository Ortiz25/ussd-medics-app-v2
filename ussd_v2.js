import * as dotenv from "dotenv";
dotenv.config();
import express from "express";
import bodyParser from "body-parser";
import UssdMenu from "ussd-builder";
import {
  getDoctorType,
  getDoctors,
  getDoctorsNames,
  getDoctorDetails,
  getDoctorId,
  getGoogleAppointments,
  convertTo24Hour,
  checkUserExist,
  wordTranslate,
  recordAppointment,
  recordTeleppointment,
  sendSms,
  insertUser,
  analyzeSymptoms,getSmartAppointmentSlots,generateFollowUpMessage

} from "./util/helpers.js";
import { getOAuthToken } from "./mpesa/mpesa.js";

const app = express();
const menu = new UssdMenu();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Sessions
let sessions = {};
let specialist;
let specialistNumber;
let doctorNumber;
let language;
let timeSlotsString = "";

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Application error:", err);
  res.status(500).send("Internal Server Error");
});

menu.sessionConfig({
  start: (sessionId, callback) => {
    // initialize current session if it doesn't exist
    // this is called by menu.run()
    if (!(sessionId in sessions)) sessions[sessionId] = {};
    callback();
  },
  end: (sessionId, callback) => {
    // clear current session
    // this is called by menu.end()
    delete sessions[sessionId];
    callback();
  },
  set: (sessionId, key, value, callback) => {
    // store key-value pair in current session
    sessions[sessionId][key] = value;
    callback();
  },
  get: (sessionId, key, callback) => {
    // retrieve value by key in current session
    let value = sessions[sessionId][key];
    callback(null, value);
  },
});

/////////////////////////// GET METHODS ////////////////////////////////////

app.get("/", async function (req, res) {
  try {
    // const token = await getOAuthToken();
    // console.log(token);
    res.send("USSD Service is running");
  } catch (error) {
    console.error("Error in root endpoint:", error);
    res.status(500).send("Service Error");
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

////////////////////////// POST METHODS ///////////////////////////////////

// ====================== UPDATED USSD POST METHOD ====================== //

app.post("/ussd", async function (req, res) {
  try {
    // Read the variables sent via POST from our API
    const { sessionId, serviceCode, phoneNumber, text } = req.body;

    if (!sessionId || !phoneNumber) {
      return res.status(400).send("Missing required parameters");
    }

    const capitalize = (s) => (s && s[0].toUpperCase() + s.slice(1)) || "";

    // ====================== MENU STATES ====================== //

    // Start state
    menu.startState({
      run: () => {
        menu.con(
          `Welcome/ Karibu:
            1. English
            2. Kiswahili
            0. Exit / Ondoka`
        );
      },
      next: {
        0: "Exit",
        1: "Start",
        2: "Start",
      },
    });

    // Language selection and name entry
    menu.state("Start", {
      run: async () => {
        let lang = +menu.val;
        if (lang === 1) {
          await menu.session.set("lang", "English");
        }
        if (lang === 2) {
          await menu.session.set("lang", "Kiswahili");
        }

        menu.con(`${lang == 1 ? "Enter your Name:" : "Weka Jina Lako:"}`);
      },
      next: {
        "*[a-zA-Z ]+": "registration.name",
      },
    });

    // Registration states
    menu.state("registration.name", {
      run: async () => {
        let name = menu.val.trim();
        const language = await menu.session.get("lang");

        await menu.session.set("name", name);
        menu.con(
          `${language === "English" ? "Enter your Age:" : "Weka Umri Wako:"}`
        );
      },
      next: {
        "*^[1-9]$|^[1-9][0-9]$|^(100)$": "registration.age",
      },
    });

    menu.state("registration.age", {
      run: async () => {
        let age = menu.val;
        const language = await menu.session.get("lang");
        await menu.session.set("age", age);
        menu.con(
          `${
            language === "English"
              ? "Enter your Phone number (0722XXX XXX):"
              : "Weka Nambari Yako ya Simu (0722XXX XXX):"
          }`
        );
      },
      next: {
        "*^(\\+254|0)7\\d{8}$": "registration.number",
      },
    });

    menu.state("registration.number", {
      run: async () => {
        let number = menu.val;
        const language = await menu.session.get("lang");
        await menu.session.set("number", number);
        menu.con(
          `${
            language === "English"
              ? "Enter your Location/Town (e.g Nairobi):"
              : "Weka Mahali Ulipo/Mji (mfano Nairobi):"
          }`
        );
      },
      next: {
        "*[a-zA-Z ]+": "registration.location",
      },
    });

    // Updated location state with service options
    menu.state("registration.location", {
      run: async () => {
        let location = menu.val.toLowerCase().trim();
        const language = await menu.session.get("lang");
        await menu.session.set("location", capitalize(location));
        
        menu.con(
          `${
            language === "English"
              ? `Choose preferred Service:
                    1. AI Symptom Assessment (Recommended)
                    2. Browse Specialists
                    3. Book Appointment Directly`
              : `Chagua Huduma Unayopendelea:
                    1. Uchunguzi wa Dalili kwa AI (Inashauriwa)
                    2. Angalia Wataalamu
                    3. Panga Miadi Moja kwa Moja`
          }`
        );
      },
      next: {
        1: "ai.symptom.assessment",
        2: "Specialist",
        3: "Appointment",
      },
    });

    // ====================== AI SYMPTOM ASSESSMENT FLOW ====================== //
    
    menu.state("ai.symptom.assessment", {
      run: async () => {
        const language = await menu.session.get("lang");
        menu.con(
          language === "English"
            ? `AI Health Assistant will analyze your symptoms and recommend the best specialist.

Please describe your symptoms in detail:

Type your symptoms or '0' to go back:`
            : `Msaidizi wa Kiafya wa AI atachambua dalili zako na kupendekeza mtaalamu bora.

Tafadhali eleza dalili zako kwa undani:

Andika dalili zako au '0' kurudi nyuma:`
        );
      },
      next: {
        0: "registration.location",
        "*": "ai.process.symptoms",
      },
    });

    menu.state("ai.process.symptoms", {
      run: async () => {
        try {
          const symptoms = menu.val;
          const language = await menu.session.get("lang");
          
          if (symptoms.length < 5) {
            return menu.con(
              language === "English"
                ? "Please provide more detailed symptoms (at least 5 characters):"
                : "Tafadhali toa maelezo zaidi ya dalili (angalau herufi 5):"
            );
          }
          
          await menu.session.set("symptoms", symptoms);
          
          menu.con(
            language === "English"
              ? "Analyzing your symptoms with AI... Please wait.\n\nPress any key to continue:"
              : "Inachambua dalili zako kwa AI... Tafadhali subiri.\n\nBofya kibonye yoyote kuendelea:"
          );

        } catch (error) {
          console.error("Error in symptom processing:", error);
          const language = await menu.session.get("lang");
          menu.end(
            language === "English"
              ? "Sorry, we encountered an error. Please try again later."
              : "Samahani, tumekumbana na hitilafu. Tafadhali jaribu tena baadaye."
          );
        }
      },
      next: {
        "*": "ai.show.assessment",
      },
    });

    menu.state("ai.show.assessment", {
      run: async () => {
        try {
          const symptoms = await menu.session.get("symptoms");
          const language = await menu.session.get("lang");
          const age = await menu.session.get("age");
          const location = await menu.session.get("location");

          // Call AI analysis
          const aiAssessment = await analyzeSymptoms(symptoms, language, age, location);
          
          // Store AI results in session
          await menu.session.set("ai_assessment", aiAssessment);
          await menu.session.set("recommended_specialist", aiAssessment.specialist);
          await menu.session.set("urgency_level", aiAssessment.urgency);

          // Create urgency indicator
          let urgencyIndicator = "";
          if (aiAssessment.urgency === "Emergency") {
            urgencyIndicator = language === "English" ? "EMERGENCY" : "DHARURA";
          } else if (aiAssessment.urgency === "Urgent") {
            urgencyIndicator = language === "English" ? "URGENT" : "HARAKA";
          } else if (aiAssessment.urgency === "Routine") {
            urgencyIndicator = language === "English" ? "ROUTINE" : "KAWAIDA";
          } else {
            urgencyIndicator = language === "English" ? "SELF-CARE" : "MATIBABU NYUMBANI";
          }

          const assessmentMessage = language === "English"
            ? `${urgencyIndicator}

AI Assessment: ${aiAssessment.summary}

Recommended: ${aiAssessment.specialist}

What would you like to do?
1. Book with recommended specialist
2. Choose different specialist  
3. Get specialist details
0. Go back`
            : `${urgencyIndicator}

Uchunguzi wa AI: ${aiAssessment.summary}

Anapendekeza: ${aiAssessment.specialist}

Ungependa kufanya nini?
1. Panga na mtaalamu aliyependekezwa
2. Chagua mtaalamu mwingine
3. Pata maelezo ya mtaalamu
0. Rudi nyuma`;

          menu.con(assessmentMessage);

        } catch (error) {
          console.error("Error showing AI assessment:", error);
          const language = await menu.session.get("lang");
          menu.end(
            language === "English"
              ? "Sorry, we encountered an error during analysis. Please try again later."
              : "Samahani, tumekumbana na hitilafu wakati wa uchunguzi. Tafadhali jaribu tena baadaye."
          );
        }
      },
      next: {
        0: "ai.symptom.assessment",
        1: "ai.book.recommended",
        2: "Specialist",
        3: "ai.specialist.details",
      },
    });

    // AI booking with recommended specialist
    menu.state("ai.book.recommended", {
      run: async () => {
        try {
          const language = await menu.session.get("lang");
          const recommendedSpecialist = await menu.session.get("recommended_specialist");
          const location = await menu.session.get("location");
          
          // Get doctors of recommended type in user's location
          const docNames = await getDoctorsNames(recommendedSpecialist, location);
          
          if (!docNames || docNames.length === 0) {
            return menu.con(
              language === "English"
                ? `No ${recommendedSpecialist} available in ${location}.
1. Change location
2. Choose different specialist
0. Go back`
                : `Hakuna ${recommendedSpecialist} katika ${location}.
1. Badilisha mahali
2. Chagua mtaalamu mwingine
0. Rudi nyuma`
            );
          }

          await menu.session.set("docNamesArray", docNames);
          
          let doctorsList = "";
          docNames.forEach((doctorName, index) => {
            doctorsList += `\n${index + 1}. ${doctorName}`;
          });

          menu.con(
            language === "English"
              ? `Available ${recommendedSpecialist}s in ${location}:${doctorsList}

Select a doctor:`
              : `${recommendedSpecialist} waliopo katika ${location}:${doctorsList}

Chagua daktari:`
          );

        } catch (error) {
          console.error("Error in ai.book.recommended:", error);
          const language = await menu.session.get("lang");
          menu.con(
            language === "English"
              ? "Error loading doctors. Press 0 to go back."
              : "Hitilafu katika kupakia madaktari. Bofya 0 kurudi."
          );
        }
      },
      next: {
        0: "ai.show.assessment",
        1: "ai.select.appointment.type", 
        2: "ai.select.appointment.type",
        3: "ai.select.appointment.type",
        4: "ai.select.appointment.type",
        5: "ai.select.appointment.type",
        6: "ai.select.appointment.type",
        "*": "error.invalid.selection"
      },
    });

    menu.state("ai.select.appointment.type", {
      run: async () => {
        try {
          const docIndex = parseInt(menu.val) - 1;
          const language = await menu.session.get("lang");
          const docNamesArray = await menu.session.get("docNamesArray");
          
          if (!docNamesArray || docIndex < 0 || docIndex >= docNamesArray.length) {
            return menu.con(
              language === "English"
                ? "Invalid selection. Please choose a valid doctor number:"
                : "Uchaguzi si sahihi. Tafadhali chagua nambari sahihi ya daktari:"
            );
          }
          
          const selectedDoctor = docNamesArray[docIndex];
          await menu.session.set("selectedDoctor", selectedDoctor);
          
          menu.con(
            language === "English"
              ? `Selected: Dr. ${selectedDoctor}

Choose appointment type:
1. Physical appointment (In-person)
2. Telehealth appointment (Video call)`
              : `Umechagua: Dk. ${selectedDoctor}

Chagua aina ya miadi:
1. Miadi ya ana kwa ana
2. Miadi ya video (simu ya video)`
          );
        } catch (error) {
          console.error("Error in appointment type selection:", error);
          menu.goto("error.system");
        }
      },
      next: {
        1: "ai.physical.appointment",
        2: "ai.remote.appointment",
      },
    });

    menu.state("ai.physical.appointment", {
      run: async () => {
        await menu.session.set("appointmentType", "physical");
        const language = await menu.session.get("lang");
        
        menu.con(
          language === "English"
            ? "Enter appointment date (YYYY-MM-DD):"
            : "Ingiza tarehe ya miadi (YYYY-MM-DD):"
        );
      },
      next: {
        "*\\d{4}-\\d{2}-\\d{2}": "ai.smart.scheduling",
        "*": "date.validation.error"
      },
    });

    menu.state("ai.remote.appointment", {
      run: async () => {
        await menu.session.set("appointmentType", "remote");
        const language = await menu.session.get("lang");
        
        menu.con(
          language === "English"
            ? "Enter appointment date (YYYY-MM-DD):"
            : "Ingiza tarehe ya miadi (YYYY-MM-DD):"
        );
      },
      next: {
        "*\\d{4}-\\d{2}-\\d{2}": "ai.smart.scheduling",
        "*": "date.validation.error"
      },
    });

    // AI Smart scheduling
    menu.state("ai.smart.scheduling", {
      run: async () => {
        try {
          const date = menu.val;
          const language = await menu.session.get("lang");
          const urgencyLevel = await menu.session.get("urgency_level");
          const selectedDoctor = await menu.session.get("selectedDoctor");
          
          // Validate date
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(date)) {
            return menu.con(
              language === "English"
                ? "Invalid date format. Please use YYYY-MM-DD:"
                : "Muundo wa tarehe si sahihi. Tafadhali tumia YYYY-MM-DD:"
            );
          }

          const dateObj = new Date(date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          if (isNaN(dateObj.getTime()) || dateObj < today) {
            return menu.con(
              language === "English"
                ? "Invalid date. Please enter a future date (YYYY-MM-DD):"
                : "Tarehe si sahihi. Tafadhali weka tarehe ya baadaye (YYYY-MM-DD):"
            );
          }

          await menu.session.set("selectedDate", date);
          
          const doctorId = await getDoctorId(selectedDoctor);
          
          // Get AI-recommended time slots based on urgency
          const smartSlots = await getSmartAppointmentSlots(urgencyLevel, doctorId, date, language);
          
          if (smartSlots.length === 0) {
            return menu.con(
              language === "English"
                ? `No available slots on ${date}. Please try a different date:`
                : `Hakuna nafasi tarehe ${date}. Tafadhali jaribu tarehe nyingine:`
            );
          }

          await menu.session.set("smartSlots", smartSlots);
          
          let slotsDisplay = "";
          smartSlots.forEach((slot, index) => {
            slotsDisplay += `\n${index + 1}. ${slot}`;
          });

          const urgencyNote = urgencyLevel === "Emergency" 
            ? (language === "English" ? "\nPRIORITY booking due to urgency" : "\nUhifadhi wa KWANZA kutokana na haraka")
            : "";

          menu.con(
            language === "English"
              ? `AI-recommended time slots for ${date}:${slotsDisplay}${urgencyNote}

Select a time slot:`
              : `Majira yanayopendekezwa na AI kwa ${date}:${slotsDisplay}${urgencyNote}

Chagua wakati:`
          );

        } catch (error) {
          console.error("Error in AI smart scheduling:", error);
          const language = await menu.session.get("lang");
          menu.goto("error.system");
        }
      },
      next: {
        1: "ai.confirm.appointment",
        2: "ai.confirm.appointment", 
        3: "ai.confirm.appointment",
        4: "ai.confirm.appointment",
        5: "ai.confirm.appointment",
        6: "ai.confirm.appointment",
        "*\\d{4}-\\d{2}-\\d{2}": "ai.smart.scheduling",
        "*": "error.invalid.selection"
      },
    });

    menu.state("ai.confirm.appointment", {
      run: async () => {
        try {
          const timeIndex = parseInt(menu.val) - 1;
          const language = await menu.session.get("lang");
          const smartSlots = await menu.session.get("smartSlots");
          const selectedDate = await menu.session.get("selectedDate");
          const selectedDoctor = await menu.session.get("selectedDoctor");
          const appointmentType = await menu.session.get("appointmentType");
          const urgencyLevel = await menu.session.get("urgency_level");
          
          if (!smartSlots || timeIndex < 0 || timeIndex >= smartSlots.length) {
            return menu.con(
              language === "English"
                ? "Invalid selection. Please choose a valid time slot:"
                : "Uchaguzi si sahihi. Tafadhali chagua wakati sahihi:"
            );
          }

          const selectedTime = smartSlots[timeIndex];
          await menu.session.set("selectedTime", selectedTime);

          const appointmentTypeText = appointmentType === "physical" 
            ? (language === "English" ? "In-person" : "Ana kwa ana")
            : (language === "English" ? "Video call" : "Simu ya video");

          const urgencyDisplay = urgencyLevel === "Emergency" ? " (PRIORITY)" : "";

          menu.con(
            language === "English"
              ? `Confirm your appointment${urgencyDisplay}:

Doctor: ${selectedDoctor}
Date: ${selectedDate}
Time: ${selectedTime}
Type: ${appointmentTypeText}

1. Confirm booking
2. Change time
0. Cancel`
              : `Thibitisha miadi yako${urgencyDisplay}:

Daktari: ${selectedDoctor}
Tarehe: ${selectedDate}
Wakati: ${selectedTime}
Aina: ${appointmentTypeText}

1. Thibitisha kupanga
2. Badilisha wakati
0. Ghairi`
          );

        } catch (error) {
          console.error("Error in appointment confirmation:", error);
          menu.goto("error.system");
        }
      },
      next: {
        1: "ai.create.appointment",
        2: "ai.smart.scheduling",
        0: "Exit",
      },
    });

    // AI appointment creation
    menu.state("ai.create.appointment", {
      run: async () => {
        try {
          const appointmentType = await menu.session.get("appointmentType");
          const selectedDate = await menu.session.get("selectedDate");
          const selectedTime = await menu.session.get("selectedTime");
          const selectedDoctor = await menu.session.get("selectedDoctor");
          const urgencyLevel = await menu.session.get("urgency_level");
          const age = await menu.session.get("age");
          const name = await menu.session.get("name");
          const number = await menu.session.get("number");
          const location = await menu.session.get("location");
          const language = await menu.session.get("lang");

          // Convert time format for storage
          const timeFor24h = convertTo24Hour(selectedTime);
          const doctorId = await getDoctorId(selectedDoctor);

          // Insert user if they don't exist
          await insertUser(name, age, number, location);

          // Get user ID
          const userId = await checkUserExist(number);

          // Record appointment based on type
          if (appointmentType === "physical") {
            await recordAppointment(userId, doctorId, selectedDate, timeFor24h);
          } else {
            await recordTeleppointment(userId, doctorId, selectedDate, timeFor24h);
          }

          // Generate AI-enhanced follow-up message
          const followUpMessage = await generateFollowUpMessage({
            doctorName: selectedDoctor,
            date: selectedDate,
            time: selectedTime,
            patientName: name
          }, urgencyLevel, language);

          // Send confirmation SMS
          await sendSms(phoneNumber, followUpMessage);

          // Success message
          let successMessage = language === "English"
            ? `Appointment successfully booked!

Your ${appointmentType} appointment with Dr. ${selectedDoctor} is confirmed for ${selectedDate} at ${selectedTime}.

${urgencyLevel === "Emergency" ? "This is marked as PRIORITY due to urgency." : ""}
${urgencyLevel === "Urgent" ? "Please don't miss this urgent appointment." : ""}

A confirmation SMS has been sent to ${phoneNumber}.

Thank you for using our AI-powered health service!`
            : `Miadi imepangwa kwa mafanikio!

Miadi yako ya ${appointmentType === "physical" ? "ana kwa ana" : "video"} na Dk. ${selectedDoctor} imethibitishwa kwa ${selectedDate} saa ${selectedTime}.

${urgencyLevel === "Emergency" ? "Hii imewekwa kama YA KWANZA kutokana na haraka." : ""}
${urgencyLevel === "Urgent" ? "Tafadhali usikose miadi hii ya haraka." : ""}

Ujumbe wa uthibitisho umetumwa ${phoneNumber}.

Asante kwa kutumia huduma yetu ya kiafya iliyoongozwa na AI!`;

          menu.end(successMessage);

        } catch (error) {
          console.error("Error creating AI appointment:", error);
          const language = await menu.session.get("lang");
          menu.end(
            language === "English"
              ? "Sorry, we encountered an error while booking your appointment. Please try again later."
              : "Samahani, tumekumbana na hitilafu wakati wa kupanga miadi yako. Tafadhali jaribu tena baadaye."
          );
        }
      },
    });

    // AI specialist details
    menu.state("ai.specialist.details", {
      run: async () => {
        try {
          const language = await menu.session.get("lang");
          const recommendedSpecialist = await menu.session.get("recommended_specialist");
          const location = await menu.session.get("location");
          
          const docNames = await getDoctorsNames(recommendedSpecialist, location);
          
          if (!docNames || docNames.length === 0) {
            return menu.con(
              language === "English"
                ? `No ${recommendedSpecialist} available in ${location}. Press 0 to go back.`
                : `Hakuna ${recommendedSpecialist} katika ${location}. Bofya 0 kurudi.`
            );
          }

          await menu.session.set("docNamesArray", docNames);
          let doctorsList = "";
          docNames.forEach((doctorName, index) => {
            doctorsList += `\n${index + 1}. ${doctorName}`;
          });

          menu.con(
            language === "English"
              ? `Available ${recommendedSpecialist}s in ${location}:${doctorsList}

Select a doctor to view details:`
              : `${recommendedSpecialist} waliopo katika ${location}:${doctorsList}

Chagua daktari kuona maelezo:`
          );

        } catch (error) {
          console.error("Error in specialist details:", error);
          menu.goto("error.system");
        }
      },
      next: {
        0: "ai.show.assessment",
        1: "show.specialist.details",
        2: "show.specialist.details", 
        3: "show.specialist.details",
        4: "show.specialist.details",
        5: "show.specialist.details",
        6: "show.specialist.details",
        "*": "error.invalid.selection"
      },
    });

    menu.state("show.specialist.details", {
      run: async () => {
        try {
          const docIndex = parseInt(menu.val) - 1;
          const language = await menu.session.get("lang");
          const docNamesArray = await menu.session.get("docNamesArray");
          
          if (!docNamesArray || docIndex < 0 || docIndex >= docNamesArray.length) {
            return menu.con(
              language === "English"
                ? "Invalid selection. Press 0 to go back."
                : "Uchaguzi si sahihi. Bofya 0 kurudi."
            );
          }

          const selectedDoctor = docNamesArray[docIndex];
          const docDetails = await getDoctorDetails(selectedDoctor);

          menu.end(
            language === "English"
              ? `Doctor Details:

Name: Dr. ${selectedDoctor}
Phone: ${docDetails.contact}
Location: ${docDetails.location}
Email: ${docDetails.email}
Address: ${docDetails.address}

To book an appointment, please use our service again.`
              : `Maelezo ya Daktari:

Jina: Dk. ${selectedDoctor}
Simu: ${docDetails.contact}
Mahali: ${docDetails.location}
Barua pepe: ${docDetails.email}
Anwani: ${docDetails.address}

Kupanga miadi, tafadhali tumia huduma yetu tena.`
          );

        } catch (error) {
          console.error("Error showing specialist details:", error);
          const language = await menu.session.get("lang");
          menu.end(
            language === "English"
              ? "Sorry, we encountered an error retrieving doctor details."
              : "Samahani, tumekumbana na hitilafu wakati wa kupata maelezo ya daktari."
          );
        }
      },
    });

    // ====================== TRADITIONAL BOOKING FLOW ====================== //

    // Browse specialists
    menu.state("Specialist", {
      run: async () => {
        try {
          const language = await menu.session.get("lang");
          const doctorTypes = await getDoctorType();
          
          if (!doctorTypes || doctorTypes.length === 0) {
            return menu.con(
              language === "English"
                ? "No specialists available. Press 0 to go back."
                : "Hakuna wataalamu. Bofya 0 kurudi."
            );
          }

          // Remove duplicates
          const uniqueTypes = [...new Set(doctorTypes)];
          await menu.session.set("doctorTypes", uniqueTypes);
          
          let typeList = "";
          uniqueTypes.forEach((type, index) => {
            typeList += `\n${index + 1}. ${type}`;
          });
          
          menu.con(
            language === "English"
              ? `Select Specialist Type:${typeList}`
              : `Chagua Aina ya Mtaalamu:${typeList}`
          );
        } catch (error) {
          console.error("Error loading specialists:", error);
          menu.goto("error.system");
        }
      },
      next: {
        1: "select.specialist.location",
        2: "select.specialist.location",
        3: "select.specialist.location", 
        4: "select.specialist.location",
        5: "select.specialist.location",
        6: "select.specialist.location",
        0: "registration.location",
        "*": "error.invalid.selection"
      },
    });

    menu.state("select.specialist.location", {
      run: async () => {
        try {
          const typeIndex = parseInt(menu.val) - 1;
          const language = await menu.session.get("lang");
          const doctorTypes = await menu.session.get("doctorTypes");
          
          if (!doctorTypes || typeIndex < 0 || typeIndex >= doctorTypes.length) {
            return menu.con(
              language === "English"
                ? "Invalid selection. Press 0 to go back."
                : "Uchaguzi si sahihi. Bofya 0 kurudi."
            );
          }

          const selectedType = doctorTypes[typeIndex];
          await menu.session.set("selectedSpecialistType", selectedType);
          const location = await menu.session.get("location");
          
          const docNames = await getDoctorsNames(selectedType, location);
          
          if (!docNames || docNames.length === 0) {
            return menu.con(
              language === "English"
                ? `No ${selectedType} available in ${location}.
1. Change location
0. Go back`
                : `Hakuna ${selectedType} katika ${location}.
1. Badilisha mahali
0. Rudi nyuma`
            );
          }

          await menu.session.set("docNamesArray", docNames);
          
          let doctorsList = "";
          docNames.forEach((doctorName, index) => {
            doctorsList += `\n${index + 1}. ${doctorName}`;
          });

          menu.con(
            language === "English"
              ? `Available ${selectedType}s in ${location}:${doctorsList}

Select for details or booking:`
              : `${selectedType} waliopo katika ${location}:${doctorsList}

Chagua kwa maelezo au kupanga:`
          );

        } catch (error) {
          console.error("Error selecting specialist:", error);
          menu.goto("error.system");
        }
      },
      next: {
        0: "Specialist",
        1: "doctor.action.menu",
        2: "doctor.action.menu",
        3: "doctor.action.menu", 
        4: "doctor.action.menu",
        5: "doctor.action.menu",
        6: "doctor.action.menu",
        "*": "error.invalid.selection"
      },
    });

    menu.state("doctor.action.menu", {
      run: async () => {
        try {
          const docIndex = parseInt(menu.val) - 1;
          const language = await menu.session.get("lang");
          const docNamesArray = await menu.session.get("docNamesArray");
          
          if (!docNamesArray || docIndex < 0 || docIndex >= docNamesArray.length) {
            return menu.con(
              language === "English"
                ? "Invalid selection. Please choose a valid doctor number:"
                : "Uchaguzi si sahihi. Tafadhali chagua nambari sahihi ya daktari:"
            );
          }

          const selectedDoctor = docNamesArray[docIndex];
          await menu.session.set("selectedDoctor", selectedDoctor);

          menu.con(
            language === "English"
              ? `Selected: Dr. ${selectedDoctor}

What would you like to do?
1. View doctor details
2. Book appointment
0. Go back`
              : `Umechagua: Dk. ${selectedDoctor}

Ungependa kufanya nini?
1. Ona maelezo ya daktari
2. Panga miadi
0. Rudi nyuma`
          );

        } catch (error) {
          console.error("Error in doctor action menu:", error);
          menu.goto("error.system");
        }
      },
      next: {
        0: "select.specialist.location",
        1: "show.doctor.details",
        2: "select.appointment.type",
        "*": "error.invalid.selection"
      },
    });

    menu.state("show.doctor.details", {
      run: async () => {
        try {
          const language = await menu.session.get("lang");
          const selectedDoctor = await menu.session.get("selectedDoctor");
          const docDetails = await getDoctorDetails(selectedDoctor);

          menu.end(
            language === "English"
              ? `Doctor Details:

Name: Dr. ${selectedDoctor}
Phone: ${docDetails.contact}
Location: ${docDetails.location}
Email: ${docDetails.email}
Address: ${docDetails.address}

To book an appointment, please use our service again.`
              : `Maelezo ya Daktari:

Jina: Dk. ${selectedDoctor}
Simu: ${docDetails.contact}
Mahali: ${docDetails.location}
Barua pepe: ${docDetails.email}
Anwani: ${docDetails.address}

Kupanga miadi, tafadhali tumia huduma yetu tena.`
          );

        } catch (error) {
          console.error("Error showing doctor details:", error);
          const language = await menu.session.get("lang");
          menu.end(
            language === "English"
              ? "Sorry, we encountered an error retrieving doctor details."
              : "Samahani, tumekumbana na hitilafu wakati wa kupata maelezo ya daktari."
          );
        }
      },
    });

    menu.state("select.appointment.type", {
      run: async () => {
        const language = await menu.session.get("lang");
        const selectedDoctor = await menu.session.get("selectedDoctor");
        
        menu.con(
          language === "English"
            ? `Book appointment with Dr. ${selectedDoctor}

Choose appointment type:
1. Physical appointment (In-person)
2. Telehealth appointment (Video call)`
            : `Panga miadi na Dk. ${selectedDoctor}

Chagua aina ya miadi:
1. Miadi ya ana kwa ana
2. Miadi ya video (simu ya video)`
        );
      },
      next: {
        1: "physical.appointment",
        2: "remote.appointment",
      },
    });

    // Direct appointment booking
    menu.state("Appointment", {
      run: async () => {
        const language = await menu.session.get("lang");
        menu.con(
          language === "English"
            ? `Select Appointment Type:
1. Physical Appointment
2. Telehealth Appointment`
            : `Chagua Aina ya Miadi:
1. Miadi ya Ana kwa Ana
2. Miadi ya Simu ya Video`
        );
      },
      next: {
        1: "appointment.select.specialist",
        2: "appointment.select.specialist.remote",
      },
    });

    menu.state("appointment.select.specialist", {
      run: async () => {
        await menu.session.set("appointmentType", "physical");
        menu.goto("Specialist");
      },
    });

    menu.state("appointment.select.specialist.remote", {
      run: async () => {
        await menu.session.set("appointmentType", "remote");
        menu.goto("Specialist");
      },
    });

    // Physical appointment booking
    menu.state("physical.appointment", {
      run: async () => {
        await menu.session.set("appointmentType", "physical");
        const language = await menu.session.get("lang");
        
        menu.con(
          language === "English"
            ? "Enter appointment date (YYYY-MM-DD):"
            : "Ingiza tarehe ya miadi (YYYY-MM-DD):"
        );
      },
      next: {
        "*\\d{4}-\\d{2}-\\d{2}": "show.time.slots",
        "*": "date.validation.error"
      },
    });

    // Remote appointment booking
    menu.state("remote.appointment", {
      run: async () => {
        await menu.session.set("appointmentType", "remote");
        const language = await menu.session.get("lang");
        
        menu.con(
          language === "English"
            ? "Enter appointment date (YYYY-MM-DD):"
            : "Ingiza tarehe ya miadi (YYYY-MM-DD):"
        );
      },
      next: {
        "*\\d{4}-\\d{2}-\\d{2}": "show.time.slots",
        "*": "date.validation.error"
      },
    });

    // Show available time slots
    menu.state("show.time.slots", {
      run: async () => {
        try {
          const date = menu.val;
          const language = await menu.session.get("lang");
          const selectedDoctor = await menu.session.get("selectedDoctor");
          
          // Validate date
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(date)) {
            return menu.con(
              language === "English"
                ? "Invalid date format. Please use YYYY-MM-DD:"
                : "Muundo wa tarehe si sahihi. Tafadhali tumia YYYY-MM-DD:"
            );
          }

          const dateObj = new Date(date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          if (isNaN(dateObj.getTime()) || dateObj < today) {
            return menu.con(
              language === "English"
                ? "Invalid date. Please enter a future date (YYYY-MM-DD):"
                : "Tarehe si sahihi. Tafadhali weka tarehe ya baadaye (YYYY-MM-DD):"
            );
          }

          await menu.session.set("selectedDate", date);
          
          const doctorId = await getDoctorId(selectedDoctor);
          const existingAppointments = await getGoogleAppointments(date, doctorId);
          const bookedSlots = existingAppointments.map(apt => apt.start_time);

          const timeSlots = [
            "09:00 AM", "10:00 AM", "11:00 AM", "01:00 PM", "02:00 PM", "03:00 PM",
          ];

          const mudaNafasi = [
            "09:00 Asubuhi", "10:00 Asubuhi", "11:00 Asubuhi", 
            "01:00 Mchana", "02:00 Mchana", "03:00 Mchana",
          ];

          const availableSlots = timeSlots.filter(slot => {
            const time24h = convertTo24Hour(slot);
            return !bookedSlots.includes(time24h);
          });

          const availableSlotsKiswahili = mudaNafasi.filter((slot, index) => {
            const time24h = convertTo24Hour(timeSlots[index]);
            return !bookedSlots.includes(time24h);
          });

          if (availableSlots.length === 0) {
            return menu.con(
              language === "English"
                ? `No available slots on ${date}. Please try a different date:`
                : `Hakuna nafasi tarehe ${date}. Tafadhali jaribu tarehe nyingine:`
            );
          }

          const slotsToShow = language === "English" ? availableSlots : availableSlotsKiswahili;
          await menu.session.set("availableSlots", slotsToShow);
          
          let slotsDisplay = "";
          slotsToShow.forEach((slot, index) => {
            slotsDisplay += `\n${index + 1}. ${slot}`;
          });

          menu.con(
            language === "English"
              ? `Available time slots for ${date}:${slotsDisplay}

Select a time slot:`
              : `Majira yaliyopo kwa ${date}:${slotsDisplay}

Chagua wakati:`
          );

        } catch (error) {
          console.error("Error showing time slots:", error);
          menu.goto("error.system");
        }
      },
      next: {
        1: "confirm.traditional.appointment",
        2: "confirm.traditional.appointment",
        3: "confirm.traditional.appointment",
        4: "confirm.traditional.appointment", 
        5: "confirm.traditional.appointment",
        6: "confirm.traditional.appointment",
        "*\\d{4}-\\d{2}-\\d{2}": "show.time.slots",
        "*": "error.invalid.selection"
      },
    });

    // Confirm traditional appointment
    menu.state("confirm.traditional.appointment", {
      run: async () => {
        try {
          const timeIndex = parseInt(menu.val) - 1;
          const language = await menu.session.get("lang");
          const availableSlots = await menu.session.get("availableSlots");
          const selectedDate = await menu.session.get("selectedDate");
          const selectedDoctor = await menu.session.get("selectedDoctor");
          const appointmentType = await menu.session.get("appointmentType");
          
          if (!availableSlots || timeIndex < 0 || timeIndex >= availableSlots.length) {
            return menu.con(
              language === "English"
                ? "Invalid selection. Please choose a valid time slot:"
                : "Uchaguzi si sahihi. Tafadhali chagua wakati sahihi:"
            );
          }

          const selectedTime = availableSlots[timeIndex];
          await menu.session.set("selectedTime", selectedTime);

          const appointmentTypeText = appointmentType === "physical" 
            ? (language === "English" ? "In-person" : "Ana kwa ana")
            : (language === "English" ? "Video call" : "Simu ya video");

          menu.con(
            language === "English"
              ? `Confirm your appointment:

Doctor: ${selectedDoctor}
Date: ${selectedDate}
Time: ${selectedTime}
Type: ${appointmentTypeText}

1. Confirm booking
2. Change time
0. Cancel`
              : `Thibitisha miadi yako:

Daktari: ${selectedDoctor}
Tarehe: ${selectedDate}
Wakati: ${selectedTime}
Aina: ${appointmentTypeText}

1. Thibitisha kupanga
2. Badilisha wakati
0. Ghairi`
          );

        } catch (error) {
          console.error("Error in appointment confirmation:", error);
          menu.goto("error.system");
        }
      },
      next: {
        1: "create.traditional.appointment",
        2: "show.time.slots",
        0: "Exit",
      },
    });

    // Create traditional appointment
    menu.state("create.traditional.appointment", {
      run: async () => {
        try {
          const appointmentType = await menu.session.get("appointmentType");
          const selectedDate = await menu.session.get("selectedDate");
          const selectedTime = await menu.session.get("selectedTime");
          const selectedDoctor = await menu.session.get("selectedDoctor");
          const age = await menu.session.get("age");
          const name = await menu.session.get("name");
          const number = await menu.session.get("number");
          const location = await menu.session.get("location");
          const language = await menu.session.get("lang");

          // Convert time format for storage
          const timeFor24h = convertTo24Hour(selectedTime);
          const doctorId = await getDoctorId(selectedDoctor);

          // Insert user if they don't exist
          await insertUser(name, age, number, location);

          // Get user ID
          const userId = await checkUserExist(number);

          // Record appointment based on type
          if (appointmentType === "physical") {
            await recordAppointment(userId, doctorId, selectedDate, timeFor24h);
          } else {
            await recordTeleppointment(userId, doctorId, selectedDate, timeFor24h);
          }

          // Send confirmation SMS
          const confirmationMessage = language === "English"
            ? `Hello ${name}, your appointment with Dr. ${selectedDoctor} on ${selectedDate} at ${selectedTime} is confirmed.`
            : `Hujambo ${name}, miadi yako na Dk. ${selectedDoctor} tarehe ${selectedDate} saa ${selectedTime} imepangwa.`;

          await sendSms(phoneNumber, confirmationMessage);

          // Success message
          let successMessage = language === "English"
            ? `Appointment successfully booked!

Your ${appointmentType} appointment with Dr. ${selectedDoctor} is confirmed for ${selectedDate} at ${selectedTime}.

A confirmation SMS has been sent to ${phoneNumber}.

Thank you for using our health service!`
            : `Miadi imepangwa kwa mafanikio!

Miadi yako ya ${appointmentType === "physical" ? "ana kwa ana" : "video"} na Dk. ${selectedDoctor} imethibitishwa kwa ${selectedDate} saa ${selectedTime}.

Ujumbe wa uthibitisho umetumwa ${phoneNumber}.

Asante kwa kutumia huduma yetu ya kiafya!`;

          menu.end(successMessage);

        } catch (error) {
          console.error("Error creating traditional appointment:", error);
          const language = await menu.session.get("lang");
          menu.end(
            language === "English"
              ? "Sorry, we encountered an error while booking your appointment. Please try again later."
              : "Samahani, tumekumbana na hitilafu wakati wa kupanga miadi yako. Tafadhali jaribu tena baadaye."
          );
        }
      },
    });

    // ====================== ERROR HANDLING STATES ====================== //

    menu.state("error.invalid.selection", {
      run: async () => {
        const language = await menu.session.get("lang");
        menu.con(
          language === "English"
            ? "Invalid selection. Please choose a valid option:"
            : "Uchaguzi si sahihi. Tafadhali chagua chaguo sahihi:"
        );
      },
      next: {
        "*": "registration.location"
      }
    });

    menu.state("error.system", {
      run: async () => {
        const language = await menu.session.get("lang");
        menu.end(
          language === "English"
            ? "We encountered a system error. Please try again later."
            : "Tumekumbana na hitilafu ya mfumo. Tafadhali jaribu tena baadaye."
        );
      },
    });

    menu.state("date.validation.error", {
      run: async () => {
        const language = await menu.session.get("lang");
        menu.con(
          language === "English"
            ? "Invalid date format. Please enter date as YYYY-MM-DD (e.g., 2024-03-15):"
            : "Muundo wa tarehe si sahihi. Tafadhali weka tarehe kama YYYY-MM-DD (mfano, 2024-03-15):"
        );
      },
      next: {
        "*\\d{4}-\\d{2}-\\d{2}": "show.time.slots",
        "*": "date.validation.error"
      }
    });

    // New location state for location changes
    menu.state("new-location1", {
      run: async () => {
        const language = await menu.session.get("lang");
        menu.con(
          language === "English"
            ? "Enter New Location/Town (e.g Nairobi):"
            : "Ingiza Eneo/Jiji Jipya (mfano: Nairobi):"
        );
      },
      next: {
        "*[a-zA-Z ]+": "update.location.and.retry",
      },
    });
    
    menu.state("update.location.and.retry", {
      run: async () => {
        const newLocation = capitalize(menu.val.toLowerCase().trim());
        await menu.session.set("location", newLocation);
        
        // Return to appropriate state based on flow
        const aiAssessment = await menu.session.get("ai_assessment");
        if (aiAssessment) {
          menu.goto("ai.book.recommended");
        } else {
          menu.goto("select.specialist.location");
        }
      },
    });

    // Exit state
    menu.state("Exit", {
      run: async () => {
        try {
          let currentDate = new Date();
          let hours = currentDate.getHours();
          let greetings;
          const language = (await menu.session.get("lang")) || "English";

          function displayTime() {
            return hours < 10 ? "0" + hours : hours;
          }
          let hour = displayTime();

          if (hour < 12) {
            greetings = language === "Kiswahili" ? "Habari za siku!" : "Good Day!";
          } else if (hour >= 12 && hour < 17) {
            greetings = language === "Kiswahili" ? "Habari za mchana!" : "Good Afternoon!";
          } else if (hour >= 17) {
            greetings = language === "Kiswahili" ? "Habari za jioni!" : "Good Evening!";
          } else {
            greetings = language === "Kiswahili" ? "Kwaheri!" : "Bye!";
          }

          menu.end(
            language === "Kiswahili"
              ? `Asante kwa Muda Wako! ${greetings}`
              : `Thanks for Your Time! Have a ${greetings}`
          );
        } catch (error) {
          console.error("Error in Exit state:", error);
          menu.end("Thank you for using our service. Goodbye!");
        }
      },
    });

    // Send the response back to the API
    menu.run(req.body, (ussdResult) => {
      res.send(ussdResult);
    });
  } catch (error) {
    console.error("Error processing USSD request:", error);
    res.status(500).send("END An error occurred. Please try again later.");
  }
});

// Log uncaught exceptions without crashing the application
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`USSD Service is running on port ${PORT}`);
});
