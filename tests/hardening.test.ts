import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { main, decodeUtf8, MAX_TEXT_BYTES, run } from "../src/cli.js";
import { RULES } from "../src/rules.js";
import { diffDetect } from "../src/index.js";
import { MAX_SCHEMA_DEPTH, diffSchemas } from "../src/schema-diff.js";

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

/**
 * M1: too big is not the same as corrupt.
 *
 * A 1 GB all-ASCII JSON used to fail inside the decoder and be reported as
 * "is not valid UTF-8", sending the user to repair a file with nothing wrong
 * with it. The decoder raises ERR_STRING_TOO_LONG; that now says so.
 */
describe("M1 an oversize document is named as oversize", () => {
  it("reports the size, not the encoding, when V8 cannot hold the text", () => {
    const tooBig = Buffer.alloc(MAX_TEXT_BYTES + 1, 0x41);
    expect(() => decodeUtf8(tooBig, "huge.json")).toThrowError(/is too large to compare/);
  });

  it("names the byte count and the limit", () => {
    const tooBig = Buffer.alloc(MAX_TEXT_BYTES + 1, 0x41);
    expect(() => decodeUtf8(tooBig, "huge.json")).toThrowError(new RegExp(String(MAX_TEXT_BYTES)));
  });

  it("leaves a genuinely malformed file with the encoding message", () => {
    const broken = Buffer.from([0x7b, 0xff, 0xfe, 0x7d]);
    expect(() => decodeUtf8(broken, "bad.json")).toThrowError(/is not valid UTF-8/);
    expect(() => decodeUtf8(broken, "bad.json")).not.toThrowError(/too large/);
  });

  it("decodes ordinary ASCII unchanged", () => {
    expect(decodeUtf8(Buffer.from('{"a":1}', "utf8"), "ok.json")).toBe('{"a":1}');
  });
});

/**
 * M2: a crash must not masquerade as a breaking change.
 *
 * Exit 1 means "a change at or above --fail-on was found". A stack overflow
 * used to escape main(), so the process died with exit 1 and zero bytes on
 * stdout -- CI saw a breaking API change that never existed.
 *
 * The engine now counts depth itself instead of waiting for the host to run out
 * of stack. That is what these cases pin: the refusal has to be the same on
 * every runtime, because the old ones were not. A 1300-deep pair produced
 * "breaking (major)" on node 20 and a RangeError on node 24, and CI -- which
 * runs both -- failed the same commit on three of its six jobs.
 */
describe("M2 a crash is reported as an error, not as a verdict", () => {
  /**
   * Build a schema nested `depth` levels, as TEXT.
   *
   * Text on purpose: JSON.stringify on the equivalent object recurses too, so
   * a fixture built that way dies of the very stack overflow under test.
   */
  const deepSchemaText = (depth: number, leaf: string): string => {
    const open = '{"type":"object","properties":{"a":'.repeat(depth);
    const close = "}}".repeat(depth);
    return open + '{"type":"' + leaf + '"}' + close;
  };

  const runMain = (argv: readonly string[]): { code: number; out: string; err: string } => {
    const out: string[] = [];
    const err: string[] = [];
    const spyOut = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
    const spyErr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      err.push(String(chunk));
      return true;
    });
    let code: number;
    try {
      code = main([...argv]);
    } finally {
      spyOut.mockRestore();
      spyErr.mockRestore();
    }
    return { code, out: out.join(""), err: err.join("") };
  };

  it("refuses nesting past the documented limit instead of overflowing", () => {
    const deepOld = file(unique("deep-old.json"), deepSchemaText(MAX_SCHEMA_DEPTH + 50, "string"));
    const deepNew = file(unique("deep-new.json"), deepSchemaText(MAX_SCHEMA_DEPTH + 50, "number"));
    const result = runMain([deepOld, deepNew]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("nest more than " + String(MAX_SCHEMA_DEPTH));
    expect(result.err).toContain("diffSchemasAt");
    expect(result.out).toBe("");
  });

  it("still emits the JSON error object when the document is too deep", () => {
    const deepOld = file(unique("deepj-old.json"), deepSchemaText(MAX_SCHEMA_DEPTH + 50, "string"));
    const deepNew = file(unique("deepj-new.json"), deepSchemaText(MAX_SCHEMA_DEPTH + 50, "number"));
    const result = runMain([deepOld, deepNew, "--format", "json"]);
    expect(result.code).toBe(2);
    const parsed = JSON.parse(result.out) as { error: { message: string }; exitCode: number };
    expect(parsed.exitCode).toBe(2);
    expect(parsed.error.message).toContain("nest more than " + String(MAX_SCHEMA_DEPTH));
  });

  it("diffs a deeply nested but workable document", () => {
    const okOld = file(unique("ok-deep-old.json"), deepSchemaText(200, "string"));
    const okNew = file(unique("ok-deep-new.json"), deepSchemaText(200, "number"));
    const result = cli(okOld, okNew);
    expect([0, 1]).toContain(result.code);
  });

  it("keeps the limit itself workable, so the boundary is not off by one", () => {
    const okOld = file(unique("edge-deep-old.json"), deepSchemaText(MAX_SCHEMA_DEPTH - 2, "string"));
    const okNew = file(unique("edge-deep-new.json"), deepSchemaText(MAX_SCHEMA_DEPTH - 2, "number"));
    const result = cli(okOld, okNew);
    expect([0, 1]).toContain(result.code);
  });
});

describe("the new rule is part of the table", () => {
  it("registers schema.ref.broken as an advisory finding", () => {
    expect(RULES["schema.ref.broken"].severity).toBe("changed");
    expect(cli("--rules").out).toContain("schema.ref.broken");
  });
});

/**
 * B1: the file NAME must never outrank the file's CONTENT.
 *
 * The dotenv auto-detect added in e1f1864 asked `looksLikeEnvName` first, so
 * a schema called `.env.a.json` was read as environment keys and reported as
 * `dev` removed -- a major bump invented out of a filename. JSON that parses
 * now wins unconditionally; a name only labels bytes the parser rejected.
 */
describe("B1 a .env prefix does not steal a JSON document", () => {
  const oldSchema = { type: "object", properties: { PORT: { type: "string" } } };
  const newSchema = { type: "object", properties: { PORT: { type: "number" } } };

  it("diffs .env.a.json / .env.b.json as schemas", () => {
    const result = cli(file(".env.a.json", oldSchema), file(".env.b.json", newSchema));
    expect(result.code).toBe(1);
    expect(result.out).toContain("schema.type.narrowed");
    expect(result.out).toContain("/properties/PORT");
    expect(result.out).not.toContain("env.key.removed");
  });

  it("agrees with the same bytes under ordinary names", () => {
    const plain = cli(file(unique("plain-old.json"), oldSchema), file(unique("plain-new.json"), newSchema));
    const dotenv = cli(file(".env.a.json", oldSchema), file(".env.b.json", newSchema));
    expect(dotenv.out).toBe(plain.out);
    expect(dotenv.code).toBe(plain.code);
  });

  it("compares two byte-identical files when one name starts with .env", () => {
    const body = { type: "object", properties: { A: { type: "string" } } };
    const result = cli(file(".env.schema.json", body), file(unique("plain-schema.json"), body));
    expect(result.code).toBe(0);
    expect(result.out).toContain("compatible");
  });

  it("still treats a real dotenv pair as environment keys", () => {
    const result = cli(file(".env", "A=1\nB=2\n"), file(".env2", "A=1\n"));
    expect(result.code).toBe(1);
    expect(result.out).toContain("env.key.removed");
  });

  it("still refuses a dotenv sample against a JSON document", () => {
    const result = cli(file(unique("mix.env"), "A=1\n"), file(unique("mix.json"), oldSchema));
    expect(result.code).toBe(2);
    expect(result.err).toContain("pass --contract");
  });

  it("still reports invalid JSON for a file that is neither", () => {
    const result = cli(file(unique("junk.txt"), "not json at all"), file(unique("ok.json"), oldSchema));
    expect(result.code).toBe(2);
    expect(result.err).toContain("invalid JSON");
  });
});
