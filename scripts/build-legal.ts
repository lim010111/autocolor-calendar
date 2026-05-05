/**
 * Build script: docs/legal/{privacy-policy,terms-of-service}.md → dist/legal/{privacy,terms}.html
 *
 * Used by Cloudflare Pages (project: autocolor-legal).
 * Pages config: Build command = `pnpm install --frozen-lockfile && pnpm legal:build`,
 *               Output directory = `dist/legal`.
 *
 * Source-of-truth: docs/runbooks/04-legal-hosting.md Step 3 (option A).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const srcDir = join(repoRoot, "docs", "legal");
const outDir = join(repoRoot, "dist", "legal");

interface Page {
  slug: string;
  src: string;
  title: string;
}

const pages: Page[] = [
  { slug: "privacy", src: "privacy-policy.md", title: "AutoColor for Calendar — 개인정보처리방침" },
  { slug: "terms", src: "terms-of-service.md", title: "AutoColor for Calendar — 서비스 이용약관" },
];

const SITE_HOME = "https://autocolorcal.app";

function template(title: string, bodyHtml: string, slug: string): string {
  const otherSlug = slug === "privacy" ? "terms" : "privacy";
  const otherLabel = slug === "privacy" ? "서비스 이용약관" : "개인정보처리방침";
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index, follow">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo",
      "Malgun Gothic", "Roboto", sans-serif;
    line-height: 1.7;
    color: #1f1f1f;
    background: #fafafa;
  }
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 48px 24px 96px;
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }
  header.site, footer.site {
    max-width: 760px;
    margin: 0 auto;
    padding: 16px 24px;
    font-size: 14px;
    color: #5f6368;
  }
  header.site a, footer.site a { color: #1a73e8; text-decoration: none; }
  header.site a:hover, footer.site a:hover { text-decoration: underline; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  h2 { font-size: 22px; margin-top: 36px; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
  h3 { font-size: 18px; margin-top: 28px; }
  h4 { font-size: 16px; margin-top: 20px; }
  p, li { font-size: 15px; }
  code {
    background: #f1f3f4;
    padding: 1px 6px;
    border-radius: 3px;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.92em;
  }
  pre {
    background: #f1f3f4;
    padding: 12px 16px;
    border-radius: 6px;
    overflow-x: auto;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 3px solid #1a73e8;
    margin: 16px 0;
    padding: 4px 16px;
    color: #5f6368;
    background: #f8f9fa;
  }
  table { border-collapse: collapse; margin: 16px 0; width: 100%; }
  th, td { border: 1px solid #e0e0e0; padding: 8px 12px; text-align: left; vertical-align: top; }
  th { background: #f1f3f4; }
  hr { border: 0; border-top: 1px solid #e0e0e0; margin: 32px 0; }
  ul, ol { padding-left: 24px; }
  a { color: #1a73e8; }
  @media (prefers-color-scheme: dark) {
    body { background: #1f1f1f; color: #e8eaed; }
    main { background: #292a2d; box-shadow: none; }
    header.site, footer.site { color: #9aa0a6; }
    h2 { border-bottom-color: #3c4043; }
    code, pre { background: #3c4043; }
    blockquote { background: #2d2e31; border-left-color: #8ab4f8; color: #9aa0a6; }
    th { background: #3c4043; }
    th, td { border-color: #3c4043; }
    hr { border-top-color: #3c4043; }
    a, header.site a, footer.site a { color: #8ab4f8; }
  }
</style>
</head>
<body>
<header class="site">
  <a href="${SITE_HOME}">AutoColor for Calendar</a>
</header>
<main>
${bodyHtml}
</main>
<footer class="site">
  <a href="${SITE_HOME}/${otherSlug}">${otherLabel}</a>
  &nbsp;·&nbsp;
  <a href="${SITE_HOME}">홈</a>
</footer>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function buildPage(page: Page): Promise<void> {
  const md = await readFile(join(srcDir, page.src), "utf8");
  const html = await marked.parse(md, { gfm: true, breaks: false });
  const out = template(page.title, html, page.slug);
  const outPath = join(outDir, `${page.slug}.html`);
  await writeFile(outPath, out, "utf8");
  console.log(`  ✓ ${page.src} → dist/legal/${page.slug}.html (${out.length.toLocaleString()} bytes)`);
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  console.log(`legal:build → ${outDir}`);
  for (const page of pages) {
    await buildPage(page);
  }
}

main().catch((err) => {
  console.error("legal:build failed:", err);
  process.exit(1);
});
