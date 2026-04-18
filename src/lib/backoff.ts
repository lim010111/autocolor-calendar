const BASE_SECONDS = 15;
const MAX_SECONDS = 3600;
const JITTER_MAX_SECONDS = 10;

// Exponential backoff with full jitter: min(cap, 2^attempt * base + rand(0..jitter)).
// `attempt` is 1-based to match Cloudflare Queues' `Message.attempts` semantics
// (first retry → attempts=1 → 30s; second → 60s; third → 120s, ...).
// Callers pass `msg.attempts` directly — do not subtract 1, or the first
// retry drops to 15s and risks hammering upstream APIs during transient 5xx.
export function computeBackoffSeconds(
  attempt: number,
  randomFn: () => number = Math.random,
): number {
  const exp = Math.min(MAX_SECONDS, Math.pow(2, attempt) * BASE_SECONDS);
  const jitter = Math.floor(randomFn() * JITTER_MAX_SECONDS);
  return Math.min(MAX_SECONDS, exp + jitter);
}
