import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import {
  clearSessionCookie,
  isAllowedAuthOrigin,
  SESSION_COOKIE_NAME,
} from "@/lib/auth-security";

export async function POST(request: NextRequest) {
  if (!isAllowedAuthOrigin(request.headers.get("origin"))) {
    return NextResponse.json(
      { success: false, message: "Invalid origin" },
      { status: 403 }
    );
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  try {
    if (sessionCookie) {
      const decodedClaims = await adminAuth.verifySessionCookie(
        sessionCookie
      );
      await adminAuth.revokeRefreshTokens(decodedClaims.uid);
    }

    const response = NextResponse.json({ success: true });
    clearSessionCookie(response, request);
    return response;
  } catch (error) {
    console.error("Logout failed:", error);

    const response = NextResponse.json(
      { success: false, message: "Unable to log out" },
      { status: 500 }
    );
    clearSessionCookie(response, request);
    return response;
  }
}
