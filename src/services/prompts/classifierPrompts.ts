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
  | "v6"
  // v7 — ec#07 (2026-08-06). v6 verbatim + none-first membership
  // strengthening: sparse category lists (1–3 rules) must not absorb
  // unrelated events. Targets the prod 2026-07-28 Stage-2 over-assignment
  // (52/56 hits on one category; 4 user-confirmed misclassifications).
  | "v7"
  // v8 — ec#07 promotion (2026-08-07). v7 verbatim MINUS the examples
  // field-handling line, so promoting it does NOT document the category
  // `examples` field and the §12/§2.5 examples-transmission interlock stays
  // closed. Examples go live later via a WITH_EXAMPLES version + §12 notice.
  | "v8";

// Production default. v8 = the ec#07 none-first prompt (v7) minus the
// examples field-handling line. Promoted 2026-08-07 by user decision
// (objective function: false-apply ≫ miss — all 4 prod-confirmed
// misclassifications were over-assignments; a missed color is one-tap
// recoverable via Instant Feedback). Eval gates passed on v8 DIRECTLY:
// regression 24/24 (all user-report-* blocking cases, synthetic-title
// generalization verified) and the same-day paired 4-language run vs fresh
// v2 — en +3.6%p (91.1%) / ko ±0.0 / zh-CN +2.6%p / zh-TW ±0.0, every
// language ≥ −1%p, so the ko regression measured on v7 (−2.6%p) did not
// reproduce on v8's own paired run.
//
// v8 deliberately stays OUT of PROMPT_VERSIONS_WITH_EXAMPLES_FIELD: bumping
// the default to a WITH_EXAMPLES version (v6/v7) is what starts shipping
// consented example titles to OpenAI, which privacy-policy §2.5 pins as a
// §12 material change requiring 30-day notice + §4/§4.1 revision FIRST.
//
// v6 (ADR-0004 #05 examples-field line) remains registered but not default;
// its promotion rides the future examples-transmission decision above.
export const DEFAULT_CLASSIFIER_PROMPT_VERSION: ClassifierPromptVersion = "v8";

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
  new Set<ClassifierPromptVersion>(["v6", "v7"]);

export function promptVersionSendsExamples(
  version: ClassifierPromptVersion,
): boolean {
  return PROMPT_VERSIONS_WITH_EXAMPLES_FIELD.has(version);
}

// ADR-0007 — mirror of the `examples` interlock above, for the category
// `description` field. NO current version (v2..v8) documents a category
// `description` field, so the set is empty and `buildPrompt` strips the
// field for every version. When a future system prompt documents the field
// AND passes the §5.3 eval-gate, list that version here in the same PR that
// authors it — never earlier, never later. (The eval harness reproduces
// description experiments via `buildPrompt`'s explicit
// `sendRuleDescriptions` opt-in, so this set stays about production
// defaults only.)
const PROMPT_VERSIONS_WITH_RULE_DESCRIPTIONS_FIELD: ReadonlySet<ClassifierPromptVersion> =
  new Set<ClassifierPromptVersion>([]);

export function promptVersionSendsRuleDescriptions(
  version: ClassifierPromptVersion,
): boolean {
  return PROMPT_VERSIONS_WITH_RULE_DESCRIPTIONS_FIELD.has(version);
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
