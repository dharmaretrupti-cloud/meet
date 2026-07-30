import { DeepgramClient } from "@deepgram/sdk";

if (!process.env.DEEPGRAM_API_KEY) {
  throw new Error("DEEPGRAM_API_KEY is missing");
}
export const deepgram = new DeepgramClient({
  apiKey: process.env.DEEPGRAM_API_KEY!,
});