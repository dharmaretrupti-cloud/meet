import { NextResponse } from "next/server";
import { deepgram } from "@/lib/deepgram/client";

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      message: "Deepgram client initialized successfully.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Failed to initialize Deepgram client.",
      },
      { status: 500 }
    );
  }
}