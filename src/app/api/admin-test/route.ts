import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export async function GET() {
  try {
    const snapshot = await adminDb
      .collection("platformUsers")
      .limit(1)
      .get();

    return NextResponse.json({
      success: true,
      message: "Firebase Admin connected successfully",
      documentsFound: snapshot.size,
    });
  } catch (error) {
    console.error("Firebase Admin test failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Firebase Admin connection failed",
      },
      { status: 500 }
    );
  }
}