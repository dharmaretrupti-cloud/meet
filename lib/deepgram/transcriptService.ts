import { deepgram } from "./client";

export async function createTranscriptConnection() {
  const connection = await deepgram.listen.v1.connect({
    model: "nova-3",
    language: "en",
    smart_format: "true",
    interim_results: "true",
    punctuate: "true",
  });
  (connection as any).on("transcript", (data: any) => {
    console.log("Transcript Event:", data);
  });

  connection.on("open", () => {
    console.log("Deepgram connection opened.");
  });

  connection.on("close", () => {
    console.log("Deepgram connection closed.");
  });

  connection.on("error", (error) => {
    console.error("Deepgram Error:", error);
  });
  return connection;
}