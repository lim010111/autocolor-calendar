import { CLASSIFIER_SYSTEM_PROMPTS } from "./_generated";

export type ClassifierPromptVersion =
  | "v2"
  | "v3"
  // v4 family — gpt-5-nano prompt-dimension experiment (2026-05-13). Three
  // "lighter" variants on en plus bilingual Korean (v4-ko) and bilingual
  // Chinese (v4-zh-CN, v4-zh-TW) variants for the H3 lang-native hypothesis.
  // Measurement-only — see
  // `.claude/handoffs/nano-prompt-experiment-2026-05-12.md`.
  | "v4-light-A"
  | "v4-light-B"
  | "v4-light-C"
  | "v4-ko"
  | "v4-zh-CN"
  | "v4-zh-TW"
  // v5 family — gpt-5.4-nano prompt-dimension experiment (2026-05-13). Four
  // lever variants on the production V2 baseline that each exercise a single
  // doc-recommended dimension from the OpenAI gpt-5.4-nano prompt-guidance
  // doc: L1 = follow-up suppression, L2 = action/report separation,
  // L4 = one-correct-example extreme, L5 = literal-first matching.
  // Measurement-only — see
  // `.claude/handoffs/gpt-5.4-nano-prompt-tuning-2026-05-13.md`.
  | "v5-L1"
  | "v5-L2"
  | "v5-L4"
  | "v5-L5"
  // v6 — ADR-0004 #05 (2026-07-17). v2 verbatim + one field-handling line
  // teaching the model the category `examples` field (user-confirmed past
  // titles from Instant Feedback, structured field in the user payload).
  | "v6";

// Production default. v3 is gpt-5-nano-targeted; production runs on
// gpt-5.4-nano against which v3 is unmeasured, so the default stays at v2
// (verbatim of the inline literal that shipped 2026-05-10) until a follow-up
// PR validates v3 on 5.4-nano or migrates the model. The eval runner can
// override with `--prompt-version v3`.
//
// v6 (ADR-0004 #05 examples-field line) is authored and registered but NOT
// yet the default: the src/AGENTS.md §5.3 rule is "bump only when the
// eval-gate has passed", and the 3-gate run was blocked 2026-07-17 by an
// invalid operator OPENAI_API_KEY (401). Flip to "v6" in the follow-up that
// re-runs the gate. Until then production sends `examples: []` under the v2
// system prompt — a no-op difference, since the dark build stores zero
// examples.
export const DEFAULT_CLASSIFIER_PROMPT_VERSION: ClassifierPromptVersion = "v2";

// ADR-0004 #05 / ADR-0007 — which system prompts actually *document* the
// category `examples` field. `buildPrompt` sends the field only for these
// versions; every other version receives `examples: []`.
//
// This is the eval-gate interlock, not a feature flag. Before #05 the field
// was inert for an accidental reason — the dark build stored zero examples —
// and turning storage on would have started shipping a populated field under
// the v2 system prompt, which never mentions it. That is a material change to
// model input, and src/CLAUDE.md §5.3 requires the 3-gate eval run for
// exactly that. Keying on the version makes the gate mechanical: the field
// can only go live by bumping `DEFAULT_CLASSIFIER_PROMPT_VERSION` to a
// version listed here, which §5.3 already forbids without a passing gate.
//
// The eval runner is unaffected — it passes `--prompt-version v6` explicitly
// (`evals/scripts/run-classification-eval.ts`), so the examples delta is
// measurable before the flip, which is what #05's remaining AC needs.
//
// Add a version here in the same PR that authors it, never later.
const PROMPT_VERSIONS_WITH_EXAMPLES_FIELD: ReadonlySet<ClassifierPromptVersion> =
  new Set<ClassifierPromptVersion>(["v6"]);

export function promptVersionSendsExamples(
  version: ClassifierPromptVersion,
): boolean {
  return PROMPT_VERSIONS_WITH_EXAMPLES_FIELD.has(version);
}

export function loadClassifierPrompt(
  version: ClassifierPromptVersion = DEFAULT_CLASSIFIER_PROMPT_VERSION,
): string {
  const body = (CLASSIFIER_SYSTEM_PROMPTS as Record<string, string | undefined>)[version];
  if (body === undefined) {
    throw new Error(`unknown classifier prompt version: ${version}`);
  }
  return body;
}
