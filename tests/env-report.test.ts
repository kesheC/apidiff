import { describe, expect, it } from "vitest";

import { diffEnv, parseEnvKeys } from "../src/env-diff.js";
import { countBySeverity, formatJson, formatMarkdown, formatRules, formatText } from "../src/report.js";
import { verdictOf } from "../src/verdict.js";
import type { Finding, Severity } from "../src/types.js";

const finding = (severity: Severity, rule: string, pointer: string, message = rule): Finding => ({
  id: rule + "@" + pointer,
  rule,
  severity,
  pointer,
  message,
});

describe("env contract diff", () => {
  it("parses keys, skipping blanks, comments and duplicates", () => {
    const text = ["# comment", "", "API_URL=http://x", "export TOKEN=abc", "EMPTY=", "API_URL=dup", "  SPACED = 1  "].join("\n");
    expect(parseEnvKeys(text)).toEqual(["API_URL", "TOKEN", "EMPTY", "SPACED"]);
  });

  it("handles CRLF line endings", () => {
    expect(parseEnvKeys("A=1\r\nB=2\r\n")).toEqual(["A", "B"]);
  });

  it("treats a key without a value as a key", () => {
    expect(parseEnvKeys("BARE")).toEqual(["BARE"]);
  });

  it("ignores values entirely so rotating a secret is not a contract change", () => {
    expect(diffEnv("TOKEN=a\n", "TOKEN=b\n").findings).toEqual([]);
  });

  it("reports a removed key as breaking", () => {
    const result = diffEnv("TOKEN=a\nDB_URL=x\n", "TOKEN=a\n");
    expect(result.kind).toBe("env");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.rule).toBe("env.key.removed");
    expect(result.findings[0]!.severity).toBe("breaking");
    expect(result.findings[0]!.pointer).toBe("/DB_URL");
    expect(verdictOf(result.findings).bump).toBe("major");
  });

  it("reports an added key as non-breaking", () => {
    const result = diffEnv("TOKEN=a\n", "TOKEN=a\nNEW_KEY=1\n");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.rule).toBe("env.key.added");
    expect(result.findings[0]!.severity).toBe("changed");
    expect(verdictOf(result.findings).bump).toBe("minor");
  });

  it("reports nothing for identical files", () => {
    expect(diffEnv("A=1\nB=2\n", "A=1\nB=2\n").findings).toEqual([]);
  });
});

describe("report rendering", () => {
  const list = [
    finding("breaking", "schema.required.added", "/properties/a", "property a became required"),
    finding("changed", "schema.property.added", "/properties/b", "property b was added"),
  ];
  const verdict = verdictOf(list);

  it("renders a text tree with a verdict line and a summary", () => {
    const text = formatText(verdict);
    const lines = text.split("\n");
    expect(lines[0]).toBe("verdict: breaking (major)");
    expect(text).toContain("/properties/a");
    expect(text).toContain("property a became required");
    expect(lines[lines.length - 1]).toContain("1 breaking, 1 changed -> bump major");
  });

  it("renders an ascii fallback without box-drawing characters", () => {
    const text = formatText(verdict, { ascii: true });
    expect(text).not.toContain("\u251c");
    expect(text).not.toContain("\u2502");
    expect(text.split("\n")[0]).toBe("verdict: breaking (major)");
  });

  it("renders a compatible result", () => {
    const text = formatText(verdictOf([]));
    expect(text.split("\n")[0]).toBe("verdict: compatible (none)");
    expect(text).toContain("no contract differences found");
  });

  it("renders json that round-trips", () => {
    const json = formatJson(verdict);
    expect(json.verdict).toBe("breaking");
    expect(json.bump).toBe("major");
    expect(json.total).toBe(2);
    expect(json.findings[0]!.id).toBe("schema.required.added@/properties/a");
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    expect(Object.keys(json.findings[0]!)).toEqual(["id", "rule", "severity", "pointer", "message"]);
  });

  it("renders markdown with an escaped pipe", () => {
    const withPipe = verdictOf([finding("breaking", "schema.type.narrowed", "/a", "type a|b")]);
    const md = formatMarkdown(withPipe);
    expect(md.split("\n")[0]).toBe("**apidiff verdict: breaking (major)**");
    expect(md).toContain("| Severity | Location | Change | Rule |");
    expect(md).toContain("type a\\|b");
  });

  it("renders the rule table sorted, with every rule", () => {
    const text = formatRules();
    expect(text.startsWith("Rule table (severity is fixed per rule):")).toBe(true);
    const ids = text
      .split("\n")
      .slice(2)
      .map((line) => line.trim().split(/\s+/)[1] ?? "");
    expect(ids.length).toBeGreaterThanOrEqual(50);
    expect([...ids].sort()).toEqual(ids);
  });

  it("counts by severity", () => {
    expect(countBySeverity(list)).toEqual({ breaking: 1, deprecation: 0, changed: 1 });
  });
});
