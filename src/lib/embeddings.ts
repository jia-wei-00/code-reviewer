import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

let cached: GoogleGenerativeAIEmbeddings | undefined;

export function getEmbeddings(): GoogleGenerativeAIEmbeddings {
  if (cached) return cached;
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_API_KEY env var");
  cached = new GoogleGenerativeAIEmbeddings({
    model: process.env.EMBEDDING_MODEL ?? "gemini-embedding-2",
    apiKey,
  });
  return cached;
}
