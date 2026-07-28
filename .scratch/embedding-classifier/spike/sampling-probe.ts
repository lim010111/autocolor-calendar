#!/usr/bin/env tsx
/**
 * embedding-classifier #07 — sampling-parameter acceptance + determinism probe.
 *
 * AC 1 evidence. Answers, against the REAL OpenAI API with the production
 * model / prompt version / payload shape:
 *   Q1. Does `gpt-5.4-nano` ACCEPT `temperature` and/or `seed`? (the
 *       `reasoning_effort=minimal` precedent says: measure, never assume)
 *   Q2. What is the agreement rate of N identical calls as production runs
 *       them today (no sampling params)?
 *   Q3. If the params are accepted, does agreement improve?
 *
 * Payload is byte-identical to the prod `llm_calls` row quoted in the issue
 * (2 categories, keyword=[name] fallback, empty examples).
 *
 * SECURITY: never prints the API key. Titles here are the operator's own
 * (already public in the issue file).
 *
 * Usage: pnpm tsx .scratch/embedding-classifier/spike/sampling-probe.ts --env .prod.vars
 */
import { config as loadEnv } from "dotenv";

import {
  DEFAULT_CLASSIFIER_PROMPT_VERSION,
  loadClassifierPrompt,
} from "../../../src/services/prompts/classifierPrompts";

const envFile = process.argv.includes("--env")
  ? process.argv[process.argv.indexOf("--env") + 1]!
  : ".dev.vars";
loadEnv({ path: envFile, override: true });
const apiKey = process.env["OPENAI_API_KEY"]!;
if (!apiKey) throw new Error(`no OPENAI_API_KEY in ${envFile}`);

const MODEL = "gpt-5.4-nano";
const URL_ = "https://api.openai.com/v1/chat/completions";
const N = 10;

const CATEGORIES = [
  { name: "개발", keywords: ["개발"], examples: [] as string[] },
  { name: "운동", keywords: ["운동"], examples: [] as string[] },
];
// The four titles the user flagged as misclassified (issue #07 table).
const TITLES = [
  "유플러스 요굼제 가입하기",
  "책 읽기(커리어 스킬)",
  "에스알포스트 지원",
  "내면소통 명상 수업",
];

const system = loadClassifierPrompt(DEFAULT_CLASSIFIER_PROMPT_VERSION);

function payload(summary: string) {
  return { categories: CATEGORIES, event: { summary, description: "", location: "" } };
}

type Extra = Record<string, unknown>;

async function call(summary: string, extra: Extra): Promise<{ status: number; answer: string }> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload(summary)) },
      ],
      max_completion_tokens: 64,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "classification",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["category_name"],
            properties: { category_name: { type: "string" } },
          },
        },
      },
      ...extra,
    }),
  });
  const text = await res.text();
  if (!res.ok) return { status: res.status, answer: text.slice(0, 300) };
  const body = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content ?? "";
  let name = "(unparseable)";
  try {
    name = (JSON.parse(content) as { category_name?: string }).category_name ?? "(missing)";
  } catch { /* keep placeholder */ }
  return { status: res.status, answer: name };
}

async function main() {
  console.log(`model=${MODEL} prompt=${DEFAULT_CLASSIFIER_PROMPT_VERSION} env=${envFile}\n`);

  // --- Q1: parameter acceptance (1 call each) ------------------------
  console.log("=== Q1: sampling-parameter acceptance ===");
  const probes: Array<[string, Extra]> = [
    ["baseline (production today)", {}],
    ["temperature: 0", { temperature: 0 }],
    ["temperature: 1", { temperature: 1 }],
    ["seed: 42", { seed: 42 }],
    ["temperature: 0 + seed: 42", { temperature: 0, seed: 42 }],
    ["top_p: 1", { top_p: 1 }],
  ];
  const accepted = new Map<string, boolean>();
  for (const [label, extra] of probes) {
    const r = await call(TITLES[0]!, extra);
    accepted.set(label, r.status === 200);
    console.log(`  ${r.status === 200 ? "ACCEPT" : "REJECT"} ${label.padEnd(28)} HTTP ${r.status}  ${r.status === 200 ? `-> ${r.answer}` : r.answer.replace(/\s+/g, " ")}`);
  }

  // --- Q2/Q3: determinism ------------------------------------------
  const configs: Array<[string, Extra]> = [["baseline", {}]];
  if (accepted.get("temperature: 0")) configs.push(["temperature: 0", { temperature: 0 }]);
  if (accepted.get("temperature: 0 + seed: 42")) configs.push(["temp0+seed", { temperature: 0, seed: 42 }]);
  else if (accepted.get("seed: 42")) configs.push(["seed only", { seed: 42 }]);

  for (const [label, extra] of configs) {
    console.log(`\n=== Q2/Q3: ${N}x identical calls — ${label} ===`);
    for (const title of TITLES) {
      const results = await Promise.all(Array.from({ length: N }, () => call(title, extra)));
      const tally = new Map<string, number>();
      for (const r of results) tally.set(r.answer, (tally.get(r.answer) ?? 0) + 1);
      const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      const top = sorted[0]!;
      console.log(
        `  "${title}"  agreement ${top[1]}/${N} (${Math.round((top[1] / N) * 100)}%)  ` +
          sorted.map(([k, v]) => `${k}:${v}`).join(" "),
      );
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
