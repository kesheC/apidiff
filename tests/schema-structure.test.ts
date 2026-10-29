import { describe, expect, it } from "vitest";

import { diffSchemas } from "../src/index.js";
import type { Finding } from "../src/types.js";

const rules = (findings: readonly Finding[]): string[] => findings.map((f) => f.rule);
const pointers = (findings: readonly Finding[]): string[] => findings.map((f) => f.pointer);

describe("schema.properties / required", () => {
  it("reports a removed property as breaking, with an escaped pointer", () => {
    const oldSchema = { type: "object", properties: { id: { type: "string" }, "a/b": { type: "string" } } };
    const newSchema = { type: "object", properties: { id: { type: "string" } } };
    const result = diffSchemas(oldSchema, newSchema);
    expect(rules(result.findings)).toEqual(["schema.property.removed"]);
    expect(result.findings[0]!.pointer).toBe("/properties/a~1b");
    expect(result.findings[0]!.severity).toBe("breaking");
  });

  it("reports an added property as non-breaking", () => {
    const result = diffSchemas({ type: "object", properties: {} }, { type: "object", properties: { extra: { type: "string" } } });
    expect(rules(result.findings)).toEqual(["schema.property.added"]);
    expect(result.findings[0]!.severity).toBe("changed");
  });

  it("reports a newly required property as breaking", () => {
    const oldSchema = { type: "object", properties: { a: { type: "string" } } };
    const newSchema = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
    const result = diffSchemas(oldSchema, newSchema);
    expect(rules(result.findings)).toEqual(["schema.required.added"]);
    expect(pointers(result.findings)).toEqual(["/required"]);
  });

  it("reports a property that stopped being required as breaking", () => {
    // A guarantee was withdrawn: callers that read the field unconditionally now
    // see it missing, so the schema becoming "more permissive" is still a major
    // bump for them.
    const result = diffSchemas({ required: ["a"] }, { required: [] });
    expect(rules(result.findings)).toEqual(["schema.required.removed"]);
    expect(result.findings[0]!.severity).toBe("breaking");
  });

  it("recurses into nested properties and keeps the full pointer", () => {
    const oldSchema = { type: "object", properties: { user: { type: "object", properties: { age: { type: "number" } } } } };
    const newSchema = { type: "object", properties: { user: { type: "object", properties: { age: { type: "integer" } } } } };
    const result = diffSchemas(oldSchema, newSchema);
    expect(rules(result.findings)).toEqual(["schema.type.narrowed"]);
    expect(pointers(result.findings)).toEqual(["/properties/user/properties/age"]);
  });
});

describe("schema.additionalProperties", () => {
  it("reports closing an open object as breaking", () => {
    const result = diffSchemas({ type: "object" }, { type: "object", additionalProperties: false });
    expect(rules(result.findings)).toEqual(["schema.additionalProperties.restricted"]);
    expect(result.findings[0]!.severity).toBe("breaking");
  });

  it("reports opening a closed object as non-breaking", () => {
    const result = diffSchemas({ additionalProperties: false }, { additionalProperties: true });
    expect(rules(result.findings)).toEqual(["schema.additionalProperties.relaxed"]);
  });

  it("reports a changed additionalProperties schema as breaking", () => {
    const result = diffSchemas({ additionalProperties: { type: "string" } }, { additionalProperties: { type: "number" } });
    // One finding for the policy change, plus the recursive detail on the node.
    expect(rules(result.findings)).toEqual(["schema.additionalProperties.changed", "schema.type.narrowed"]);
    expect(result.findings[0]!.pointer).toBe("/additionalProperties");
  });
});

describe("schema.items / uniqueItems", () => {
  it("reports a new item schema as breaking", () => {
    expect(rules(diffSchemas({ type: "array" }, { type: "array", items: { type: "string" } }).findings)).toEqual(["schema.items.added"]);
  });

  it("reports array item changes with the items pointer", () => {
    const result = diffSchemas({ type: "array", items: { type: "number" } }, { type: "array", items: { type: "integer" } });
    expect(pointers(result.findings)).toEqual(["/items"]);
  });

  it("reports uniqueItems becoming required as breaking", () => {
    const result = diffSchemas({ type: "array" }, { type: "array", uniqueItems: true });
    expect(rules(result.findings)).toEqual(["schema.uniqueItems.added"]);
    expect(result.findings[0]!.severity).toBe("breaking");
  });
});

describe("schema.composition", () => {
  it("reports introducing a oneOf as breaking", () => {
    const result = diffSchemas({ type: "object" }, { type: "object", oneOf: [{ type: "object" }, { type: "string" }] });
    expect(rules(result.findings)).toEqual(["schema.composition.added"]);
  });

  it("reports a branch count change as a composition change", () => {
    const result = diffSchemas({ anyOf: [{ type: "string" }] }, { anyOf: [{ type: "string" }, { type: "number" }] });
    expect(rules(result.findings)).toEqual(["schema.composition.changed"]);
  });

  it("recurses into equally long branches instead of double-reporting", () => {
    const result = diffSchemas({ anyOf: [{ type: "string" }] }, { anyOf: [{ type: "number" }] });
    expect(rules(result.findings)).toEqual(["schema.type.narrowed"]);
    expect(pointers(result.findings)).toEqual(["/anyOf/0"]);
  });

  it("reports a dropped allOf as non-breaking", () => {
    expect(rules(diffSchemas({ allOf: [{ type: "object" }] }, {}).findings)).toEqual(["schema.composition.removed"]);
  });
});

describe("boolean schemas and replacement", () => {
  it("reports a schema becoming false", () => {
    const result = diffSchemas({ type: "string" }, false);
    expect(rules(result.findings)).toEqual(["schema.replaced"]);
    expect(result.findings[0]!.after).toBe(false);
  });

  it("reports a schema becoming true", () => {
    expect(rules(diffSchemas({ type: "string" }, true).findings)).toEqual(["schema.replaced"]);
  });

  it("says nothing when both are the same boolean schema", () => {
    expect(diffSchemas(true, true).findings).toEqual([]);
  });
});
