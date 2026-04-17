const BASE_SECONDS = 15;
const MAX_SECONDS = 3600;
const JITTER_MAX_SECONDS = 10;

// Exponential backoff with full jitter: min(cap, 2^attempt * base + rand(0..jitter)).
// `attempt` is 0-indexed (first retry = 0).
export function computeBackoffSeconds(
  attempt: number,
  randomFn: () => number = Math.random,
): number {
  const exp = Math.min(MAX_SECONDS, Math.pow(2, attempt) * BASE_SECONDS);
  const jitter = Math.floor(randomFn() * JITTER_MAX_SECONDS);
  return Math.min(MAX_SECONDS, exp + jitter);
}
