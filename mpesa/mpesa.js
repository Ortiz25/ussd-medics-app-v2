import * as dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import moment from "moment";

// Safaricom M-Pesa API URL
const baseUrl =
  process.env.MPESA_ENV === "sandbox"
    ? "https://sandbox.safaricom.co.ke"
    : "https://api.safaricom.co.ke";
// Function to generate the access token
export async function getOAuthToken() {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString("base64");
  try {
    const response = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );
    return response.data.access_token;
  } catch (error) {
    console.error("Error generating access token:", error);
    throw error;
  }
}

// Function to generate the password
function generatePassword() {
  const shortCode = process.env.BUSINESS_SHORT_CODE;
  const passKey = process.env.PASS_KEY;
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, -3);
  return Buffer.from(`${shortCode}${passKey}${timestamp}`).toString("base64");
}

// Function to initiate STK push
async function initiateSTKPush(phoneNumber, amount) {
  try {
    const accessToken = await generateAccessToken();
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, -3);
    const password = generatePassword();

    const requestBody = {
      BusinessShortCode: process.env.BUSINESS_SHORT_CODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phoneNumber,
      PartyB: process.env.BUSINESS_SHORT_CODE,
      PhoneNumber: phoneNumber,
      CallBackURL: "https://your-callback-url.com/callback",
      AccountReference: "Your Account Reference",
      TransactionDesc: "Payment for goods/services",
    };

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("STK push initiated:", response.data);
    return response.data;
  } catch (error) {
    console.error("Error initiating STK push:", error);
    throw error;
  }
}

// // Example usage
// stkPush("254712345678", 100, "AccountRef", "Payment for services")
//   .then((response) => console.log("STK Push Response:", response))
//   .catch((error) => console.error("STK Push Error:", error));

// module.exports = { stkPush };
