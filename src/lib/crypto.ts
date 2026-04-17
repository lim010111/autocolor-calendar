import { fromBase64Url, randomBytes } from "./random";

// `fromBase64Url` accepts both base64url (`-`/`_`) and base64 (`+`/`/`) input
// because it normalizes before decoding, so we can pass either flavor of key
// material through a single decoder.
async function importAesKey(base64Key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    fromBase64Url(base64Key),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function importHmacKey(base64Key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    fromBase64Url(base64Key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function aesGcmEncrypt(
  base64Key: string,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const key = await importAesKey(base64Key);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    plaintext,
  );
  return { iv, ciphertext: new Uint8Array(ct) };
}

export async function aesGcmDecrypt(
  base64Key: string,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const key = await importAesKey(base64Key);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    ciphertext,
  );
  return new Uint8Array(pt);
}

export async function hmacSha256(
  base64Key: string,
  data: Uint8Array,
): Promise<Uint8Array> {
  const key = await importHmacKey(base64Key);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return new Uint8Array(sig);
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();

export { fromBase64Url };
