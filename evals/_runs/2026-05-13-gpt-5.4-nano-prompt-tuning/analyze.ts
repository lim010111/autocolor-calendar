#!/usr/bin/env tsx
/**
 * Analyzer for PR-β 7-cell × 4-lang ledger rows.
 * Reads evals/agent-results.json, filters today's v5/v2 runs at cap=512,
 * prints a TL;DR table and §4.6 winner-gate verdict per cell.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..", "..");
const LEDGER = path.join(ROOT, "evals/agent-results.json");

type Row = {
  run_id: string;
  task_pass_rate: number | null;
  notes: string;
};

type Ledger = { runs: Row[] };

type Cell = {
  id: string;
  prompt: string;
  effort: string;
};

const CELLS: Cell[] = [
  { id: "C0a", prompt: "v2", effort: "-" },
  { id: "C0b", prompt: "v2", effort: "minimal" },
  { id: "C1a", prompt: "v5-L1", effort: "-" },
  { id: "C1b", prompt: "v5-L1", effort: "minimal" },
  { id: "C2", prompt: "v5-L2", effort: "-" },
  { id: "C4", prompt: "v5-L4", effort: "-" },
  { id: "C5", prompt: "v5-L5", effort: "-" },
];
const LANGS = ["en", "ko", "zh-CN", "zh-TW"] as const;
type Lang = (typeof LANGS)[number];

function parseNote(n: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of n.split(";")) {
    const t = part.trim();
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

function findRow(rows: Row[], lang: Lang, cell: Cell): Row | null {
  // Walk from latest first. Cell matches when:
  //   - notes.prompt_version == cell.prompt
  //   - notes.lang == lang
  //   - notes.max_completion_tokens == 512
  //   - effort matches (`-` ⇒ note absent, else equal)
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (!r.notes) continue;
    const m = parseNote(r.notes);
    if (m["prompt_version"] !== cell.prompt) continue;
    if (m["lang"] !== lang) continue;
    if (m["max_completion_tokens"] !== "512") continue;
    const noteEffort = m["reasoning_effort"];
    if (cell.effort === "-") {
      if (noteEffort !== undefined) continue;
    } else {
      if (noteEffort !== cell.effort) continue;
    }
    return r;
  }
  return null;
}

function num(s: string | undefined): number | null {
  if (s === undefined || s === "null") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

function main(): void {
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger;
  const grid: Record<string, Record<Lang, ReturnType<typeof parseNote> | null>> = {};
  for (const c of CELLS) {
    grid[c.id] = { en: null, ko: null, "zh-CN": null, "zh-TW": null };
    for (const lang of LANGS) {
      const row = findRow(ledger.runs, lang, c);
      grid[c.id]![lang] = row ? parseNote(row.notes) : null;
    }
  }

  // TL;DR table
  console.log("\n== TL;DR — accuracy / bad / mean_r / p95_r per (cell, lang) ==\n");
  const head = ["cell", "prompt", "effort", ...LANGS.flatMap((l) => [`${l}.acc`, `${l}.bad`, `${l}.meanR`, `${l}.p95R`])];
  console.log(head.join("\t"));
  for (const c of CELLS) {
    const cells: string[] = [c.id, c.prompt, c.effort];
    for (const l of LANGS) {
      const m = grid[c.id]![l];
      cells.push(m?.["accuracy"] ?? "·");
      cells.push(m?.["bad_response_rate"] ?? "·");
      cells.push(m?.["mean_reasoning_tokens"] ?? "·");
      cells.push(m?.["p95_reasoning_tokens"] ?? "·");
    }
    console.log(cells.join("\t"));
  }

  // Winner gate §4.6
  console.log("\n== Winner gate §4.6 ==\n");
  const c0a = grid["C0a"]!;
  const c0aAcc: Record<Lang, number | null> = {
    en: num(c0a.en?.["accuracy"]),
    ko: num(c0a.ko?.["accuracy"]),
    "zh-CN": num(c0a["zh-CN"]?.["accuracy"]),
    "zh-TW": num(c0a["zh-TW"]?.["accuracy"]),
  };
  const c0aMeanR: Record<Lang, number | null> = {
    en: num(c0a.en?.["mean_reasoning_tokens"]),
    ko: num(c0a.ko?.["mean_reasoning_tokens"]),
    "zh-CN": num(c0a["zh-CN"]?.["mean_reasoning_tokens"]),
    "zh-TW": num(c0a["zh-TW"]?.["mean_reasoning_tokens"]),
  };
  console.log("C0a (V2 same-day baseline) accuracy:", c0aAcc);
  console.log("C0a mean_reasoning_tokens:", c0aMeanR);
  console.log("");

  for (const c of CELLS) {
    if (c.id === "C0a") continue;
    const cell = grid[c.id]!;
    // P1: bad_response_rate = 0 on every lang
    const p1: Record<Lang, boolean | null> = {} as Record<Lang, boolean | null>;
    const p2: Record<Lang, boolean | null> = {} as Record<Lang, boolean | null>;
    const q1: Record<Lang, boolean | null> = {} as Record<Lang, boolean | null>;
    const c1: Record<Lang, boolean | null> = {} as Record<Lang, boolean | null>;
    const c2: Record<Lang, boolean | null> = {} as Record<Lang, boolean | null>;
    for (const l of LANGS) {
      const m = cell[l];
      if (!m) {
        p1[l] = null;
        p2[l] = null;
        q1[l] = null;
        c1[l] = null;
        c2[l] = null;
        continue;
      }
      const bad = num(m["bad_response_rate"]);
      const p95 = num(m["p95_reasoning_tokens"]);
      const acc = num(m["accuracy"]);
      const meanR = num(m["mean_reasoning_tokens"]);
      const baseAcc = c0aAcc[l];
      const baseMeanR = c0aMeanR[l];
      p1[l] = bad === 0;
      p2[l] = p95 !== null && p95 <= 60;
      q1[l] = baseAcc !== null && acc !== null ? acc >= baseAcc + 0.02 : null;
      c1[l] = baseAcc !== null && acc !== null ? acc >= baseAcc - 0.01 : null;
      c2[l] = baseMeanR !== null && meanR !== null ? meanR <= baseMeanR * 0.7 : null;
    }
    const allP1 = Object.values(p1).every((v) => v === true);
    const allP2 = Object.values(p2).every((v) => v === true);
    const allQ1 = Object.values(q1).every((v) => v === true);
    const allC1 = Object.values(c1).every((v) => v === true);
    const allC2 = Object.values(c2).every((v) => v === true);
    const qualityWinner = allP1 && allQ1;
    const costWinner = allP1 && allP2 && allC1 && allC2;
    console.log(`${c.id} (${c.prompt} effort=${c.effort})`);
    console.log(`  P1 bad=0:`, p1, allP1 ? "✓" : "✗");
    console.log(`  P2 p95≤60:`, p2, allP2 ? "✓" : "✗");
    console.log(`  Q1 acc ≥ V2+2pp:`, q1, allQ1 ? "✓" : "✗");
    console.log(`  C1 acc ≥ V2-1pp:`, c1, allC1 ? "✓" : "✗");
    console.log(`  C2 meanR ≤ V2×0.7:`, c2, allC2 ? "✓" : "✗");
    console.log(`  → quality-winner=${qualityWinner} cost-pareto-winner=${costWinner}`);
    console.log("");
  }
}

main();
