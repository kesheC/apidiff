import type { DiffOptions, Finding, JsonObject, JsonValue, OpenApiDiffResult } from "./types.js";
import { RULES, type RuleId } from "./rules.js";
import { appendPointer, isJsonObject } from "./refs.js";
import { diffSchemasAt } from "./schema-diff.js";

/** HTTP methods that carry an operation object in OpenAPI 3.x. */
export const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

const METHOD_SET = new Set<string>(HTTP_METHODS);

interface OperationLocation {
  path: string;
  method: string;
  pointer: string;
}

/** "GET /users/{id}" — the label a human scans for in a report. */
export function operationLabel(path: string, method: string): string {
  return method.toUpperCase() + " " + path;
}

function asObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function show(value: JsonValue | undefined): string {
  return value === undefined ? "<unset>" : JSON.stringify(value);
}

/**
 * Compares two OpenAPI 3.x documents.
 *
 * The walk is deliberately shallow-first: paths, then operations, then
 * parameters / requestBody / responses, and only then does it hand each schema
 * pair to the JSON Schema differ. That keeps one rule table authoritative for
 * schema-level changes instead of duplicating them here.
 */
class OpenApiDiffer {
  private readonly findings: Finding[] = [];
  private readonly oldDoc: JsonObject;
  private readonly newDoc: JsonObject;

  constructor(oldDoc: unknown, newDoc: unknown, private readonly options: DiffOptions) {
    this.oldDoc = asObject(oldDoc) ?? {};
    this.newDoc = asObject(newDoc) ?? {};
  }

  emit(rule: RuleId, pointer: string, message: string, extra: { location?: string; before?: JsonValue; after?: JsonValue } = {}): void {
    const location = extra.location;
    this.findings.push({
      id: rule + "@" + pointer,
      rule,
      severity: RULES[rule].severity,
      pointer,
      message,
      ...(location === undefined ? {} : { location }),
      ...(extra.before === undefined ? {} : { before: extra.before }),
      ...(extra.after === undefined ? {} : { after: extra.after }),
    });
  }

  run(): Finding[] {
    this.compareMeta();
    const oldPaths = asObject(this.oldDoc.paths) ?? {};
    const newPaths = asObject(this.newDoc.paths) ?? {};

    for (const path of Object.keys(newPaths)) {
      const pointer = appendPointer("/paths", path);
      if (!Object.prototype.hasOwnProperty.call(oldPaths, path)) {
        this.emit("openapi.path.added", pointer, "path " + path + " was added", { location: path, after: path });
        continue;
      }
      this.comparePathItem(path, oldPaths[path], newPaths[path], pointer);
    }

    for (const path of Object.keys(oldPaths)) {
      if (Object.prototype.hasOwnProperty.call(newPaths, path)) continue;
      this.emit("openapi.path.removed", appendPointer("/paths", path), "path " + path + " was removed; every operation under it is gone", { location: path, before: path });
    }

    return this.findings;
  }

  private compareMeta(): void {
    const oldVersion = this.oldDoc.openapi;
    const newVersion = this.newDoc.openapi;
    if (typeof oldVersion === "string" && typeof newVersion === "string" && oldVersion !== newVersion) {
      this.emit("openapi.version.changed", "/openapi", "document version changed from " + oldVersion + " to " + newVersion, { before: oldVersion, after: newVersion });
    }
  }

  private comparePathItem(path: string, oldItem: unknown, newItem: unknown, pointer: string): void {
    const oldOperations = asObject(oldItem) ?? {};
    const newOperations = asObject(newItem) ?? {};

    for (const method of Object.keys(newOperations)) {
      if (!METHOD_SET.has(method)) continue;
      const operationPointer = appendPointer(pointer, method);
      const location = operationLabel(path, method);
      if (!Object.prototype.hasOwnProperty.call(oldOperations, method)) {
        this.emit("openapi.operation.added", operationPointer, location + " was added", { location, after: method });
        continue;
      }
      this.compareOperation(location, path, method, oldOperations[method], newOperations[method], operationPointer);
    }

    for (const method of Object.keys(oldOperations)) {
      if (!METHOD_SET.has(method)) continue;
      if (Object.prototype.hasOwnProperty.call(newOperations, method)) continue;
      const location = operationLabel(path, method);
      this.emit("openapi.operation.removed", appendPointer(pointer, method), location + " was removed; existing callers will get an error", { location, before: method });
    }
  }

  private compareOperation(location: string, path: string, method: string, oldOp: unknown, newOp: unknown, pointer: string): void {
    const oldOperation = asObject(oldOp);
    const newOperation = asObject(newOp);
    if (oldOperation === undefined || newOperation === undefined) return;

    if (newOperation.deprecated === true && oldOperation.deprecated !== true) {
      this.emit("openapi.operation.deprecated", appendPointer(pointer, "deprecated"), location + " is now deprecated", { location, after: true });
    }
    if (typeof oldOperation.operationId === "string" && typeof newOperation.operationId === "string" && oldOperation.operationId !== newOperation.operationId) {
      this.emit("openapi.operationId.changed", appendPointer(pointer, "operationId"), location + " operationId changed from " + oldOperation.operationId + " to " + newOperation.operationId + "; generated clients will rename methods", {
        location,
        before: oldOperation.operationId,
        after: newOperation.operationId,
      });
    }

    this.compareParameters(location, oldOperation, newOperation, appendPointer(pointer, "parameters"));
    this.compareRequestBody(location, oldOperation, newOperation, appendPointer(pointer, "requestBody"));
    this.compareResponses(location, path, method, oldOperation, newOperation, appendPointer(pointer, "responses"));
  }

  /** Parameters are keyed by (name, in): moving one is a different parameter. */
  private compareParameters(location: string, oldOp: JsonObject, newOp: JsonObject, pointer: string): void {
    const oldParams = collectParameters(oldOp.parameters);
    const newParams = collectParameters(newOp.parameters);
    const key = (name: string, location: string): string => location + ":" + name;

    const movedFrom = new Set<string>();

    for (const [id, param] of newParams) {
      const previous = oldParams.get(id);
      const label = location + " parameter " + param.location + " \"" + param.name + "\"";
      if (previous === undefined) {
        const movedEntry = [...oldParams.entries()].find(([oldId, candidate]) => !newParams.has(oldId) && candidate.name === param.name);
        if (movedEntry !== undefined) {
          const [oldId, moved] = movedEntry;
          // A move is one change: do not also report the old slot as removed.
          movedFrom.add(oldId);
          this.emit("openapi.parameter.location-changed", appendPointer(pointer, param.pointer), label + " moved from " + moved.location + " to " + param.location, { location, before: moved.location, after: param.location });
          continue;
        }
        const required = param.node.required === true;
        this.emit(
          required ? "openapi.parameter.added-required" : "openapi.parameter.added-optional",
          appendPointer(pointer, param.pointer),
          label + " was added" + (required ? " and is required" : ""),
          { location, after: param.name },
        );
        continue;
      }
      const wasRequired = previous.node.required === true;
      const isRequired = param.node.required === true;
      if (!wasRequired && isRequired) {
        this.emit("openapi.parameter.became-required", appendPointer(pointer, param.pointer), label + " became required", { location, before: false, after: true });
      } else if (wasRequired && !isRequired) {
        this.emit("openapi.parameter.became-optional", appendPointer(pointer, param.pointer), label + " became optional", { location, before: true, after: false });
      }
      if (previous.node.schema !== undefined || param.node.schema !== undefined) {
        this.pushSchemas(previous.node.schema, param.node.schema, appendPointer(pointer, param.pointer, "schema"), location);
      }
    }

    for (const [id, param] of oldParams) {
      if (newParams.has(id) || movedFrom.has(id)) continue;
      this.emit("openapi.parameter.removed", appendPointer(pointer, param.pointer), location + " parameter " + param.location + " \"" + param.name + "\" was removed", { location, before: param.name });
    }
  }

  private compareRequestBody(location: string, oldOp: JsonObject, newOp: JsonObject, pointer: string): void {
    const oldBody = asObject(oldOp.requestBody);
    const newBody = asObject(newOp.requestBody);
    if (oldBody === undefined && newBody === undefined) return;
    if (newBody === undefined) {
      this.emit("openapi.requestBody.removed", pointer, location + " no longer accepts a request body", { location });
      return;
    }
    if (oldBody === undefined) {
      const required = newBody.required === true;
      this.emit(
        required ? "openapi.requestBody.added-required" : "openapi.requestBody.added-optional",
        pointer,
        location + " now accepts a request body" + (required ? " and it is required" : ""),
        { location, after: required },
      );
      return;
    }
    const wasRequired = oldBody.required === true;
    const isRequired = newBody.required === true;
    if (!wasRequired && isRequired) this.emit("openapi.requestBody.became-required", appendPointer(pointer, "required"), location + " request body became required", { location, before: false, after: true });
    if (wasRequired && !isRequired) this.emit("openapi.requestBody.became-optional", appendPointer(pointer, "required"), location + " request body became optional", { location, before: true, after: false });
    this.compareMediaTypes(location, oldBody, newBody, pointer);
  }

  private compareMediaTypes(location: string, oldBody: JsonObject | undefined, newBody: JsonObject, pointer: string): void {
    const oldContent = oldBody === undefined ? {} : asObject(oldBody.content) ?? {};
    const newContent = asObject(newBody.content) ?? {};
    const oldTypes = new Set(Object.keys(oldContent));
    const newTypes = new Set(Object.keys(newContent));

    for (const mediaType of newTypes) {
      if (!oldTypes.has(mediaType)) {
        this.emit("openapi.mediaType.added", appendPointer(pointer, "content", mediaType), location + " accepts a new media type " + mediaType, { location, after: mediaType });
        continue;
      }
      const oldMedia = asObject(oldContent[mediaType]);
      const newMedia = asObject(newContent[mediaType]);
      this.pushSchemas(oldMedia?.schema, newMedia?.schema, appendPointer(pointer, "content", mediaType, "schema"), location);
    }
    for (const mediaType of oldTypes) {
      if (newTypes.has(mediaType)) continue;
      this.emit("openapi.mediaType.removed", appendPointer(pointer, "content", mediaType), location + " no longer accepts media type " + mediaType, { location, before: mediaType });
    }
  }

  private compareResponses(location: string, path: string, method: string, oldOp: JsonObject, newOp: JsonObject, pointer: string): void {
    const oldResponses = asObject(oldOp.responses) ?? {};
    const newResponses = asObject(newOp.responses) ?? {};
    const oldCodes = new Set(Object.keys(oldResponses));
    const newCodes = new Set(Object.keys(newResponses));

    for (const code of newCodes) {
      if (!oldCodes.has(code)) {
        this.emit("openapi.response.added", appendPointer(pointer, code), location + " now documents response " + code, { location, after: code });
        continue;
      }
      const oldResponse = asObject(oldResponses[code]);
      const newResponse = asObject(newResponses[code]);
      if (oldResponse === undefined || newResponse === undefined) continue;
      this.compareResponseContent(location, code, oldResponse, newResponse, appendPointer(pointer, code));
    }

    for (const code of oldCodes) {
      if (newCodes.has(code)) continue;
      this.emit("openapi.response.removed", appendPointer(pointer, code), location + " no longer documents response " + code, { location, before: code });
    }
  }

  private compareResponseContent(location: string, code: string, oldResponse: JsonObject, newResponse: JsonObject, pointer: string): void {
    const oldContent = asObject(oldResponse.content) ?? {};
    const newContent = asObject(newResponse.content) ?? {};
    const oldTypes = new Set(Object.keys(oldContent));
    const newTypes = new Set(Object.keys(newContent));
    const label = location + " response " + code;

    for (const mediaType of newTypes) {
      if (!oldTypes.has(mediaType)) {
        this.emit("openapi.mediaType.added", appendPointer(pointer, "content", mediaType), label + " now returns media type " + mediaType, { location, after: mediaType });
        continue;
      }
      const oldMedia = asObject(oldContent[mediaType]);
      const newMedia = asObject(newContent[mediaType]);
      this.pushSchemas(oldMedia?.schema, newMedia?.schema, appendPointer(pointer, "content", mediaType, "schema"), location);
    }
    for (const mediaType of oldTypes) {
      if (newTypes.has(mediaType)) continue;
      this.emit("openapi.mediaType.removed", appendPointer(pointer, "content", mediaType), label + " no longer returns media type " + mediaType, { location, before: mediaType });
    }
  }

  /** Hand a schema pair to the JSON Schema differ and stamp the location. */
  private pushSchemas(oldSchema: unknown, newSchema: unknown, pointer: string, location: string): void {
    if (oldSchema === undefined && newSchema === undefined) return;
    const findings = diffSchemasAt(oldSchema, newSchema, pointer, { oldRoot: this.oldDoc, newRoot: this.newDoc });
    for (const finding of findings) {
      // The pointer is document-wide; the reader wants "which field changed
      // inside this operation", so strip the shared prefix back off.
      const trail = finding.pointer.slice(pointer.length).split("/").filter((part) => part !== "").join(".");
      const message = trail === "" ? finding.message : trail.replace(/~1/g, "/").replace(/~0/g, "~") + ": " + finding.message;
      this.findings.push({ ...finding, location, message });
    }
  }
}

interface ParamInfo {
  name: string;
  location: string;
  node: JsonObject;
  pointer: string;
}

/** Key parameters by (in, name), which is what OpenAPI uses for identity. */
function collectParameters(raw: JsonValue | undefined): Map<string, ParamInfo> {
  const out = new Map<string, ParamInfo>();
  if (!Array.isArray(raw)) return out;
  raw.forEach((entry, index) => {
    const node = asObject(entry);
    if (node === undefined) return;
    const name = typeof node.name === "string" ? node.name : "";
    const location = typeof node.in === "string" ? node.in : "";
    if (name === "") return;
    out.set(location + ":" + name, { name, location, node, pointer: String(index) });
  });
  return out;
}

/** Compare two OpenAPI 3.x documents. Pure: no IO, no globals. */
export function diffOpenApi(oldDoc: unknown, newDoc: unknown, options: DiffOptions = {}): OpenApiDiffResult {
  const differ = new OpenApiDiffer(oldDoc, newDoc, options);
  const findings = differ.run();
  return {
    kind: "openapi",
    oldVersion: typeof asObject(oldDoc)?.openapi === "string" ? (asObject(oldDoc)!.openapi as string) : undefined,
    newVersion: typeof asObject(newDoc)?.openapi === "string" ? (asObject(newDoc)!.openapi as string) : undefined,
    findings,
  };
}