import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { RULES } from "../src/rules.js";

// The published tarball ships dist/ and nothing else that could hold sources.
// A .js.map whose "sources" point at src/*.ts is therefore a pointer at a file
// the reader can never open: dead weight that roughly doubles the download.
// tsconfig.build.json is the config npm actually builds with, so this pins the
// published artifact rather than the editor experience.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The number the README states, so a mismatch names both sides. */
function quoted(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  if (!match?.[1]) throw new Error(`README no longer states a count for ${pattern}`);
  return Number(match[1]);
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, unknown>;
}

describe("published package", () => {
  it("builds without sourcemaps for the tarball", () => {
    const raw = readFileSync(join(root, "tsconfig.build.json"), "utf8");
    // Strip // comments so the config can be parsed without a JSON5 dependency.
    const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
    const config = JSON.parse(stripped) as {
      compilerOptions: { sourceMap?: boolean; declarationMap?: boolean };
    };
    expect(config.compilerOptions.sourceMap).toBe(false);
    expect(config.compilerOptions.declarationMap).toBe(false);
  });

  it("ships only dist, README and LICENSE", () => {
    const pkg = readJson("package.json") as { files: string[] };
    expect(pkg.files).toEqual(["dist", "README.md", "LICENSE"]);
  });

  it("leaves no .js.map behind in dist", () => {
    const dist = join(root, "dist");
    if (!existsSync(dist)) return; // build has not run yet in this checkout
    const maps = readdirSync(dist, { recursive: true })
      .map((entry) => String(entry))
      .filter((entry) => entry.endsWith(".js.map"));
    expect(maps).toEqual([]);
  });

  it("keeps the published entry points where package.json says they are", () => {
    const pkg = readJson("package.json") as { bin: Record<string, string>; main: string };
    expect(pkg.bin.apidiff).toBe("./dist/cli.js");
    expect(pkg.main).toBe("./dist/index.js");
  });
  it("documents the rule table it ships, per severity", () => {
    // CI already compares the rows `--rules` prints with the size of RULES, so a
    // rule added without a README edit is caught there — but the split by
    // severity lives only in prose and in the Chinese mirror. Bind both to the
    // table: a new breaking rule breaks the sentence, the CI count does not.
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const severity = (name: string): number =>
      Object.values(RULES).filter((rule) => rule.severity === name).length;
    const breaking = severity("breaking");
    const changed = severity("changed");
    const deprecation = severity("deprecation");
    const total = Object.keys(RULES).length;

    expect(quoted(readme, /(\d+) rules today/)).toBe(total);
    expect(quoted(readme, /\*\*(\d+) breaking, \d+ changed, \d+ deprecation\*\*/)).toBe(breaking);
    expect(quoted(readme, /\*\*\d+ breaking, (\d+) changed, \d+ deprecation\*\*/)).toBe(changed);
    expect(quoted(readme, /\*\*\d+ breaking, \d+ changed, (\d+) deprecation\*\*/)).toBe(deprecation);
    expect(quoted(readme, /共 \*\*(\d+) 条规则/)).toBe(total);
    expect(breaking + changed + deprecation).toBe(total);
  });
});
