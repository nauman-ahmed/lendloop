// HMAC-SHA256 request signing shared by both directions of the n8n integration.
//
//   x-lendloop-timestamp: <unix seconds>
//   x-lendloop-signature: v2=<hex(HMAC_SHA256(secret, `${timestamp}\n${METHOD}\n${path}\n${rawBody}`))>
//
// - The timestamp is inside the MAC and stale timestamps are rejected, so a
//   captured request can't be replayed later.
// - The method and path are inside the MAC, so a request signed for one
//   endpoint is rejected by every other endpoint that shares the secret.
// - Newlines separate the fields. A URL path can't contain a raw newline, so
//   no two (method, path, body) combinations produce the same signed string.

export const SIGNATURE_HEADER = "x-lendloop-signature";
export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const VERSION = "v2";

/** What a signature covers besides the timestamp. */
export type SignedRequest = { method: string; path: string; body: string };

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

function signingInput(timestamp: number, { method, path, body }: SignedRequest): string {
  return [timestamp, method.toUpperCase(), path, body].join("\n");
}

export async function signRequest(
  secret: string,
  request: SignedRequest,
  timestamp: number = Math.floor(Date.now() / 1000),
): Promise<Record<string, string>> {
  const signature = await hmacHex(secret, signingInput(timestamp, request));
  return {
    [TIMESTAMP_HEADER]: String(timestamp),
    [SIGNATURE_HEADER]: `${VERSION}=${signature}`,
  };
}

/** Constant-time comparison so response timing does not leak the signature. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Checks a signature against the endpoint that received it. Pass the method and
 * path the endpoint is registered under, not values taken from the request.
 */
export async function verifyRequest(
  secret: string,
  request: SignedRequest,
  timestampHeader: string | null,
  signatureHeader: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (!timestampHeader || !signatureHeader) {
    return { ok: false, reason: "missing signature headers" };
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "stale timestamp" };
  }
  const expected = `${VERSION}=${await hmacHex(secret, signingInput(timestamp, request))}`;
  return timingSafeEqual(expected, signatureHeader)
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}
