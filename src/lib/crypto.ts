import { fromBase64Url, randomBytes } from "./random";

function keyFromBase64(base64: string): Uint8Array {
  const b64 = base64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importAesKey(base64Key: string): Promise<CryptoKey> {
  const raw = keyFromBase64(base64Key);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function importHmacKey(base64Key: string): Promise<CryptoKey> {
  const raw = keyFromBase64(base64Key);
  return crypto.subtle.importKey(
    "raw",
    raw,
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
