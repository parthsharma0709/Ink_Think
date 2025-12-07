// testGemini.js
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

async function testConnection() {
  console.log("1. Checking API Key...");
  if (!process.env.GEMINI_API_KEY) {
    console.error("❌ Error: GEMINI_API_KEY is missing in .env file");
    return;
  }
  console.log("✅ API Key found.");

  console.log("2. Connecting to Gemini (v1)...");
  const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: "v1",          // <- important
  });

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash", // or "gemini-flash-1.5" / "gemini-flash-1.5-latest"
  });

  const dummyImage =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

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
    const text = result.response.text();

    console.log("✅ Success! Gemini responded:", text);
  } catch (error) {
    console.error("❌ Connection Failed:", error);
  }
}

testConnection();
