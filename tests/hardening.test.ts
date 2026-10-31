import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { run } from "../src/cli.js";
import { RULES } from "../src/rules.js";
import { diffDetect } from "../src/index.js";
import { diffSchemas } from "../src/schema-diff.js";

/**
 * Regressions for defects found by reviewing the shipped CLI as a black box.
 *
 * Each case documents the command it reproduces and the wrong answer the old
 * build gave; they are grouped by the defect they pin down, not by module.
 */
const dir = mkdtempSync(join(tmpdir(), "apidiff-hardening-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let counter = 0;
const file = (name: string, body: unknown): string => {
  const path = join(dir, name);
  writeFileSync(path, typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  return path;
};
const unique = (name: string): string => (counter += 1) + "-" + name;

function cli(...argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, (line) => out.push(line), (line) => err.push(line));
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("P0-1 auto-detects .env instead of parsing it as JSON", () => {
  it("picks the env differ for a .env file name", () => {
    const oldFile = file(unique("old.env"), "API_URL=http://x\nDB_URL=postgres://y\n");
    const newFile = file(unique("new.env"), "API_URL=http://x\n");
    const result = cli(oldFile, newFile);
    expect(result.code).toBe(1);
    expect(result.out).toContain("env.key.removed");
    expect(result.out).toContain("DB_URL");
    expect(result.err).toBe("");
  });

  it("picks the env differ by content when the file has no .env in its name", () => {
    const oldFile = file(unique("config-a.txt"), "API_URL=http://x\nDB_URL=postgres://y\n");
    const newFile = file(unique("config-b.txt"), "API_URL=http://x\n");
    const result = cli(oldFile, newFile);
    expect(result.code).toBe(1);
    expect(result.out).toContain("DB_URL");
  });

  it("does not mistake JSON for a dotenv sample", () => {
    const oldFile = file(unique("a.json"), { type: "object" });
    const newFile = file(unique("b.json"), { type: "object" });
    expect(cli(oldFile, newFile).out).toContain("no contract differences found");
  });

  it("refuses a pair where only one side is an environment file", () => {
    const oldFile = file(unique("only.env"), "API_URL=http://x\n");
    const newFile = file(unique("only.json"), { type: "object" });
    const result = cli(oldFile, newFile);
    expect(result.code).toBe(2);
    expect(result.err).toContain("is an environment file but");
  });
});

describe("P0-2 errors leave on stderr, so stdout stays clean", () => {
  it("writes an unreadable input to stderr only", () => {
    const result = cli(join(dir, "definitely-missing.json"), join(dir, "also-missing.json"));
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toContain("error: cannot read");
  });

  it("writes a usage error to stderr only", () => {
    const result = cli("--nope");
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toContain("unknown option --nope");
    expect(result.err).toContain("run apidiff --help for usage");
  });

  it("keeps a successful run silent on stderr", () => {
    const oldFile = file(unique("ok-a.json"), { type: "object" });
    const newFile = file(unique("ok-b.json"), { type: "object" });
    const result = cli(oldFile, newFile);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
  });
});

describe("P0-3 --format json still prints parseable JSON when the run fails", () => {
  it("emits an error document on stdout and the sentence on stderr", () => {
    const result = cli("--format", "json", join(dir, "nope-one.json"), join(dir, "nope-two.json"));
    expect(result.code).toBe(2);
    const parsed = JSON.parse(result.out) as { error: { message: string }; exitCode: number };
    expect(parsed.exitCode).toBe(2);
    expect(parsed.error.message).toContain("cannot read");
    expect(result.err).toContain("error: cannot read");
  });

  it("emits JSON even when the flags themselves are wrong", () => {
    const result = cli("--nope", "--format", "json");
    const parsed = JSON.parse(result.out) as { error: { message: string } };
    expect(parsed.error.message).toContain("unknown option --nope");
    expect(result.err).toContain("error: unknown option --nope");
  });

  it("falls back to text when the format value is not valid", () => {
    const result = cli("--format", "yaml");
    expect(result.out).toBe("");
    expect(result.err).toContain("--format expects");
  });
});

describe("P1-4 the document root renders as a location", () => {
  it("labels a root finding with / in text output", () => {
    const oldFile = file(unique("root-a.json"), { type: "string" });
    const newFile = file(unique("root-b.json"), { type: "object", properties: {} });
    const result = cli(oldFile, newFile);
    expect(result.code).toBe(1);
    expect(result.out).toContain("BREAKING     /");
  });

  it("keeps the machine-readable pointer empty for the root", () => {
    const oldFile = file(unique("root-c.json"), { type: "string" });
    const newFile = file(unique("root-d.json"), { type: "object", properties: {} });
    const parsed = JSON.parse(cli("--format", "json", oldFile, newFile).out) as {
      findings: { pointer: string; id: string }[];
    };
    expect(parsed.findings[0]!.pointer).toBe("");
    expect(parsed.findings[0]!.id).toBe("schema.type.narrowed@");
  });
});

describe("P1-5 a mixed document pair is reported, not silently mismatched", () => {
  const openapi = { openapi: "3.0.0", info: { title: "t", version: "1" }, paths: {} };
  const schema = { type: "object" };

  it("refuses OpenAPI against a JSON Schema", () => {
    const result = cli(file(unique("mix-api.json"), openapi), file(unique("mix-schema.json"), schema));
    expect(result.code).toBe(2);
    expect(result.err).toContain("pass --contract");
  });

  it("refuses JSON Schema against OpenAPI", () => {
    const result = cli(file(unique("mix-schema2.json"), schema), file(unique("mix-api2.json"), openapi));
    expect(result.code).toBe(2);
    expect(result.err).toContain("pass --contract");
  });

  it("throws a typed UsageError from the library entry point", () => {
    expect(() => diffDetect(openapi, schema)).toThrow(/pass --contract/);
  });
});

describe("P2-6 invalid UTF-8 is an error, not a silent compatible verdict", () => {
  it("rejects a file that is not valid UTF-8", () => {
    const path = join(dir, unique("bad-utf8.json"));
    writeFileSync(path, Buffer.from([0x7b, 0x22, 0x61, 0xff, 0x22, 0x3a, 0x31, 0x7d]));
    const result = cli(path, path);
    expect(result.code).toBe(2);
    expect(result.err).toContain("is not valid UTF-8");
  });

  it("still accepts a valid multi-byte file", () => {
    const path = file(unique("utf8.json"), JSON.stringify({ title: "日本語 — ünïcode" }));
    expect(cli(path, path).code).toBe(0);
  });
});

describe("P2-7 an unresolvable $ref is reported instead of ignored", () => {
  it("reports an external ref that has no loader", () => {
    const schema = { $ref: "other.json#/definitions/x" };
    const result = cli(file(unique("dangling-a.json"), schema), file(unique("dangling-b.json"), schema));
    expect(result.out).toContain("schema.ref.broken");
    expect(result.out).toContain("other.json#/definitions/x");
  });

  it("reports an in-document ref pointing at a missing anchor", () => {
    const schema = { $ref: "#/$defs/Nope" };
    const result = cli(file(unique("dangling-c.json"), schema), file(unique("dangling-d.json"), schema));
    expect(result.out).toContain("schema.ref.broken");
  });

  it("stays quiet when the registered loader resolves the ref", () => {
    const common = { $defs: { Id: { type: "string" } } };
    const schema = { $ref: "common.json#/$defs/Id" };
    const findings = diffSchemas(schema, schema, { loadDocument: () => common }).findings;
    expect(findings).toEqual([]);
  });
});

describe("P2-8 a non-schema root is refused", () => {
  it("rejects an array root in auto mode", () => {
    const result = cli(file(unique("arr-a.json"), [1, 2, 3]), file(unique("arr-b.json"), [1, 2, 3]));
    expect(result.code).toBe(2);
    expect(result.err).toContain("root is an array");
  });

  it("rejects an array root under --contract schema", () => {
    const result = cli("--contract", "schema", file(unique("arr-c.json"), [1]), file(unique("arr-d.json"), [1]));
    expect(result.code).toBe(2);
    expect(result.err).toContain("not a JSON Schema");
  });

  it("still accepts a boolean schema root", () => {
    const result = cli(file(unique("bool-a.json"), true), file(unique("bool-b.json"), false));
    expect(result.code).toBe(1);
  });
});

describe("the new rule is part of the table", () => {
  it("registers schema.ref.broken as an advisory finding", () => {
    expect(RULES["schema.ref.broken"].severity).toBe("changed");
    expect(cli("--rules").out).toContain("schema.ref.broken");
  });
});
