// HMAC-SHA256 request signing shared by both directions of the n8n integration.
//
//   x-lendloop-timestamp: <unix seconds>
//   x-lendloop-signature: v1=<hex(HMAC_SHA256(secret, `${timestamp}.${rawBody}`))>
//
// Binding the timestamp into the MAC and rejecting stale timestamps stops a
// captured request from being replayed later.

export const SIGNATURE_HEADER = "x-lendloop-signature";
export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

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

export async function signPayload(
  secret: string,
  rawBody: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): Promise<Record<string, string>> {
  const signature = await hmacHex(secret, `${timestamp}.${rawBody}`);
  return {
    [TIMESTAMP_HEADER]: String(timestamp),
    [SIGNATURE_HEADER]: `v1=${signature}`,
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

export async function verifySignature(
  secret: string,
  rawBody: string,
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
  const expected = `v1=${await hmacHex(secret, `${timestamp}.${rawBody}`)}`;
  return timingSafeEqual(expected, signatureHeader)
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}
