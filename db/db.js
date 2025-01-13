import * as dotenv from "dotenv";
dotenv.config();
import { Sequelize, DataTypes } from "sequelize";

// mysql Database connection
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    dialect: 'postgres',
    port: process.env.PORT,
  }
);

// Define models
export const user = sequelize.define(
  "user",
  {
    user_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: DataTypes.STRING,
    age: DataTypes.STRING,
    phone_number: DataTypes.STRING,
    location: DataTypes.STRING,
  },
  {
    timestamps: false,
  }
);

export const doctor = sequelize.define(
  "doctor",
  {
    doctor_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: DataTypes.STRING,
    contact_info: {
      type: DataTypes.STRING,
      unique: true,
    },
    type: DataTypes.STRING,
    location: DataTypes.STRING,
    email: DataTypes.STRING,
    address: DataTypes.STRING,
  },
  {
    timestamps: false,
  }
);

export const appointment = sequelize.define(
  "appointment",
  {
    appointment_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: DataTypes.INTEGER,
    doctor_id: DataTypes.INTEGER,
    date: DataTypes.DATE,
    time: DataTypes.STRING,
    status: DataTypes.STRING,
  },
  {
    timestamps: false,
  }
);
export const teleappointment = sequelize.define(
  "teleappointment",
  {
    appointment_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: DataTypes.INTEGER,
    doctor_id: DataTypes.INTEGER,
    date: DataTypes.DATE,
    time: DataTypes.STRING,
    status: DataTypes.STRING,
  },
  {
    timestamps: false,
  }
);

export const googleappointment = sequelize.define(
  "googleappointment",
  {
    appointment_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    doctor_id: DataTypes.INTEGER,
    date: DataTypes.DATEONLY,
    start_time: DataTypes.TIME,
    end_time: DataTypes.TIME,
    appointment_info: DataTypes.STRING,
    google_id: DataTypes.STRING,
  },
  {
    timestamps: false,
  }
);

// Define associations
appointment.belongsTo(user, { foreignKey: "user_id", as: "User" });
appointment.belongsTo(doctor, { foreignKey: "doctor_id", as: "Doctor" });
teleappointment.belongsTo(user, { foreignKey: "user_id", as: "User" });
teleappointment.belongsTo(doctor, { foreignKey: "doctor_id", as: "Doctor" });
user.hasMany(appointment, { foreignKey: "user_id" });
doctor.hasMany(appointment, { foreignKey: "doctor_id" });