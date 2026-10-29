import { describe, expect, it } from "vitest";

import { diffOpenApi, verdictOf } from "../src/index.js";
import type { Finding } from "../src/types.js";

const rules = (findings: readonly Finding[]): string[] => findings.map((f) => f.rule);

const LIMIT = { name: "limit", in: "query", required: false, schema: { type: "integer" } };
const OK = { "200": { description: "ok" } };

type Obj = Record<string, unknown>;

function doc(paths: Obj, overrides: Obj = {}): Obj {
  return { openapi: "3.0.3", info: { title: "Test API", version: "1.0.0" }, paths, ...overrides };
}

function listGet(extra: Obj = {}): Obj {
  return { operationId: "listUsers", parameters: [LIMIT], responses: OK, ...extra };
}

function createPost(extra: Obj = {}): Obj {
  return { operationId: "createUser", responses: { "201": { description: "created" } }, ...extra };
}

/** The reference document: two methods, one optional parameter. */
const base = (): Obj => doc({ "/users": { get: listGet(), post: createPost() } });

const paramDoc = (list: unknown[]): Obj => doc({ "/users": { get: { operationId: "listUsers", parameters: list, responses: OK } } });

describe("openapi paths and operations", () => {
  it("reports a removed path as breaking", () => {
    const result = diffOpenApi(base(), doc({}));
    expect(rules(result.findings)).toEqual(["openapi.path.removed"]);
    expect(result.findings[0]!.severity).toBe("breaking");
    expect(result.findings[0]!.pointer).toBe("/paths/~1users");
  });

  it("reports an added path as non-breaking", () => {
    const result = diffOpenApi(doc({}), base());
    expect(rules(result.findings)).toEqual(["openapi.path.added"]);
    expect(result.findings[0]!.severity).toBe("changed");
  });

  it("reports a removed method as breaking and keeps the sibling method", () => {
    const result = diffOpenApi(base(), doc({ "/users": { get: listGet() } }));
    expect(rules(result.findings)).toEqual(["openapi.operation.removed"]);
    expect(result.findings[0]!.message).toContain("POST /users");
    expect(result.findings[0]!.location).toBe("POST /users");
  });

  it("reports an added method as non-breaking", () => {
    const result = diffOpenApi(doc({ "/users": { get: listGet() } }), base());
    expect(rules(result.findings)).toEqual(["openapi.operation.added"]);
    expect(result.findings[0]!.location).toBe("POST /users");
  });

  it("reports a deprecated operation at deprecation severity", () => {
    const result = diffOpenApi(base(), doc({ "/users": { get: listGet({ deprecated: true }), post: createPost() } }));
    expect(rules(result.findings)).toEqual(["openapi.operation.deprecated"]);
    expect(result.findings[0]!.severity).toBe("deprecation");
    expect(verdictOf(result.findings).bump).toBe("minor");
  });

  it("reports an operationId change", () => {
    const result = diffOpenApi(base(), doc({ "/users": { get: listGet({ operationId: "getAllUsers" }), post: createPost() } }));
    expect(rules(result.findings)).toEqual(["openapi.operationId.changed"]);
    expect(result.findings[0]!.before).toBe("listUsers");
    expect(result.findings[0]!.after).toBe("getAllUsers");
  });

  it("reports an OpenAPI version change as breaking", () => {
    const result = diffOpenApi(base(), doc({ "/users": { get: listGet(), post: createPost() } }, { openapi: "3.1.0" }));
    expect(rules(result.findings)).toEqual(["openapi.version.changed"]);
    expect(result.oldVersion).toBe("3.0.3");
    expect(result.newVersion).toBe("3.1.0");
  });
});
describe("openapi parameters", () => {
  it("reports a removed parameter as breaking", () => {
    const result = diffOpenApi(paramDoc([LIMIT]), paramDoc([]));
    expect(rules(result.findings)).toEqual(["openapi.parameter.removed"]);
    expect(result.findings[0]!.severity).toBe("breaking");
    expect(result.findings[0]!.location).toBe("GET /users");
  });

  it("reports a newly required parameter as breaking and an optional one as not", () => {
    const required = diffOpenApi(paramDoc([]), paramDoc([{ name: "page", in: "query", required: true }]));
    expect(rules(required.findings)).toEqual(["openapi.parameter.added-required"]);
    expect(required.findings[0]!.severity).toBe("breaking");

    const optional = diffOpenApi(paramDoc([]), paramDoc([{ name: "page", in: "query", required: false }]));
    expect(rules(optional.findings)).toEqual(["openapi.parameter.added-optional"]);
    expect(optional.findings[0]!.severity).toBe("changed");
  });

  it("reports a parameter that became required", () => {
    const result = diffOpenApi(paramDoc([LIMIT]), paramDoc([{ ...LIMIT, required: true }]));
    expect(rules(result.findings)).toEqual(["openapi.parameter.became-required"]);
  });

  it("reports a parameter that became optional as non-breaking", () => {
    const result = diffOpenApi(paramDoc([{ ...LIMIT, required: true }]), paramDoc([LIMIT]));
    expect(rules(result.findings)).toEqual(["openapi.parameter.became-optional"]);
    expect(result.findings[0]!.severity).toBe("changed");
  });

  it("reports a parameter that moved from query to header once", () => {
    const result = diffOpenApi(paramDoc([{ name: "token", in: "query", required: true }]), paramDoc([{ name: "token", in: "header", required: true }]));
    expect(rules(result.findings)).toEqual(["openapi.parameter.location-changed"]);
    expect(result.findings[0]!.before).toBe("query");
    expect(result.findings[0]!.after).toBe("header");
  });

  it("delegates parameter schema changes to the schema differ", () => {
    const result = diffOpenApi(
      paramDoc([{ name: "limit", in: "query", required: false, schema: { type: "number" } }]),
      paramDoc([{ name: "limit", in: "query", required: false, schema: { type: "integer" } }]),
    );
    expect(rules(result.findings)).toEqual(["schema.type.narrowed"]);
    expect(result.findings[0]!.pointer).toBe("/paths/~1users/get/parameters/0/schema");
  });

  it("treats a parameter moved between methods as removed plus added", () => {
    const oldDoc = doc({ "/users": { get: listGet({ parameters: [LIMIT] }), post: createPost() } });
    const newDoc = doc({ "/users": { get: listGet({ parameters: [] }), post: createPost({ parameters: [LIMIT] }) } });
    expect(rules(diffOpenApi(oldDoc, newDoc).findings)).toEqual(["openapi.parameter.removed", "openapi.parameter.added-optional"]);
  });
});
describe("openapi request bodies and responses", () => {
  const jsonBody = (schema: unknown, required: boolean): Obj => ({ required, content: { "application/json": { schema } } });
  const bodyDoc = (body: unknown): Obj => doc({ "/users": { post: createPost({ requestBody: body }) } });

  it("reports a removed request body as breaking", () => {
    const result = diffOpenApi(bodyDoc(jsonBody({ type: "object" }, false)), doc({ "/users": { post: createPost() } }));
    expect(rules(result.findings)).toEqual(["openapi.requestBody.removed"]);
    expect(result.findings[0]!.severity).toBe("breaking");
  });

  it("reports an added required body as breaking", () => {
    const result = diffOpenApi(doc({ "/users": { post: createPost() } }), bodyDoc(jsonBody({ type: "object" }, true)));
    expect(rules(result.findings)).toEqual(["openapi.requestBody.added-required"]);
    expect(result.findings[0]!.severity).toBe("breaking");
  });

  it("reports an added optional body as non-breaking without echoing media types", () => {
    const result = diffOpenApi(doc({ "/users": { post: createPost() } }), bodyDoc(jsonBody({ type: "object" }, false)));
    expect(rules(result.findings)).toEqual(["openapi.requestBody.added-optional"]);
    expect(result.findings[0]!.severity).toBe("changed");
  });

  it("reports a body that became required", () => {
    const result = diffOpenApi(bodyDoc(jsonBody({ type: "object" }, false)), bodyDoc(jsonBody({ type: "object" }, true)));
    expect(rules(result.findings)).toEqual(["openapi.requestBody.became-required"]);
  });

  it("reports a removed response status code as breaking", () => {
    const oldDoc = doc({ "/users": { get: listGet({ responses: { "200": { description: "ok" }, "404": { description: "missing" } } }) } });
    expect(rules(diffOpenApi(oldDoc, doc({ "/users": { get: listGet() } })).findings)).toEqual(["openapi.response.removed"]);
  });

  it("reports an added response status code as non-breaking", () => {
    const newDoc = doc({ "/users": { get: listGet({ responses: { "200": { description: "ok" }, "429": { description: "slow down" } } }) } });
    const result = diffOpenApi(doc({ "/users": { get: listGet() } }), newDoc);
    expect(rules(result.findings)).toEqual(["openapi.response.added"]);
    expect(result.findings[0]!.pointer).toBe("/paths/~1users/get/responses/429");
  });

  it("reports a removed media type as breaking", () => {
    const oldDoc = doc({ "/users": { get: listGet({ responses: { "200": { description: "ok", content: { "application/json": {}, "text/csv": {} } } } }) } });
    const newDoc = doc({ "/users": { get: listGet({ responses: { "200": { description: "ok", content: { "application/json": {} } } } }) } });
    expect(rules(diffOpenApi(oldDoc, newDoc).findings)).toEqual(["openapi.mediaType.removed"]);
  });

  it("diffs response schemas in place", () => {
    const schemaDoc = (schema: unknown): Obj => doc({ "/users": { get: listGet({ responses: { "200": { description: "ok", content: { "application/json": { schema } } } } }) } });
    const result = diffOpenApi(schemaDoc({ type: "object", properties: { id: { type: "string" } }, required: ["id"] }), schemaDoc({ type: "object", properties: { id: { type: "string" } } }));
    expect(rules(result.findings)).toEqual(["schema.required.removed"]);
    expect(result.findings[0]!.location).toBe("GET /users");
  });
});
describe("openapi + components", () => {
  const usersApi = (nickRequired: boolean): Obj => ({
    openapi: "3.0.3",
    info: { title: "T", version: "1" },
    paths: { "/u": { get: { operationId: "getU", responses: { "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } } } } } },
    components: {
      schemas: {
        User: {
          type: "object",
          properties: { id: { type: "string" }, nick: { type: "string" } },
          required: nickRequired ? ["id", "nick"] : ["id"],
        },
      },
    },
  });

  it("resolves $ref response schemas against the whole document", () => {
    const result = diffOpenApi(usersApi(false), usersApi(true));
    expect(rules(result.findings)).toEqual(["schema.required.added"]);
    expect(result.findings[0]!.viaRef).toBe("#/components/schemas/User");
    expect(result.findings[0]!.pointer).toContain("/paths/~1u/get/responses/200/content/application~1json/schema");
    expect(result.findings[0]!.location).toBe("GET /u");
  });

  it("returns a compatible verdict when nothing changed", () => {
    const verdict = verdictOf(diffOpenApi(base(), base()).findings);
    expect(verdict.verdict).toBeNull();
    expect(verdict.bump).toBe("none");
    expect(verdict.total).toBe(0);
  });

  it("returns a major verdict when a path was removed", () => {
    const verdict = verdictOf(diffOpenApi(base(), doc({ "/users": { get: listGet() } })).findings);
    expect(verdict.verdict).toBe("breaking");
    expect(verdict.bump).toBe("major");
  });

  it("produces stable, unique finding ids", () => {
    const result = diffOpenApi(base(), doc({}));
    const ids = result.findings.map((finding) => finding.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toContain("openapi.path.removed@");
  });

  it("survives a document without paths", () => {
    const result = diffOpenApi({ openapi: "3.0.3" }, { openapi: "3.0.3" });
    expect(result.findings).toHaveLength(0);
  });
});
