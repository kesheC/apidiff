/**
 * apidiff — semver verdict for API contract changes.
 *
 * The library surface: pure functions, no IO, no runtime dependencies.
 * The CLI (src/cli.ts) is a thin wrapper that reads files and maps a verdict
 * onto an exit code; nothing in this module touches process.argv or exits.
 */

export type {
  ContractKind,
  DiffOptions,
  EnvDiffResult,
  Finding,
  JsonObject,
  JsonValue,
  OpenApiDiffResult,
  SchemaDiffResult,
  Verdict,
} from "./types.js";

export { RULES, SEVERITY_LABEL, SEVERITY_LADDER, severityRank } from "./rules.js";
export type { RuleDefinition, RuleId, Severity } from "./rules.js";

export { diffSchemas, diffSchemasAt, MAX_SCHEMA_DEPTH } from "./schema-diff.js";
export { diffOpenApi, HTTP_METHODS, operationLabel } from "./openapi-diff.js";
export { diffEnv, parseEnvKeys } from "./env-diff.js";

export { bumpOf, shouldFail, severitiesAtOrAbove, verdictOf } from "./verdict.js";
export type { FailOn } from "./verdict.js";

export { countBySeverity, formatJson, formatMarkdown, formatRules, formatText } from "./report.js";
export type { JsonReport } from "./report.js";

export {
  RefResolver,
  appendPointer,
  escapeSegment,
  getByPointer,
  isJsonObject,
  parseRef,
  pointerOf,
  refOf,
  splitPointer,
  unescapeSegment,
} from "./refs.js";
export type { DerefResult, RefHop } from "./refs.js";

export { UsageError } from "./errors.js";

import { UsageError } from "./errors.js";
import { diffEnv } from "./env-diff.js";
import { diffOpenApi } from "./openapi-diff.js";
import { diffSchemas } from "./schema-diff.js";
import type { ContractKind, DiffOptions, Finding } from "./types.js";
import { verdictOf, type FailOn } from "./verdict.js";
import type { Verdict } from "./types.js";

/**
 * Compare two documents without knowing their family up front.
 *
 * Detection is structural: an `openapi`/`swagger` key means OpenAPI. Callers
 * that already know should prefer the concrete function.
 */
export function looksLikeOpenApi(document: unknown): boolean {
  return (
    typeof document === "object" && document !== null && !Array.isArray(document) &&
    ("openapi" in document || "swagger" in document || "paths" in document)
  );
}

export function diffDetect(oldDocument: unknown, newDocument: unknown, options: DiffOptions = {}): { kind: ContractKind; findings: Finding[] } {
  const oldOpenApi = looksLikeOpenApi(oldDocument);
  const newOpenApi = looksLikeOpenApi(newDocument);

  // Comparing an OpenAPI document against a JSON Schema used to fall through to
  // the OpenAPI differ and report "everything was removed", which is technically
  // true and completely useless. Say what actually happened instead.
  if (oldOpenApi !== newOpenApi) {
    const openApiSide = oldOpenApi ? "the old document" : "the new document";
    const schemaSide = oldOpenApi ? "the new document" : "the old document";
    throw new UsageError(
      openApiSide + " is an OpenAPI document but " + schemaSide + " is a JSON Schema; pass --contract to say which family these files are",
    );
  }

  if (oldOpenApi) {
    return { kind: "openapi", findings: diffOpenApi(oldDocument, newDocument, options).findings };
  }
  return { kind: "schema", findings: diffSchemas(oldDocument, newDocument, options).findings };
}

/** Compare two documents and return the semver verdict directly. */
export function diff(oldDocument: unknown, newDocument: unknown, options: DiffOptions = {}): Verdict {
  return verdictOf(diffDetect(oldDocument, newDocument, options).findings);
}

/** Exit code for a verdict: 1 when the change should fail the build. */
export function exitCodeOf(verdict: Verdict, failOn: FailOn = "breaking"): number {
  if (failOn === "never") return 0;
  const threshold = failOn === "breaking" ? "breaking" : "deprecation";
  const rankOrder = ["breaking", "deprecation", "changed"] as const;
  const limit = rankOrder.indexOf(threshold);
  for (let index = 0; index <= limit; index += 1) {
    const severity = rankOrder[index]!;
    if (verdict.counts[severity] > 0) return 1;
  }
  return 0;
}
