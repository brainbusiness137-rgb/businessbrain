import { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "businessbrain_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 5;

function configuredAllowedOrigins(): string[] {
  return (process.env.AUTH_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

export function isAllowedAuthOrigin(origin: string | null): boolean {
  if (!origin) {
    return false;
  }

  const allowedOrigins = new Set(configuredAllowedOrigins());

  if (process.env.NODE_ENV !== "production") {
    allowedOrigins.add("http://localhost:3000");
    allowedOrigins.add("http://127.0.0.1:3000");
  }

  try {
    return allowedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function sessionCookieOptions(request: NextRequest) {
  const origin = request.headers.get("origin");
  let isHttpsOrigin = false;

  if (origin) {
    try {
      isHttpsOrigin = new URL(origin).protocol === "https:";
    } catch {
      isHttpsOrigin = false;
    }
  }

  return {
    httpOnly: true,
    secure:
      process.env.NODE_ENV === "production" ||
      isHttpsOrigin ||
      request.nextUrl.protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
  };
}

export function clearSessionCookie(
  response: NextResponse,
  request: NextRequest
): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...sessionCookieOptions(request),
    maxAge: 0,
    expires: new Date(0),
  });
}
