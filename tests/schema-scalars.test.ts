import { describe, expect, it } from "vitest";

import { diffSchemas, verdictOf } from "../src/index.js";
import type { Finding } from "../src/types.js";

const rules = (findings: readonly Finding[]): string[] => findings.map((f) => f.rule);

describe("schema.type", () => {
  it("flags number -> integer as a narrowing", () => {
    const result = diffSchemas({ type: "number" }, { type: "integer" });
    expect(rules(result.findings)).toEqual(["schema.type.narrowed"]);
    expect(result.findings[0]!.severity).toBe("breaking");
    expect(result.findings[0]!.pointer).toBe("");
  });

  it("flags integer -> number as a widening, not breaking", () => {
    const result = diffSchemas({ type: "integer" }, { type: "number" });
    expect(rules(result.findings)).toEqual(["schema.type.widened"]);
    expect(result.findings[0]!.severity).toBe("changed");
  });

  it("says nothing when the type is unchanged", () => {
    expect(diffSchemas({ type: "string" }, { type: "string" }).findings).toEqual([]);
  });

  it("treats introducing a type constraint as breaking", () => {
    const result = diffSchemas({}, { type: "string" });
    expect(rules(result.findings)).toEqual(["schema.type.narrowed"]);
  });
});

describe("schema.nullable", () => {
  it("reports null becoming disallowed as breaking", () => {
    const result = diffSchemas({ type: ["string", "null"] }, { type: "string" });
    expect(rules(result.findings)).toEqual(["schema.nullable.removed"]);
    expect(result.findings[0]!.severity).toBe("breaking");
  });

  it("reports null becoming allowed as non-breaking", () => {
    const result = diffSchemas({ type: "string" }, { type: "string", nullable: true });
    expect(rules(result.findings)).toEqual(["schema.nullable.added"]);
  });
});

describe("schema.enum", () => {
  it("reports a removed member as breaking", () => {
    const result = diffSchemas({ enum: ["a", "b"] }, { enum: ["a"] });
    expect(rules(result.findings)).toEqual(["schema.enum.value.removed"]);
    expect(result.findings[0]!.before).toBe("b");
  });

  it("reports an added member as a widening", () => {
    const result = diffSchemas({ enum: ["a"] }, { enum: ["a", "b"] });
    expect(rules(result.findings)).toEqual(["schema.enum.value.added"]);
  });

  it("reports dropping the whole enum", () => {
    expect(rules(diffSchemas({ enum: ["a"] }, {}).findings)).toEqual(["schema.enum.removed"]);
  });
});

describe("schema.bounds", () => {
  it("reports a tightened minimum once, on the keyword pointer", () => {
    const result = diffSchemas({ type: "integer", minimum: 0 }, { type: "integer", minimum: 10 });
    expect(rules(result.findings)).toEqual(["schema.bounds.narrowed"]);
    expect(result.findings[0]!.pointer).toBe("/minimum");
    expect(result.findings[0]!.message).toBe("minimum changed from 0 to 10");
  });

  it("reports a relaxed maximum as a widening", () => {
    const result = diffSchemas({ maximum: 10 }, { maximum: 100 });
    expect(rules(result.findings)).toEqual(["schema.bounds.widened"]);
    expect(result.findings[0]!.pointer).toBe("/maximum");
  });

  it("reports exclusiveMaximum introduced in draft-06 form", () => {
    const result = diffSchemas({ type: "integer" }, { type: "integer", exclusiveMaximum: 5 });
    expect(rules(result.findings)).toEqual(["schema.bounds.narrowed"]);
    expect(result.findings[0]!.after).toBe(5);
  });

  it("reports fractional -> integer multipleOf constraints", () => {
    expect(rules(diffSchemas({ multipleOf: 0.5 }, { multipleOf: 1 }).findings)).toEqual(["schema.bounds.narrowed"]);
  });
});

describe("schema.pattern / format / const / default / deprecated", () => {
  it("reports a new pattern as breaking", () => {
    expect(rules(diffSchemas({ type: "string" }, { type: "string", pattern: "^a$" }).findings)).toEqual(["schema.pattern.added"]);
  });

  it("reports a changed pattern as breaking", () => {
    expect(rules(diffSchemas({ pattern: "^a$" }, { pattern: "^b$" }).findings)).toEqual(["schema.pattern.changed"]);
  });

  it("reports a removed pattern as non-breaking", () => {
    expect(rules(diffSchemas({ pattern: "^a$" }, {}).findings)).toEqual(["schema.pattern.removed"]);
  });

  it("reports a format change as advisory", () => {
    const result = diffSchemas({ format: "date" }, { format: "date-time" });
    expect(rules(result.findings)).toEqual(["schema.format.changed"]);
    expect(result.findings[0]!.severity).toBe("changed");
  });

  it("reports a changed const as breaking", () => {
    expect(rules(diffSchemas({ const: 1 }, { const: 2 }).findings)).toEqual(["schema.const.changed"]);
  });

  it("reports a default change under the default pointer", () => {
    const result = diffSchemas({ type: "string", default: "a" }, { type: "string", default: "b" });
    expect(result.findings[0]!.pointer).toBe("/default");
  });

  it("reports deprecation at deprecation severity", () => {
    const result = diffSchemas({ type: "string" }, { type: "string", deprecated: true });
    expect(rules(result.findings)).toEqual(["schema.deprecated.added"]);
    expect(result.findings[0]!.severity).toBe("deprecation");
  });

  it("aggregates a deprecation-only change into a minor bump", () => {
    const verdict = verdictOf(diffSchemas({}, { deprecated: true }).findings);
    expect(verdict.verdict).toBe("deprecation");
    expect(verdict.bump).toBe("minor");
  });
});
