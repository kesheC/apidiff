import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { parseArgs, run } from "../src/cli.js";

const dir = mkdtempSync(join(tmpdir(), "apidiff-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const file = (name: string, body: unknown): string => {
  const path = join(dir, name);
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body), "utf8");
  return path;
};

/**
 * Run the CLI, collecting stdout and stderr separately.
 *
 * They are kept apart on purpose: the verdict owns stdout and every failure
 * belongs on stderr, so a test that merges them cannot tell the two apart.
 */
function cli(...argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(
    argv,
    (line) => out.push(line),
    (line) => err.push(line),
  );
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** A run that must print nothing on stdout: failures never pollute the pipe. */
function expectSilentStdout(result: { out: string }): void {
  expect(result.out).toBe("");
}

const oldSchema = { type: "object", properties: { id: { type: "string" } }, required: ["id"] };
const narrowed = { type: "object", properties: { id: { type: "string" } }, required: ["id"] };

describe("cli argument parsing", () => {
  it("parses the two positional documents", () => {
    const options = parseArgs(["old.json", "new.json"]);
    expect(options.oldPath).toBe("old.json");
    expect(options.newPath).toBe("new.json");
    expect(options.failOn).toBe("breaking");
    expect(options.format).toBe("text");
    expect(options.contract).toBe("auto");
  });

  it("parses every flag", () => {
    const options = parseArgs(["a", "b", "--contract", "env", "--format", "json", "--fail-on", "never", "--ascii", "--quiet"]);
    expect(options.contract).toBe("env");
    expect(options.format).toBe("json");
    expect(options.failOn).toBe("never");
    expect(options.ascii).toBe(true);
    expect(options.quiet).toBe(true);
  });

  it("maps --allow-breaking onto fail-on never", () => {
    expect(parseArgs(["a", "b", "--allow-breaking"]).failOn).toBe("never");
  });

  it("rejects an unknown option", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown option --nope/);
  });

  it("rejects a bad enum value", () => {
    expect(() => parseArgs(["--format", "yaml"])).toThrow(/--format expects/);
    expect(() => parseArgs(["--fail-on", "major"])).toThrow(/--fail-on expects/);
    expect(() => parseArgs(["--contract", "text"])).toThrow(/--contract expects/);
  });

  it("rejects three positional documents", () => {
    expect(() => parseArgs(["a", "b", "c"])).toThrow(/expected two files, got 3/);
  });
});

describe("cli behaviour", () => {
  it("prints help and exits 0", () => {
    const result = cli("--help");
    expect(result.code).toBe(0);
    expect(result.out).toContain("apidiff — semver verdict for API contract changes");
    expect(result.out).toContain("Exit codes:");
  });

  it("prints the version and exits 0", () => {
    const result = cli("--version");
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("prints the rule table with --rules", () => {
    const result = cli("--rules");
    expect(result.code).toBe(0);
    expect(result.out).toContain("schema.required.added");
    expect(result.out).toContain("BREAKING");
  });

  it("exits 2 without documents", () => {
    const result = cli();
    expect(result.code).toBe(2);
    expectSilentStdout(result);
    expect(result.err).toContain("two files are required");
  });

  it("exits 2 for a bad flag", () => {
    const result = cli("--format", "yaml");
    expect(result.code).toBe(2);
    expectSilentStdout(result);
    expect(result.err).toContain("--format expects");
    expect(result.err).toContain("run apidiff --help for usage");
  });

  it("exits 2 for a missing file", () => {
    const result = cli(join(dir, "nope.json"), join(dir, "nope2.json"));
    expect(result.code).toBe(2);
    expectSilentStdout(result);
    expect(result.err).toContain("cannot read");
  });

  it("exits 2 for invalid JSON", () => {
    const result = cli(file("broken.json", "{ not json"), file("ok.json", oldSchema));
    expect(result.code).toBe(2);
    expectSilentStdout(result);
    expect(result.err).toContain("invalid JSON in");
  });

  it("exits 0 and says compatible when nothing changed", () => {
    const result = cli(file("a.json", oldSchema), file("b.json", narrowed));
    expect(result.code).toBe(0);
    expect(result.out.split("\n")[0]).toBe("verdict: compatible (none)");
  });

  // Dropping a property from `required` removes a guarantee, so it is a major
  // bump: callers that read the field unconditionally now see it missing.
  const loosened = { type: "object", properties: { id: { type: "string" } } };

  it("exits 1 on a breaking change and reports it", () => {
    const result = cli(file("old1.json", oldSchema), file("new1.json", loosened));
    expect(result.code).toBe(1);
    expect(result.out.split("\n")[0]).toBe("verdict: breaking (major)");
    expect(result.out).toContain("schema.required.removed");
  });

  it("exits 0 on a breaking change with --allow-breaking", () => {
    const result = cli(file("old2.json", oldSchema), file("new2.json", loosened), "--allow-breaking");
    expect(result.code).toBe(0);
    expect(result.out).toContain("verdict: breaking (major)");
  });

  it("emits parseable json with --format json", () => {
    const result = cli(file("old3.json", oldSchema), file("new3.json", loosened), "--format", "json");
    const parsed = JSON.parse(result.out) as { verdict: string; total: number; findings: Array<{ rule: string }> };
    expect(parsed.verdict).toBe("breaking");
    expect(parsed.total).toBe(1);
    expect(parsed.findings[0]!.rule).toBe("schema.required.removed");
  });

  it("emits a markdown table with --format markdown", () => {
    const result = cli(file("old4.json", oldSchema), file("new4.json", loosened), "--format", "markdown");
    expect(result.out).toContain("**apidiff verdict: breaking (major)**");
    expect(result.out).toContain("| Severity | Location | Change | Rule |");
  });

  it("prints one line with --quiet", () => {
    const result = cli(file("old5.json", oldSchema), file("new5.json", loosened), "--quiet");
    expect(result.out).toBe("breaking (major)");
  });

  it("compares .env samples with --contract env", () => {
    const result = cli("--contract", "env", file("old.env", "TOKEN=a\nDB_URL=x\n"), file("new.env", "TOKEN=a\n"));
    expect(result.code).toBe(1);
    expect(result.out).toContain("env.key.removed");
    expect(result.out).toContain("DB_URL");
  });

  it("auto-detects an OpenAPI document", () => {
    const api = (version: string): unknown => ({ openapi: version, info: { title: "T", version: "1" }, paths: {} });
    const result = cli(file("api1.json", api("3.0.3")), file("api2.json", api("3.1.0")));
    expect(result.code).toBe(1);
    expect(result.out).toContain("openapi.version.changed");
  });

  it("forces the schema differ with --contract schema", () => {
    const result = cli("--contract", "schema", file("s1.json", { type: "string" }), file("s2.json", { type: "integer" }));
    expect(result.out).toContain("schema.type.narrowed");
  });

  it("renders ascii branches with --ascii", () => {
    const result = cli(file("old6.json", oldSchema), file("new6.json", loosened), "--ascii");
    expect(result.out).not.toContain("\u251c");
    expect(result.out).toContain(" - ");
  });
});
