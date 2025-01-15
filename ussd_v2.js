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
  sendSms
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
let timeSlotsString = ""

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
  // const token = await getOAuthToken();
  // console.log(token);
 
  res.send("Hello World");
});

////////////////////////// POST METHODS ///////////////////////////////////

app.post("/ussd", async function (req, res) {
  // Read the variables sent via POST from our API
  const { sessionId, serviceCode, phoneNumber, text } = req.body;
  const capitalize = (s) => (s && s[0].toUpperCase() + s.slice(1)) || "";

  const doctorsArray = [];

  let string1 = `Select a Doctor:`;
  let string2 = "";
  const timeSlots = [
    "09:00 AM",
    "10:00 AM",
    "11:00 AM",
    "01:00 PM",
    "02:00 PM",
    "03:00 PM ",
  ];

  const mudaNafasi = [
    "09:00 Asubuhi",
    "10:00 Asubuhi",
    "11:00 Asubuhi",
    "01:00 Mchana",
    "02:00 Mchana",
    "03:00 Mchana",
  ];
  

  // Define menu states
  menu.startState({
    run: () => {
      menu.con(
        `Welcome/ Karibu:
          1. English:
          2. Kiswahili:
          0. Exit / Ondoka`
      );
    },

    next: {
      0: "Exit",
      1: "Start",
      2: "Start",
    },
  });

  menu.state("Start", {
    run: async () => {
      let lang = +menu.val;
      if (lang === 1) {
        menu.session.set("lang", "English");
      }
      if (lang === 2) {
        menu.session.set("lang", "Kiswahili");
      }
      console.log(typeof lang);
      menu.con(`${lang == 1 ? " Enter your Name:" : "Weka Jina Lako:"}`);
    },
    next: {
      "*[a-zA-Z]+": "registration.name",
    },
  });

  menu.state("registration.name", {
    run: async () => {
      let name = menu.val;
      const language = await menu.session.get("lang");
      console.log(language);
      menu.session.set("name", name).then(() => {
        menu.con(
          `${language === "English" ? "Enter your Age:" : "Weka Umri Wako:"}`
        );
      });
    },
    next: {
      "*^[1-9]$|^[1-9][0-9]$|^(100)$": "registration.age",
    },
  });

  menu.state("registration.age", {
    run: async () => {
      let age = menu.val;
      const language = await menu.session.get("lang");
      menu.session.set("age", age).then(() => {
        menu.con(
          `${
            language === "English"
              ? "Enter your Phone number (0722 XXX XXX):"
              : "Weka Nambari Yako ya Simu (0722 XXX XXX):"
          }`
        );
      });
    },
    next: {
      "*^(\\+254|0)7\\d{8}$": "registration.number",
    },
  });

  menu.state("registration.number", {
    run: async () => {
      let number = menu.val;
      const language = await menu.session.get("lang");
      menu.session.set("number", number).then(() => {
        menu.con(
          `${
            language === "English"
              ? "Enter your Location/Town (e.g Nairobi):"
              : "Weka Mahali Ulipo/Mji (mfano Nairobi):"
          }`
        );
      });
    },
    next: {
      "*[a-zA-Z]+": "registration.location",
    },
  });

  menu.state("registration.location", {
    run: async () => {
      let location = menu.val.toLowerCase();
      const language = await menu.session.get("lang");
      menu.session.set("location", capitalize(location)).then(() => {
        menu.con(
          `${
            language === "English"
              ? `Choose preferred Service:
                    1. Specialist Details.
                    2. Book an Appointment.`
              : `Chagua Huduma Unayopendelea:
                    1. Maelezo ya Mtaalamu.
                    2. Panga Miadi.`
          }`  
        );
      });
    },
    next: {
      1: "Specialist",
      2: "Appointment",
    },
  });

  //////////////////////////// PRINT SPECIALIST DETAILS ///////////////////////////////////

  menu.state("Specialist", {
    run: async () => {
      const specialistType = await getDoctorType();
      const cleanedSpecialistType = specialistType.map((item) => item.trim());
      const language = await menu.session.get("lang");
      // if (location.length > 2) {
      //   menu.session.set("location", location);
      // }
      let unique = [...new Set(cleanedSpecialistType)];
       console.log(specialistType)
       console.log(unique)
      let string1 = `${
        language === "English"
          ? "Select specialist you need:"
          : "Chagua mtaalamu unayehitaji:"
      }\n`;
      let string2 = "";
      
      
      string2 = await Promise.all(
        
        unique.map(async (specialist, index) => {
          const translatedSpecialist =
            language === "English"
              ? specialist
              : await wordTranslate(specialist.split(",")[0]);

            //console.log("translated",translatedSpecialist)  

          return `${index + 1}. ${translatedSpecialist}`;
        })
      );
      string2 = string2.join("\n");
       
      console.log(unique.length)
     
      if (unique.length < 10) {
        specialistNumber = `*[1-${unique.length}]`;
      }
      if (unique.length === 10) {
        specialistNumber = "*^(10|[1-9])$";
      }
      if (unique.length > 10 && unique.length < 20) {
        specialistNumber = `*^(1[0-${unique.length}]|[1-9])$`;
      }

      //console.log("Length", unique.length);
      console.log(specialistNumber)
      
      menu.con(string1.concat( string2));
    },
    next: {
      [specialistNumber]: "registration.specialist-1",
    },
  });
  menu.state("registration.specialist-1", {
    run: async () => {
      let docIndex = menu.val;
      //console.log("Index", docIndex);
      const doctors = await getDoctors();
      const specialistType = await getDoctorType();
      const location = await menu.session.get("location");
      const language = await menu.session.get("lang");
      //console.log(doctors, specialistType);
      doctors.forEach((doctor, idx) => {
        doctorsArray.push({ index: `${idx + 1}`, name: doctor.name });
      });
      let unique = [...new Set(specialistType)];
      specialist = unique.at(docIndex - 1);
      //console.log(unique, specialist);
      await menu.session.set("specialist-type", specialist);
      //console.log("Selected specialist", specialist, location);
      if (specialist) {
        const docNames = await getDoctorsNames(specialist, location);

        await menu.session.set("docNamesArray", docNames);
        //console.log("Docnames", docNames.length);
        doctorNumber = `*[1-${docNames ? docNames.length : "2"}]`;
        await menu.session.set("specialist-name", specialist?.name);

        if (docNames.length !== 0) {
          docNames.forEach((specialist, index) => {
            string2 += `
          ${index + 1}. ${specialist}
         `;
          });
        } else {
          return menu.con(language === "English"?
            `There is currently no registered ${specialist} in ${location}:
             0. Change Location,
             100. Exit`:
             `
Hakuna ${await wordTranslate(specialist)} aliye sajiliwa kwa sasa katika ${location}:
0. Badilisha Eneo,
100. Ondoka`
          );
        }
      }
      menu.con(language === "English"?`Select a ${specialist} in ${location}:`.concat(" ", string2): `Chagua ${await wordTranslate(specialist)} katika ${location}:`.concat(" ", string2));
    },
    next: {
      [doctorNumber]: "appointment.doctor-1",
      0: "new-location",
      100: "Exit",
    },
  });
  menu.state("new-location", {
    run: async () => {
      const language = await menu.session.get("lang");
      menu.con(language === "English"? "Enter New Location/Town (e.g Nairobi):": "Ingiza Eneo/Mji Mpya (mfano: Nairobi):");
    },
    next: {
      "*[a-zA-Z]+": "reg-location",
    },
  });
  menu.state("reg-location", {
    run: async () => {
      let newLocation = capitalize(menu.val.toLowerCase());
      const specialist = await menu.session.get("specialist-type");
      const language = await menu.session.get("lang");
      // console.log("Selected specialist", specialist, newLocation);

      if (specialist) {
        const docNames = await getDoctorsNames(specialist, newLocation);
        await menu.session.set("docNamesArray", docNames);
        //console.log("Docnames", docNames);
        doctorNumber = `*[1-${docNames ? docNames.length : "2"}]`;

        if (docNames != 0) {
          docNames.forEach((specialist, index) => {
            string2 += `
          ${index + 1}. ${specialist}
         `;
          });
        } else {
          return menu.con(language === "English"?
            `There is currently no registered ${specialist} in ${newLocation}:
             0. Change Location,
             100. Exit`:
             `
Hakuna ${await wordTranslate(specialist)} aliye sajiliwa kwa sasa katika ${newLocation}:
0. Badilisha Eneo,
100. Ondoka`
          );
        }
      }
      menu.con(language === "English"?`Select a ${specialist} in ${newLocation}:`.concat(" ", string2): `Chagua ${await wordTranslate(specialist)} katika ${newLocation}:`.concat(" ", string2));
    },
  
    next: {
      [doctorNumber]: "appointment.doctor-1",
      0: "new-location",
      100: "Exit",
    },
  });

  menu.state("appointment.doctor-1", {
    run: async () => {
      const language = await menu.session.get("lang");
      let docIndex = menu.val;
      console.log("doc index", docIndex);
      const doc = await menu.session.get("specialist");
      console.log("doc", doc);
      if (!doc) {
        const docNamesArray = await menu.session.get("docNamesArray");
        // console.log("Array", docNamesArray);
        const doctor = docNamesArray.at(docIndex - 1);
        // console.log("Doctor", doctor);
        await menu.session.set("Doctor", doctor);
        const docDetails = await getDoctorDetails(doctor);
        console.log("Details", docDetails);
        menu.end( language === "English"?
          `${doctor}:
            Mobile: ${docDetails.contact}
            Town: ${docDetails.location}
            Email: ${docDetails.email}
            Address: ${docDetails.address}`:
            `${doctor}:
Simu: ${docDetails.contact}
Mji: ${docDetails.location}
Barua pepe: ${docDetails.email}
Anwani: ${docDetails.address}`
        );
      }
    },
  });
  /////////////////////////////////////////////////////////////////////////////////////

  //////////////////////////// MAKE APPOINTMENT ///////////////////////////////////////

  menu.state("Appointment", {
    run: async () => {
      const language = await menu.session.get("lang");
      menu.con(
        ` ${
            language === "English"
              ? `Please enter the Appointment type:
                       1. Physical appointment
                       2. Remote(Video appointment`
              : `Tafadhali ingiza aina ya miadi:
                       1. Miadi ya ana kwa ana
                       2. Miadi ya mbali (Miadi ya video).`
          }`
      );
    },
    next: {
      1: "physical",
      2: "remote",
    },
  });

  menu.state("physical", {
    run: async () => {
      if (menu.val.length > 3) {
        let location = menu.val.toLowerCase();
        await menu.session.set("location", capitalize(location));
      }
      await menu.session.set("appointmentType", "physical");
      const language = await menu.session.get("lang");

      const specialistType = await getDoctorType();

      let unique = [...new Set(specialistType)];
      let string1 = `${language === "English"? "Select specialist you need:\n" : "Chagua mtaalamu unayehitaji:\n"}`;
      let string2 = "";

      string2 = await Promise.all(
        
        unique.map(async (specialist, index) => {
          const translatedSpecialist =
            language === "English"
              ? specialist
              : await wordTranslate(specialist.split(",")[0]);

            //console.log("translated",translatedSpecialist)  

          return `${index + 1}. ${translatedSpecialist}`;
        })
      );
      string2 = string2.join("\n");
    //   unique.forEach((specialist, index) => {
    //     string2 += `
    //   ${index + 1}. ${specialist}
    //  `;
    //   });
    if (unique.length < 10) {
      specialistNumber = `*[1-${unique.length}]`;
    }
    if (unique.length === 10) {
      specialistNumber = "*^(10|[1-9])$";
    }
    if (unique.length > 10 && unique.length < 20) {
      specialistNumber = `*^(1[0-${unique.length}]|[1-9])$`;
    }

      menu.con(string1.concat(" ", string2));
    },
    next: {
    [specialistNumber]: "registration.specialist",
    },
  });

  menu.state("remote", {
    run: async () => {
      if (menu.val.length > 3) {
        let location = menu.val.toLowerCase();
        await menu.session.set("location", capitalize(location));
      }
      await menu.session.set("appointmentType", "remote");
      const language = await menu.session.get("lang");

      const specialistType = await getDoctorType();

      let unique = [...new Set(specialistType)];
      let string1 = `${language === "English"? "Select specialist you need:\n" :"Chagua mtaalamu unayehitaji:\n" }`;
      let string2 = "";
      string2 = await Promise.all(
        
        unique.map(async (specialist, index) => {
          const translatedSpecialist =
            language === "English"
              ? specialist
              : await wordTranslate(specialist.split(",")[0]);
          return `${index + 1}. ${translatedSpecialist}`;
        })
      );
      string2 = string2.join("\n");

      if (unique.length < 10) {
        specialistNumber = `*[1-${unique.length}]`;
      }
      if (unique.length === 10) {
        specialistNumber = "*^(10|[1-9])$";
      }
      if (unique.length > 10 && unique.length < 20) {
        specialistNumber = `*^(1[0-${unique.length}]|[1-9])$`;
      }

      menu.con(string1.concat(" ", string2));
    },
    next: {
      [specialistNumber]: "registration.specialist",
    },
  });

  menu.state("registration.specialist", {
    run: async () => {
      let docIndex = menu.val;
      const language = await menu.session.get("lang");
       console.log("Index", docIndex);
      const location = await menu.session.get("location");
      const doctors = await getDoctors();
      const specialistType = await getDoctorType();
      // console.log(doctors, specialistType);
      doctors.forEach((doctor, idx) => {
        doctorsArray.push({ index: `${idx + 1}`, name: doctor.name });
      });
      let unique = [...new Set(specialistType)];
      specialist = unique.at(docIndex - 1);
           console.log(specialist)
      if (specialist) {
        const docNames = await getDoctorsNames(specialist, location);
        await menu.session.set("docNamesArray", docNames);
        //console.log("Docnames", docNames);
        doctorNumber = `*[1-${docNames ? docNames.length : "2"}]`;
        await menu.session.set("specialist-name", specialist?.name);

        if (docNames != 0) {
          docNames.forEach((specialist, index) => {
            string2 += `
          ${index + 1}. ${specialist}
         `;
          });
        } else {
          return menu.con(
              `${language === "English" 
    ? `There is currently no registered ${specialist} in ${location}:
        0. Change Location,
        100. Exit` 
    : `Kwa sasa hakuna ${specialist} aliyesajiliwa katika ${location}:
        0. Badilisha Eneo,
        100. Toka`}`

          );
        }
      }
      string1 = language === "English" ? "Select a Doctor:": "Chagua Daktari:"
      menu.con(string1.concat(" ", string2));
    },
    next: {
      [doctorNumber]: "appointment.doctor",
      0: "new-location1",
      100: "Exit",
    },
  });
  menu.state("new-location1", {
    
    run: async () => {
      const language = await menu.session.get("lang");

      menu.con(language === "English" 
        ? "Enter New Location/Town (e.g Nairobi):" 
        : "Ingiza Eneo/Jiji Jipya (mfano: Nairobi):"
      );
    },
    next: {
      "*[a-zA-Z]+": async () => {
        const appointmentType = await menu.session.get("appointmentType");
        console.log('app type',appointmentType )
        if (appointmentType === "remote") {
          return "remote";
        } else {
          return "physical";
        }
      },
    },
  });

  menu.state("appointment.doctor", {
    run: async () => {
      let docIndex = menu.val;
      const language = await menu.session.get("lang");
      console.log("doc index", docIndex);
      const doc = await menu.session.get("Doctor");
      console.log("doc", doc);
      if (!doc) {
        const docNamesArray = await menu.session.get("docNamesArray");
        console.log("Array", docNamesArray);
        const doctor = docNamesArray.at(docIndex - 1);
        console.log("Doctor", doctor);
        await menu.session.set("Doctor", doctor);
      }

      menu.con( language === "English" ?
        "Please enter the Date for the Physical appointment (YYYY-MM-DD):" :
        "Tafadhali ingiza Tarehe ya miadi ya Ana kwa Ana (YYYY-MM-DD):"
      );
    },
    next: {
      "*\\d+": "appointment.date",
    },
  });

  menu.state("appointment.date", {
    run: async () => {
      let date = menu.val;
      const specialist = await menu.session.get("Doctor");
      const language = await menu.session.get("lang");
      console.log(date);
      const doctorId = await getDoctorId(specialist);
      const appointments = await getGoogleAppointments(date, doctorId);
      await menu.session.set("date", date);
      // const timesToRemove = appointments.map((appointment) =>
      //   appointment.dataValues.start_time.slice(0, 5)
      // );

      // // Filter out the times
      // const filteredTimeSlots = timeSlots.filter((slot) => {
      //   const slot24h = convertTo24Hour(slot.trim()); // Convert to 24-hour format and trim whitespace
      //   return !timesToRemove.includes(slot24h);
      // });

      await menu.session.set("slots", timeSlots);
 
      if(language === "English"){
         timeSlotsString = timeSlots
        .map((slot, index) => `${index + 1}. ${slot}`)
        .join("\n");
      }else{
         timeSlotsString = mudaNafasi
        .map((slot, index) => `${index + 1}. ${slot}`)
        .join("\n");
      }
      

      menu.con(language === "English" 
        ? `Please select an Appointment time slot:\n${timeSlotsString}` 
        : `Tafadhali chagua nafasi ya muda wa miadi:\n${timeSlotsString}`
      
      );
    },
    next: {
      "*\\d+": "appointment.time",
    },
  });

  menu.state("appointment.time", {
    run: async () => {
      let time = menu.val;
      const language = await menu.session.get("lang");
      const slots = await menu.session.get("slots");
      // console.log("Timeslot", slots[time - 1]);
      await menu.session.set("time", slots[time - 1]);
      // const date = await menu.session.get("date");
      // console.log(date, time)

      menu.con(language ==="English" ? "Select 1 to confirm appointment:" :"Chagua 1 kuthibitisha miadi:");
    },
    next: {
      1: "create.appointment",
    },
  });

  menu.state("create.appointment", {
    run: async () => {
      const appointmentType = await menu.session.get("appointmentType");
      const date = await menu.session.get("date");
      const time = await menu.session.get("time");
      const specialist = await menu.session.get("Doctor");
      const doctorId = await getDoctorId(specialist);
      const age = await menu.session.get("age");
      const name = await menu.session.get("name");
      const number = await menu.session.get("number");
      const location = await menu.session.get("location");
      const language = await menu.session.get("lang");
      // await insertUser(name, age, number, location);

      //console.log("Number", number);
      //const userId = await checkUserExist(number);
      //await insertUser(name, age, number, location);
      const sms_message = language === "English" ?  `Appointment scheduled with ${specialist} on ${date} at ${time}.`: `Miadi imepangwa na ${await wordTranslate(specialist)} tarehe ${date} saa ${time}.`;
      await sendSms(phoneNumber, sms_message);
      //console.log("User ID", userId);
      if (appointmentType === "physical") {
        //await recordAppointment(userId, doctorId, date, time);
      } else {
        //await recordTeleppointment(userId, doctorId, date, time);
      }
      //console.log(specialist, doctorId, name, date, time);
      menu.end(language === "English"? `Your appointment has been scheduled.
                      An appointment confirmation SMS has been sent to your phone.`:
                      `Miadi yako imepangwa.
                      Ujumbe wa uthibitisho wa miadi umetumwa kwenye simu yako.`);
    },
  });

  /////////////////////////////////////////////////////////////////////////////////////

  menu.state("Exit", {
    run: async () => {
      let currentDate = new Date();
      let hours = currentDate.getHours();
      let greetings;
      const language = await menu.session.get("lang");

      function displayTime() {
        hours = hours < 10 ? "0" + hours : hours;
        return hours;
      }
      let hour = displayTime();

      if (hour < 12) {
        language === "Kiswahili"? greetings = "Habari za siku!":greetings = "Good Day!";
      } else if (hour >= 12 && hour < 17) {
        language === "Kiswahili"? greetings = "Habari za mchana!" :greetings = "Good Afternoon!";
      } else if (hour >= 17) {
        language === "Kiswahili"? greetings = "Habari za jioni!" :greetings = "Good Evening!";
      } else {
        greetings = "Bye!";
      }
      menu.end(language === "Kiswahili"? `Asante kwa Muda Wako! Pate ${greetings}`: `Thanks for Your Time!, Have a ${greetings}`);
    },
  });

  // Send the response back to the API
  menu.run(req.body, (ussdResult) => {
    res.send(ussdResult);
  });
});

// Start the server
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
