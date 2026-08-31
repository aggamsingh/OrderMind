/**
 * One-off connectivity check for GEMINI_API_KEY — smallest possible request
 * to confirm the key actually authenticates before assuming the full
 * provider will work.
 *
 * Run: npx tsx scripts/check-gemini-connection.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { GoogleGenAI } from "@google/genai";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Missing GEMINI_API_KEY in .env.local.");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-flash-lite-latest",
      contents: "Reply with exactly: OK",
    });
    console.log("CONNECTED to Gemini API successfully.");
    console.log("Model replied:", response.text);
  } catch (err) {
    console.error("CONNECTION FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
