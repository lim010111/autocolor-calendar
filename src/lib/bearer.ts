/**
 * Parses `Authorization: Bearer <token>` headers. Returns the opaque token
 * string (trimmed) or `null` if the header is missing / not bearer / empty.
 * Keep this shared between the auth middleware and the logout route so both
 * paths return `401` for the same inputs.
 */
export function parseBearerToken(header: string | undefined | null): string | null {
  if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}
