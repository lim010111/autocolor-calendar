#!/usr/bin/env tsx
/**
 * embedding-classifier #11 — logprobs acceptance + confidence-signal probe.
 *
 * The 2-vote recheck resamples the model to estimate its confidence — the
 * 3rd-party review asked whether `logprobs` could give the same signal in
 * ONE call. Three questions, against the real API with the prod payload
 * shape (mirrors sampling-probe.ts):
 *   Q1. Does `gpt-5.4-nano` ACCEPT `logprobs` / `top_logprobs`? (HTTP)
 *   Q2. Does the response actually CONTAIN logprobs? (this model has form:
 *       temperature/seed were accepted-then-ignored — sampling-probe 07-28)
 *   Q3. If present, does per-token confidence separate the stable verdicts
 *       from the flip-prone ones (the #07 nondeterminism cases)?
 *
 * Titles are the ANONYMIZED regression set (fixture-swap, 2026-08-06) — same
 * failure structure as the prod 4, no real calendar text in this file.
 *
 * Usage: pnpm tsx .scratch/embedding-classifier/spike/logprobs-probe.ts --env .dev.vars
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
const N = 6;

const CATEGORIES = [
  { name: "개발", keywords: ["개발"], examples: [] as string[] },
  { name: "운동", keywords: ["운동"], examples: [] as string[] },
];
// Anonymized #07 regression titles (2 stable + 2 flip-prone under v2; v8
// answers none on all four) + 2 synthetic PAINT-side cases so the probe also
// sees confidence when the model assigns a category.
const TITLES = [
  "알뜰폰 요금제 알아보기", // stable none (10/10 in sampling-probe)
  "한올물류 입사 지원", // stable 개발 (10/10) — v8: none
  "책 읽기(자기계발)", // flip-prone (8/10)
  "호흡 명상 수업", // flip-prone (8/10)
  "등, 가슴 근력운동", // clear paint — expect 운동, high confidence
  "개발 서적 읽기", // borderline paint — dev-adjacent reading, 개발 vs none
];

const system = loadClassifierPrompt(DEFAULT_CLASSIFIER_PROMPT_VERSION);

type TokenLp = { token: string; logprob: number; top_logprobs?: Array<{ token: string; logprob: number }> };

async function call(
  summary: string,
  extra: Record<string, unknown>,
): Promise<{ status: number; answer: string; tokens: TokenLp[] | null; raw?: string }> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({
            categories: CATEGORIES,
            event: { summary, description: "", location: "" },
          }),
        },
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
  if (!res.ok) return { status: res.status, answer: "", tokens: null, raw: text.slice(0, 300) };
  const body = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string }; logprobs?: { content?: TokenLp[] } | null }>;
  };
  const content = body.choices?.[0]?.message?.content ?? "";
  let name = "(unparseable)";
  try {
    name = (JSON.parse(content) as { category_name?: string }).category_name ?? "(missing)";
  } catch { /* keep placeholder */ }
  return { status: res.status, answer: name, tokens: body.choices?.[0]?.logprobs?.content ?? null };
}

function summarize(tokens: TokenLp[]): { total: number; min: number; minTok: TokenLp } {
  let total = 0;
  let min = Infinity;
  let minTok = tokens[0]!;
  for (const t of tokens) {
    total += t.logprob;
    if (t.logprob < min) {
      min = t.logprob;
      minTok = t;
    }
  }
  return { total, min, minTok };
}

async function main() {
  console.log(`model=${MODEL} prompt=${DEFAULT_CLASSIFIER_PROMPT_VERSION} env=${envFile}\n`);

  console.log("=== Q1/Q2: acceptance + actual presence ===");
  const probes: Array<[string, Record<string, unknown>]> = [
    ["logprobs: true", { logprobs: true }],
    ["logprobs + top_logprobs: 4", { logprobs: true, top_logprobs: 4 }],
  ];
  let working: Record<string, unknown> | null = null;
  for (const [label, extra] of probes) {
    const r = await call(TITLES[0]!, extra);
    const present = r.tokens !== null && r.tokens.length > 0;
    console.log(
      `  ${r.status === 200 ? "ACCEPT" : "REJECT"} ${label.padEnd(28)} HTTP ${r.status}  ` +
        (r.status === 200
          ? `logprobs ${present ? `PRESENT (${r.tokens!.length} tokens)` : "ABSENT/null"} -> ${r.answer}`
          : (r.raw ?? "").replace(/\s+/g, " ")),
    );
    if (r.status === 200 && present) working = extra;
  }
  if (!working) {
    console.log("\nVERDICT: logprobs unusable on this model — confidence gate needs another signal.");
    return;
  }

  console.log(`\n=== Q3: ${N}x per title — does confidence separate stable vs flip-prone? ===`);
  for (const title of TITLES) {
    const results = await Promise.all(Array.from({ length: N }, () => call(title, working!)));
    const tally = new Map<string, { n: number; totals: number[]; mins: number[] }>();
    let altNote = "";
    for (const r of results) {
      if (!r.tokens) continue;
      const s = summarize(r.tokens);
      const e = tally.get(r.answer) ?? { n: 0, totals: [], mins: [] };
      e.n += 1;
      e.totals.push(s.total);
      e.mins.push(s.min);
      tally.set(r.answer, e);
      if (!altNote && s.minTok.top_logprobs?.length) {
        altNote = s.minTok.top_logprobs
          .slice(0, 4)
          .map((a) => `${JSON.stringify(a.token)}:${a.logprob.toFixed(2)}`)
          .join(" ");
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const parts = [...tally.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([k, v]) => `${k}:${v.n} (Σlp ${mean(v.totals).toFixed(2)}, min ${mean(v.mins).toFixed(2)})`);
    console.log(`  "${title}"\n    ${parts.join("  |  ")}\n    min-token alts: ${altNote || "(none)"}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
