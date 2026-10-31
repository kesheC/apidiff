/**
 * The rule table.
 *
 * Every finding apidiff can emit has exactly one row here. The severity is a
 * property of the rule, not of the caller, so a run is fully reproducible and
 * a reader can audit `--fail-on` behaviour by reading this file alone.
 *
 * Severity ladder (most to least severe):
 *   breaking    -> the change can break an existing consumer   (semver major)
 *   deprecation -> the change announces future removal          (semver minor)
 *   changed     -> the change is compatible / additive          (semver minor)
 */

/** Severity bucket attached to a rule. */
export type Severity = "breaking" | "deprecation" | "changed";

/** Ordered from most severe to least severe. */
export const SEVERITY_LADDER: readonly Severity[] = ["breaking", "deprecation", "changed"];

/** 0 = breaking, 1 = deprecation, 2 = changed. Lower is more severe. */
export function severityRank(severity: Severity): number {
  const index = SEVERITY_LADDER.indexOf(severity);
  return index < 0 ? SEVERITY_LADDER.length : index;
}

/** Human label used by the text reporter. */
export const SEVERITY_LABEL: Record<Severity, string> = {
  breaking: "BREAKING",
  deprecation: "DEPRECATION",
  changed: "CHANGED",
};

export interface RuleDefinition {
  readonly severity: Severity;
  /** One-line explanation, also used by `apidiff --rules`. */
  readonly title: string;
}

export const RULES = {
  // ---------------------------------------------------------------- JSON Schema
  "schema.ref.broken": {
    severity: "changed",
    title: "A $ref could not be resolved and its target was not compared",
  },
  "schema.replaced": {
    severity: "breaking",
    title: "Schema node replaced by an incompatible form (boolean schema or non-object)",
  },
  "schema.type.narrowed": {
    severity: "breaking",
    title: "Accepted JSON type set narrowed (e.g. number -> integer)",
  },
  "schema.type.widened": {
    severity: "changed",
    title: "Accepted JSON type set widened",
  },
  "schema.enum.added": {
    severity: "breaking",
    title: "An enum constraint was introduced where the value was previously free-form",
  },
  "schema.enum.removed": {
    severity: "changed",
    title: "An enum constraint was dropped",
  },
  "schema.enum.value.added": {
    severity: "changed",
    title: "A new enum member was accepted",
  },
  "schema.enum.value.removed": {
    severity: "breaking",
    title: "An enum member is no longer accepted",
  },
  "schema.const.changed": {
    severity: "breaking",
    title: "The const value changed",
  },
  "schema.required.added": {
    severity: "breaking",
    title: "A property became required",
  },
  "schema.required.removed": {
    // A property that was guaranteed may now be absent. Callers that decode a
    // response into a strict type, or that read the field unconditionally, break
    // on the missing value — so the removal of a guarantee is a major bump even
    // though the schema itself became more permissive.
    severity: "breaking",
    title: "A property is no longer required",
  },
  "schema.property.added": {
    severity: "changed",
    title: "A new property was added to the object",
  },
  "schema.property.removed": {
    severity: "breaking",
    title: "A property was removed from the object",
  },
  "schema.bounds.narrowed": {
    severity: "breaking",
    title: "A numeric or size bound got stricter (added, or moved inward)",
  },
  "schema.bounds.widened": {
    severity: "changed",
    title: "A numeric or size bound got looser (removed, or moved outward)",
  },
  "schema.pattern.added": {
    severity: "breaking",
    title: "A pattern constraint was introduced",
  },
  "schema.pattern.removed": {
    severity: "changed",
    title: "A pattern constraint was dropped",
  },
  "schema.pattern.changed": {
    severity: "breaking",
    title: "The pattern constraint changed",
  },
  "schema.format.changed": {
    severity: "changed",
    title: "The format annotation changed (advisory in JSON Schema)",
  },
  "schema.nullable.added": {
    severity: "changed",
    title: "null became an accepted value",
  },
  "schema.nullable.removed": {
    severity: "breaking",
    title: "null is no longer an accepted value",
  },
  "schema.additionalProperties.restricted": {
    severity: "breaking",
    title: "Unknown properties are now rejected or constrained",
  },
  "schema.additionalProperties.relaxed": {
    severity: "changed",
    title: "Unknown properties are now accepted more freely",
  },
  "schema.additionalProperties.changed": {
    severity: "breaking",
    title: "The schema governing unknown properties changed",
  },
  "schema.uniqueItems.added": {
    severity: "breaking",
    title: "Array items must now be unique",
  },
  "schema.uniqueItems.removed": {
    severity: "changed",
    title: "Array items no longer have to be unique",
  },
  "schema.items.added": {
    severity: "breaking",
    title: "An item schema was introduced for an array",
  },
  "schema.items.removed": {
    severity: "changed",
    title: "The array item schema was dropped",
  },
  "schema.composition.added": {
    severity: "breaking",
    title: "A oneOf/anyOf/allOf composition was introduced",
  },
  "schema.composition.removed": {
    severity: "changed",
    title: "A oneOf/anyOf/allOf composition was dropped",
  },
  "schema.composition.changed": {
    severity: "breaking",
    title: "A oneOf/anyOf/allOf composition changed",
  },
  "schema.deprecated.added": {
    severity: "deprecation",
    title: "A schema was marked deprecated",
  },
  "schema.default.changed": {
    severity: "changed",
    title: "The default value changed",
  },

  // ---------------------------------------------------------------- OpenAPI 3.x
  "openapi.version.changed": {
    severity: "breaking",
    title: "The OpenAPI document version changed",
  },
  "openapi.path.added": {
    severity: "changed",
    title: "A new path was added",
  },
  "openapi.path.removed": {
    severity: "breaking",
    title: "A path was removed",
  },
  "openapi.operation.added": {
    severity: "changed",
    title: "A new operation was added",
  },
  "openapi.operation.removed": {
    severity: "breaking",
    title: "An operation was removed",
  },
  "openapi.operation.deprecated": {
    severity: "deprecation",
    title: "An operation was marked deprecated",
  },
  "openapi.operationId.changed": {
    severity: "changed",
    title: "The operationId changed (breaks generated clients)",
  },
  "openapi.parameter.added-optional": {
    severity: "changed",
    title: "An optional parameter was added",
  },
  "openapi.parameter.added-required": {
    severity: "breaking",
    title: "A required parameter was added",
  },
  "openapi.parameter.removed": {
    severity: "breaking",
    title: "A parameter was removed",
  },
  "openapi.parameter.became-required": {
    severity: "breaking",
    title: "An optional parameter became required",
  },
  "openapi.parameter.became-optional": {
    severity: "changed",
    title: "A required parameter became optional",
  },
  "openapi.parameter.location-changed": {
    severity: "breaking",
    title: "A parameter moved between query/path/header/cookie",
  },
  "openapi.requestBody.removed": {
    severity: "breaking",
    title: "A request body was removed",
  },
  "openapi.requestBody.added-optional": {
    severity: "changed",
    title: "An optional request body was added",
  },
  "openapi.requestBody.added-required": {
    severity: "breaking",
    title: "A required request body was added",
  },
  "openapi.requestBody.became-required": {
    severity: "breaking",
    title: "The request body became required",
  },
  "openapi.requestBody.became-optional": {
    severity: "changed",
    title: "The request body became optional",
  },
  "openapi.mediaType.removed": {
    severity: "breaking",
    title: "A media type is no longer accepted or returned",
  },
  "openapi.mediaType.added": {
    severity: "changed",
    title: "A new media type was added",
  },
  "openapi.response.removed": {
    severity: "breaking",
    title: "A response status code is no longer documented",
  },
  "openapi.response.added": {
    severity: "changed",
    title: "A new response status code was documented",
  },

  // ---------------------------------------------------------------- .env contract
  "env.key.removed": {
    severity: "breaking",
    title: "An environment variable was removed",
  },
  "env.key.added": {
    severity: "changed",
    title: "A new environment variable was added",
  },
} as const;

/** Union of every rule id in the table. */
export type RuleId = keyof typeof RULES;