// Public surface of the Watch channel lifecycle module.
//
// Only ENTRY POINTS are exported here — the registration core's
// `registerWatchChannel` / `stopWatchChannel` stay module-private (importable
// by siblings inside this folder only, enforced by the ESLint
// `no-restricted-imports` seam in eslint.config.js). New code paths that need
// to (re)register a watch channel compose one of these entry points; they must
// NOT reach for the bare register/stop primitives. See `src/CLAUDE.md`
// "Watch self-heal" for the contract this folder structurally enforces.

export { bootstrapUserSync } from "./bootstrap";
export type { BootstrapOutcome } from "./bootstrap";
export { maybeSelfHealWatch } from "./selfHeal";
export { renewExpiringWatches } from "./renewal";
export type { RenewalSummary } from "./renewal";
export { reconnectWatch } from "./reconnect";
export type { ReconnectResult } from "./reconnect";
export { teardownWatchesForUser } from "./teardown";
export { lookupChannelOwner, verifyChannelToken } from "./receipt";
export type { ChannelLookup } from "./receipt";
