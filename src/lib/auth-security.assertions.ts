import { strict as assert } from "node:assert";
import { NextRequest } from "next/server";
import { AUTH_ORIGIN_HEADER, configuredAllowedOrigins, evaluateAuthRequestOrigin, sessionCookieOptions, SESSION_COOKIE_MAX_AGE_SECONDS, SESSION_COOKIE_NAME } from "@/lib/auth-security";

function headers(values: Record<string, string | undefined>): Pick<Headers, "get"> {
  const normalized = new Map(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => normalized.get(name.toLowerCase()) ?? null };
}
const codespace = "https://bug-free-umbrella-gx7r4wppvpwjc9j6g-3000.app.github.dev";

export function runAuthSecurityAssertions() {
  assert.equal(evaluateAuthRequestOrigin(headers({ origin: codespace }), codespace, "development").allowed, true, "exact configured HTTPS origin is accepted");
  assert.deepEqual(configuredAllowedOrigins(`${codespace}/`, "production"), [codespace], "configured trailing slash is normalized");
  assert.deepEqual(configuredAllowedOrigins(` ${codespace}/ , https://example.com `, "production"), [codespace, "https://example.com"], "multiple whitespace-padded origins are normalized");
  assert.equal(evaluateAuthRequestOrigin(headers({ origin: "https://evil.example" }), codespace, "production").allowed, false, "unconfigured external origin is rejected");
  assert.equal(evaluateAuthRequestOrigin(headers({ origin: "not a url" }), codespace, "production").reason, "malformed", "malformed origin is rejected safely");
  assert.equal(evaluateAuthRequestOrigin(headers({}), codespace, "production").allowed, false, "missing origin evidence fails closed");
  assert.equal(evaluateAuthRequestOrigin(headers({ origin: "http://localhost:3000" }), "", "development").allowed, true, "localhost development remains narrowly allowed");
  assert.equal(evaluateAuthRequestOrigin(headers({ origin: "http://localhost:3001" }), "", "development").allowed, false, "unapproved localhost ports are rejected");
  assert.equal(evaluateAuthRequestOrigin(headers({ [AUTH_ORIGIN_HEADER]: codespace, "sec-fetch-site": "same-origin" }), codespace, "development").reason, "same-origin-client-fallback", "Codespaces fallback catches a missing proxy Origin");
  assert.equal(evaluateAuthRequestOrigin(headers({ origin: "http://internal:3000", [AUTH_ORIGIN_HEADER]: codespace, "sec-fetch-site": "same-origin" }), codespace, "development").allowed, true, "fallback catches a proxy-rewritten Origin");
  assert.equal(evaluateAuthRequestOrigin(headers({ [AUTH_ORIGIN_HEADER]: codespace, "sec-fetch-site": "cross-site" }), codespace, "production").allowed, false, "cross-site fallback is rejected");
  assert.equal(evaluateAuthRequestOrigin(headers({ origin: "https://random.example" }), "", "production").allowed, false, "production does not infer trust from arbitrary hosts");
  assert.equal(configuredAllowedOrigins("*", "production").length, 0, "wildcards are never accepted");
  assert.equal(configuredAllowedOrigins("https://example.com/path,ftp://example.com", "production").length, 0, "invalid configured origins are ignored");
  assert.equal(SESSION_COOKIE_NAME, "businessbrain_session");
  assert.equal(SESSION_COOKIE_MAX_AGE_SECONDS, 60 * 60 * 24 * 5, "session lifetime remains five days");
  const httpsCookie = sessionCookieOptions(new NextRequest("http://internal:3000/api/auth/session", { headers: { origin: "http://internal:3000", [AUTH_ORIGIN_HEADER]: codespace } }));
  assert.deepEqual(httpsCookie, { httpOnly: true, secure: true, sameSite: "lax", path: "/" }, "Codespaces HTTPS fallback always produces a Secure cookie");
  const localCookie = sessionCookieOptions(new NextRequest("http://localhost:3000/api/auth/session", { headers: { origin: "http://localhost:3000" } }));
  assert.deepEqual(localCookie, { httpOnly: true, secure: false, sameSite: "lax", path: "/" }, "local HTTP development retains compatible cookie flags");
}
