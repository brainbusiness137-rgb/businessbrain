import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");

    if (origin && !origin.includes(".app.github.dev") && !origin.includes("localhost")) {
      return NextResponse.json(
        { success: false, message: "Invalid origin" },
        { status: 403 }
      );
    }

    const { idToken } = await request.json();

    if (!idToken || typeof idToken !== "string") {
      return NextResponse.json(
        { success: false, message: "ID token is required" },
        { status: 400 }
      );
    }

    const decodedToken = await adminAuth.verifyIdToken(idToken);

    const expiresIn = 1000 * 60 * 60 * 24 * 5;

    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn,
    });

    const response = NextResponse.json({
      success: true,
      uid: decodedToken.uid,
    });

    response.cookies.set("businessbrain_session", sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: expiresIn / 1000,
    });

    return response;
  } catch (error) {
    console.error("Session creation failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to create secure session",
      },
      { status: 401 }
    );
  }
}