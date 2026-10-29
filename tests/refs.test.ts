import { describe, expect, it } from "vitest";

import {
  RefResolver,
  appendPointer,
  escapeSegment,
  getByPointer,
  parseRef,
  pointerOf,
  splitPointer,
  unescapeSegment,
  diffSchemas,
} from "../src/index.js";
import type { Finding } from "../src/types.js";

const rules = (findings: readonly Finding[]): string[] => findings.map((f) => f.rule);

describe("JSON Pointer helpers", () => {
  it("escapes ~ and / per RFC 6901", () => {
    expect(escapeSegment("a/b~c")).toBe("a~1b~0c");
    expect(unescapeSegment("a~1b~0c")).toBe("a/b~c");
  });

  it("builds and splits pointers symmetrically", () => {
    const pointer = pointerOf(["properties", "a/b"]);
    expect(pointer).toBe("/properties/a~1b");
    expect(splitPointer(pointer)).toEqual(["properties", "a/b"]);
  });

  it("treats the root pointer as no segments", () => {
    expect(splitPointer("")).toEqual([]);
    expect(splitPointer("#/a")).toEqual(["a"]);
    expect(appendPointer("", "a", 0)).toBe("/a/0");
  });

  it("walks documents and reports missing paths as undefined", () => {
    const document = { a: [{ b: 1 }] };
    expect(getByPointer(document, "/a/0/b")).toBe(1);
    expect(getByPointer(document, "/a/9/b")).toBeUndefined();
    expect(getByPointer(document, "/a/0/b/c")).toBeUndefined();
  });

  it("splits a $ref into file and pointer", () => {
    expect(parseRef("./common.json#/definitions/Id")).toEqual({ file: "./common.json", pointer: "/definitions/Id" });
    expect(parseRef("#/definitions/Id")).toEqual({ file: "", pointer: "/definitions/Id" });
  });
});

describe("$ref resolution", () => {
  it("follows an in-document ref and reports the hop", () => {
    const document = { definitions: { Id: { type: "string" } } };
    const resolver = new RefResolver(document);
    const result = resolver.deref({ $ref: "#/definitions/Id" });
    expect(result.broken).toBe(false);
    expect(result.pointer).toBe("/definitions/Id");
    expect(result.hops).toHaveLength(1);
    expect((result.node as { type: string }).type).toBe("string");
  });

  it("resolves #/$defs (2020-12) as well as #/definitions", () => {
    const document = { $defs: { Age: { type: "integer" } } };
    const resolver = new RefResolver(document);
    expect((resolver.deref({ $ref: "#/$defs/Age" }).node as { type: string }).type).toBe("integer");
  });

  it("follows ref chains", () => {
    const document = { a: { $ref: "#/b" }, b: { type: "number" } };
    const resolver = new RefResolver(document);
    const result = resolver.deref({ $ref: "#/a" });
    expect(result.broken).toBe(false);
    expect(result.hops).toHaveLength(2);
    expect((result.node as { type: string }).type).toBe("number");
  });

  it("stops a self-referential chain instead of looping", () => {
    const document = { Node: { type: "object", properties: { next: { $ref: "#/Node" } } } };
    const resolver = new RefResolver(document);
    const result = resolver.deref({ $ref: "#/Node" });
    // The first hop lands on the object; the cycle is only visible once the
    // nested property is expanded, which the differ handles.
    expect(result.broken).toBe(false);
    expect(result.cyclic).toBe(false);
  });

  it("marks a ref to a missing pointer as broken", () => {
    const resolver = new RefResolver({ definitions: {} });
    const result = resolver.deref({ $ref: "#/definitions/Nope" });
    expect(result.broken).toBe(true);
    expect(result.node).toEqual({ $ref: "#/definitions/Nope" });
  });

  it("loads a sibling document through the loader", () => {
    const resolver = new RefResolver({}, { loadDocument: (file) => (file === "common.json" ? { $defs: { Id: { type: "string" } } } : undefined) });
    const result = resolver.deref({ $ref: "common.json#/$defs/Id" });
    expect(result.broken).toBe(false);
    expect(result.docId).toBe("common.json");
  });

  it("caches loader failures instead of retrying forever", () => {
    let calls = 0;
    const resolver = new RefResolver({}, {
      loadDocument: () => {
        calls += 1;
        throw new Error("no such file");
      },
    });
    expect(resolver.deref({ $ref: "a.json#/x" }).broken).toBe(true);
    expect(resolver.deref({ $ref: "a.json#/x" }).broken).toBe(true);
    expect(calls).toBe(1);
  });
});

describe("diffing through refs", () => {
  it("compares two documents through their definitions", () => {
    const oldSchema = {
      definitions: { Id: { type: "string", minLength: 1 } },
      properties: { id: { $ref: "#/definitions/Id" } },
    };
    const newSchema = {
      definitions: { Id: { type: "string", minLength: 3 } },
      properties: { id: { $ref: "#/definitions/Id" } },
    };
    const result = diffSchemas(oldSchema, newSchema);
    expect(rules(result.findings)).toEqual(["schema.bounds.narrowed"]);
    expect(result.findings[0]!.viaRef).toBe("#/definitions/Id");
  });

  it("terminates on a mutually recursive schema pair", () => {
    const cyclic = {
      definitions: { Node: { type: "object", properties: { next: { $ref: "#/definitions/Node" } } } },
      $ref: "#/definitions/Node",
    };
    const result = diffSchemas(cyclic, cyclic);
    expect(result.findings).toEqual([]);
  });

  it("terminates when a recursive schema gains a property", () => {
    const oldSchema = {
      definitions: { Node: { type: "object", properties: { next: { $ref: "#/definitions/Node" } } } },
      $ref: "#/definitions/Node",
    };
    const newSchema = {
      definitions: { Node: { type: "object", properties: { next: { $ref: "#/definitions/Node" }, tag: { type: "string" } } } },
      $ref: "#/definitions/Node",
    };
    const result = diffSchemas(oldSchema, newSchema);
    expect(rules(result.findings)).toEqual(["schema.property.added"]);
  });

  it("reports nothing when the ref itself is unchanged", () => {
    const document = { definitions: { Id: { type: "string" } }, properties: { id: { $ref: "#/definitions/Id" } } };
    expect(diffSchemas(document, document).findings).toEqual([]);
  });
});
