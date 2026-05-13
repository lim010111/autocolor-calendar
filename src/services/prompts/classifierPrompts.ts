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
  | "v4-zh-TW";

// Production default. v3 is gpt-5-nano-targeted; production runs on
// gpt-5.4-nano against which v3 is unmeasured, so the default stays at v2
// (verbatim of the inline literal that shipped 2026-05-10) until a follow-up
// PR validates v3 on 5.4-nano or migrates the model. The eval runner can
// override with `--prompt-version v3`.
export const DEFAULT_CLASSIFIER_PROMPT_VERSION: ClassifierPromptVersion = "v2";

export function loadClassifierPrompt(
  version: ClassifierPromptVersion = DEFAULT_CLASSIFIER_PROMPT_VERSION,
): string {
  const body = (CLASSIFIER_SYSTEM_PROMPTS as Record<string, string | undefined>)[version];
  if (body === undefined) {
    throw new Error(`unknown classifier prompt version: ${version}`);
  }
  return body;
}
