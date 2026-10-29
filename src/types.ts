import type { RuleId, Severity } from "./rules.js";

/** Any JSON value. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A plain JSON object (the only node shape the differ recurses into). */
export type JsonObject = { [key: string]: JsonValue };

/**
 * One detected difference between the old and the new contract.
 *
 * `severity` is derived from the rule table, never from the caller, so two runs
 * over the same inputs always produce byte-identical output.
 */
export interface Finding {
  /** Stable identifier: `<rule>@<pointer>`. */
  id: string;
  rule: RuleId;
  severity: Severity;
  /** Logical JSON Pointer of the affected node, RFC 6901 escaped. */
  pointer: string;
  /** Human location, e.g. `GET /users/{id}`. */
  location?: string;
  /** One sentence a human can act on. */
  message: string;
  /** Value in the old document, when meaningful. */
  before?: JsonValue;
  /** Value in the new document, when meaningful. */
  after?: JsonValue;
  /** The `$ref` that was followed to reach this node, when any. */
  viaRef?: string;
}

/** Which document family was compared. */
export type ContractKind = "schema" | "openapi" | "env";

/** What `verdictOf` decided. */
export interface Verdict {
  /** The most severe finding bucket, or `null` when there are no findings. */
  verdict: Severity | null;
  /** The semver bump this change requires. */
  bump: "major" | "minor" | "none";
  counts: Record<Severity, number>;
  findings: Finding[];
  /** Total number of findings. */
  total: number;
}

/** Options shared by every differ. */
export interface DiffOptions {
  /**
   * Resolve an external `$ref` specifier (e.g. `./common.json`) to a parsed
   * document. Omit it and only in-document anchors are followed; unresolvable
   * remote refs are reported as `schema.replaced` rather than throwing.
   */
  loadDocument?: (specifier: string) => unknown;
  /** Base pointer prepended to every reported pointer (used for nested calls). */
  basePointer?: string;
  /**
   * Document the old/new $refs resolve against, when the schema being compared
   * is not itself the document root (OpenAPI components, for instance).
   * Defaults to the schema handed to the differ.
   */
  oldRoot?: unknown;
  newRoot?: unknown;
}

/** Result of a full OpenAPI comparison. */
export interface OpenApiDiffResult {
  kind: "openapi";
  oldVersion: string | undefined;
  newVersion: string | undefined;
  findings: Finding[];
}

/** Result of a full JSON Schema comparison. */
export interface SchemaDiffResult {
  kind: "schema";
  findings: Finding[];
}

/** Result of a full .env contract comparison. */
export interface EnvDiffResult {
  kind: "env";
  findings: Finding[];
}
