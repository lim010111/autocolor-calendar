import * as path from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// The watch module's privacy seam is structural, not prose: registerWatchChannel
// / stopWatchChannel are importable only by siblings inside src/services/watch/.
// These tests lint synthetic fixtures through the project's real eslint config
// (not a regex over the config text) so a misconfigured glob or a dropped
// override is caught behaviourally. Mirrors src/CLAUDE.md "Watch self-heal".

const here = path.dirname(new URL(import.meta.url).pathname);
const eslint = new ESLint();

async function lintImport(fromFile: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: path.resolve(here, fromFile),
  });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "");
}

describe("watch module privacy seam (eslint no-restricted-imports)", () => {
  it("forbids importing registerWatchChannel from outside src/services/watch/", async () => {
    const rules = await lintImport(
      "../routes/_seam_fixture.ts",
      'import { registerWatchChannel } from "../services/watch/core";\nregisterWatchChannel;\n',
    );
    expect(rules).toContain("no-restricted-imports");
  });

  it("forbids importing stopWatchChannel from outside src/services/watch/", async () => {
    const rules = await lintImport(
      "../routes/_seam_fixture.ts",
      'import { stopWatchChannel } from "../services/watch/core";\nstopWatchChannel;\n',
    );
    expect(rules).toContain("no-restricted-imports");
  });

  it("allows watch-module siblings to import the private primitives", async () => {
    const rules = await lintImport(
      "../services/watch/_seam_fixture.ts",
      'import { stopWatchChannel } from "./core";\nstopWatchChannel;\n',
    );
    expect(rules).not.toContain("no-restricted-imports");
  });

  it("does not restrict the shared core entry point reRegisterWatch", async () => {
    const rules = await lintImport(
      "../routes/_seam_fixture.ts",
      'import { reRegisterWatch } from "../services/watch/core";\nreRegisterWatch;\n',
    );
    expect(rules).not.toContain("no-restricted-imports");
  });
});
