import { EgressClient, EncodedFileOutput, S3Upload } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const roomName = req.nextUrl.searchParams.get('roomName');

    if (roomName === null) {
      return new NextResponse('Missing roomName parameter', { status: 403 });
    }

    const {
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET,
      LIVEKIT_URL,
      S3_KEY_ID,
      S3_KEY_SECRET,
      S3_BUCKET,
      S3_ENDPOINT,
      S3_REGION,
    } = process.env;

    console.log("========== START RECORDING ==========");
    console.log("Room Name:", roomName);
    console.log("LIVEKIT_URL:", LIVEKIT_URL);
    console.log("LIVEKIT_API_KEY Present:", !!LIVEKIT_API_KEY);
    console.log("LIVEKIT_API_SECRET Present:", !!LIVEKIT_API_SECRET);
    console.log("S3_BUCKET:", S3_BUCKET);
    console.log("S3_REGION:", S3_REGION);
    console.log("S3_ENDPOINT:", S3_ENDPOINT);
    console.log("====================================");

    if (
      !LIVEKIT_URL ||
      !LIVEKIT_API_KEY ||
      !LIVEKIT_API_SECRET ||
      !S3_ENDPOINT ||
      !S3_KEY_ID ||
      !S3_KEY_SECRET ||
      !S3_REGION ||
      !S3_BUCKET
    ) {
      return new NextResponse("Missing required environment variables", {
        status: 500,
      });
    }

    const hostURL = new URL(LIVEKIT_URL);
    hostURL.protocol = "https:";

    const egressClient = new EgressClient(
      hostURL.origin,
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET
    );

    const existingEgresses = await egressClient.listEgress({ roomName });

    if (
      existingEgresses.length > 0 &&
      existingEgresses.some((e) => e.status < 2)
    ) {
      return new NextResponse("Meeting is already being recorded", {
        status: 409,
      });
    }

    const fileOutput = new EncodedFileOutput({
      filepath: `${new Date().toISOString()}-${roomName}.mp4`,
      output: {
        case: "s3",
        value: new S3Upload({
          endpoint: S3_ENDPOINT,
          accessKey: S3_KEY_ID,
          secret: S3_KEY_SECRET,
          region: S3_REGION,
          bucket: S3_BUCKET,
        }),
      },
    });

    console.log("Calling startRoomCompositeEgress...");

    const response = await egressClient.startRoomCompositeEgress(
      roomName,
      {
        file: fileOutput,
      },
      {
        layout: "speaker",
      }
    );

    console.log("Recording started successfully!");
    console.log(response);

    return new NextResponse(null, { status: 200 });

  } catch (error) {
    console.error("Error starting recording:", error);

    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }

    return new NextResponse("Unknown error", { status: 500 });
  }
}