// testGemini.js
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

async function testConnection() {
  console.log("1. Checking API Key...");
  if (!process.env.GEMINI_API_KEY) {
    console.error("❌ Error: GEMINI_API_KEY is missing in .env file");
    return;
  }
  console.log("✅ API Key found.");

  console.log("2. Connecting to Gemini...");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  // --- CHANGE IS HERE ---
  // Switched from "gemini-1.5-flash" to "gemini-2.0-flash"
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); 
  // ----------------------

  // A simple 1x1 white pixel in Base64 to test the connection
  const dummyImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

  try {
    const prompt = "Describe this image in one word.";
    const imagePart = {
      inlineData: {
        data: dummyImage,
        mimeType: "image/png",
      },
    };

    console.log("3. Sending request to Gemini...");
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();
    
    console.log("✅ Success! Gemini responded:", text);
  } catch (error) {
    console.error("❌ Connection Failed:", error.message);
  }
}

testConnection();