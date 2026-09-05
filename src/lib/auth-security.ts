import { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "businessbrain_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 5;

export const AUTH_ORIGIN_HEADER = "x-businessbrain-origin";

export function configuredAllowedOrigins(
  configured = process.env.AUTH_ALLOWED_ORIGINS ?? "",
  nodeEnv = process.env.NODE_ENV
): string[] {
  const origins = configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        const parsed = new URL(origin);
        if (
          !["http:", "https:"].includes(parsed.protocol) || parsed.username ||
          parsed.password || parsed.search || parsed.hash ||
          (parsed.pathname !== "/" && parsed.pathname !== "")
        ) return "";
        return parsed.origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  if (nodeEnv !== "production") {
    origins.push("http://localhost:3000", "http://127.0.0.1:3000");
  }
  return [...new Set(origins)];
}

function normalizedOrigin(origin: string | null): string | null {
  if (!origin || origin.includes(",") || origin.includes(" ")) return null;
  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol) &&
      parsed.origin === origin.replace(/\/$/, "") ? parsed.origin : null;
  } catch {
    return null;
  }
}

export type AuthOriginDecision = { allowed: boolean; reason: "origin" | "same-origin-client-fallback" | "missing" | "malformed" | "not-allowed" };

export function evaluateAuthRequestOrigin(
  headers: Pick<Headers, "get">,
  configured = process.env.AUTH_ALLOWED_ORIGINS ?? "",
  nodeEnv = process.env.NODE_ENV
): AuthOriginDecision {
  const allowedOrigins = new Set(configuredAllowedOrigins(configured, nodeEnv));
  const rawOrigin = headers.get("origin");
  const origin = normalizedOrigin(rawOrigin);
  if (origin && allowedOrigins.has(origin)) return { allowed: true, reason: "origin" };
  const clientOrigin = normalizedOrigin(headers.get(AUTH_ORIGIN_HEADER));
  if (clientOrigin && allowedOrigins.has(clientOrigin) && headers.get("sec-fetch-site")?.toLowerCase() === "same-origin") {
    return { allowed: true, reason: "same-origin-client-fallback" };
  }
  if (!rawOrigin && !headers.get(AUTH_ORIGIN_HEADER)) return { allowed: false, reason: "missing" };
  if ((rawOrigin && !origin) || (headers.get(AUTH_ORIGIN_HEADER) && !clientOrigin)) return { allowed: false, reason: "malformed" };
  return { allowed: false, reason: "not-allowed" };
}

export function isAllowedAuthOrigin(origin: string | null): boolean {
  return evaluateAuthRequestOrigin({ get: (name) => name === "origin" ? origin : null }).allowed;
}

export function sessionCookieOptions(request: NextRequest) {
  const isHttpsOrigin = [request.headers.get("origin"), request.headers.get(AUTH_ORIGIN_HEADER)]
    .some((origin) => normalizedOrigin(origin)?.startsWith("https://"));

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
