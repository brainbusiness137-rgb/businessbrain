import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import {
  evaluateAuthRequestOrigin,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/auth-security";
import {
  hasOnlyAllowedFields,
  readJsonObject,
} from "@/lib/request-validation";

export async function POST(request: NextRequest) {
  try {
    const originDecision = evaluateAuthRequestOrigin(request.headers);
    if (!originDecision.allowed) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("Auth session origin rejected", { reason: originDecision.reason });
      }
      return NextResponse.json(
        { success: false, message: "Invalid origin" },
        { status: 403 }
      );
    }

    const body = await readJsonObject(request);

    if (!body || !hasOnlyAllowedFields(body, ["idToken"])) {
      return NextResponse.json(
        { success: false, message: "Invalid request body" },
        { status: 400 }
      );
    }

    const { idToken } = body;

    if (
      typeof idToken !== "string" ||
      !idToken ||
      idToken.length > 10_000
    ) {
      return NextResponse.json(
        { success: false, message: "ID token is required" },
        { status: 400 }
      );
    }

    const decodedToken = await adminAuth.verifyIdToken(idToken, true);

    const expiresIn = SESSION_COOKIE_MAX_AGE_SECONDS * 1000;

    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn,
    });

    const response = NextResponse.json({
      success: true,
      uid: decodedToken.uid,
    });

    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      ...sessionCookieOptions(request),
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
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
