import { OAUTH_STATE_TTL_MS } from "../config/constants";
import { hmacSha256, textEncoder, timingSafeEqual } from "./crypto";
import { fromBase64Url, randomBytes, toBase64Url } from "./random";

type StatePayload = { nonce: string; iat: number };

export async function signState(hmacKey: string): Promise<string> {
  const payload: StatePayload = {
    nonce: toBase64Url(randomBytes(16)),
    iat: Date.now(),
  };
  const body = textEncoder.encode(JSON.stringify(payload));
  const sig = await hmacSha256(hmacKey, body);
  return `${toBase64Url(body)}.${toBase64Url(sig)}`;
}

export async function verifyState(hmacKey: string, state: string): Promise<boolean> {
  const parts = state.split(".");
  if (parts.length !== 2) return false;
  const [bodyB64, sigB64] = parts as [string, string];
  let body: Uint8Array;
  let providedSig: Uint8Array;
  try {
    body = fromBase64Url(bodyB64);
    providedSig = fromBase64Url(sigB64);
  } catch {
    return false;
  }

  const expectedSig = await hmacSha256(hmacKey, body);
  if (!timingSafeEqual(expectedSig, providedSig)) return false;

  let payload: StatePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(body)) as StatePayload;
  } catch {
    return false;
  }

  if (typeof payload.iat !== "number") return false;
  if (Date.now() - payload.iat > OAUTH_STATE_TTL_MS) return false;
  return true;
}
