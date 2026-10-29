import type { JsonObject, JsonValue } from "./types.js";
import type { RuleId } from "./rules.js";

/** One pending finding, before the severity and id are attached. */
export interface Emit {
  rule: RuleId;
  pointer: string;
  message: string;
  before?: JsonValue;
  after?: JsonValue;
  viaRef?: string;
}

/** What a rule slice needs from the differ that drives it. */
export interface DiffContext {
  emit(entry: Emit): void;
  compare(oldNode: unknown, newNode: unknown, pointer: string): void;
}

/** Coerce to a number, or undefined. */
export function num(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Render a JSON value for a message. */
export function show(value: JsonValue | undefined): string {
  return value === undefined ? "<unset>" : JSON.stringify(value);
}

/** The declared type keyword as a set, or undefined when absent. */
export function typeSet(schema: JsonObject): Set<string> | undefined {
  const type = schema.type;
  if (typeof type === "string") return new Set([type]);
  if (Array.isArray(type) && type.every((entry) => typeof entry === "string")) return new Set(type as string[]);
  return undefined;
}

/** null is accepted via type, enum, or the OpenAPI 3.0 nullable flag. */
export function nullable(schema: JsonObject): boolean {
  if (schema.nullable === true) return true;
  const type = schema.type;
  if (typeof type === "string") return type === "null";
  if (Array.isArray(type)) return type.includes("null");
  if (Array.isArray(schema.enum)) return schema.enum.includes(null);
  return false;
}

/** The declared types minus null, so nullability has exactly one owner. */
export function nonNullTypes(schema: JsonObject): Set<string> | undefined {
  const set = typeSet(schema);
  if (set === undefined) return undefined;
  set.delete("null");
  return set;
}

/** Does type set `a` accept every type `b` accepts? integer fits number. */
export function covers(a: Set<string>, b: Set<string>): boolean {
  for (const type of b) {
    if (a.has(type)) continue;
    if (type === "integer" && a.has("number")) continue;
    return false;
  }
  return true;
}

/** Render a type set for a message. */
export function formatTypes(set: Set<string> | undefined): string {
  if (set === undefined || set.size === 0) return "any";
  return [...set].sort().join(" | ");
}

/** draft-04 booleans and draft-06 numbers collapsed into one comparable bound. */
export interface NumericBound {
  value: number | undefined;
  exclusive: boolean;
}

export function lowerBound(schema: JsonObject): NumericBound {
  const minimum = num(schema.minimum);
  const exclusive = schema.exclusiveMinimum;
  if (typeof exclusive === "number") {
    if (minimum === undefined || exclusive >= minimum) return { value: exclusive, exclusive: true };
    return { value: minimum, exclusive: false };
  }
  return { value: minimum, exclusive: exclusive === true };
}

export function upperBound(schema: JsonObject): NumericBound {
  const maximum = num(schema.maximum);
  const exclusive = schema.exclusiveMaximum;
  if (typeof exclusive === "number") {
    if (maximum === undefined || exclusive <= maximum) return { value: exclusive, exclusive: true };
    return { value: maximum, exclusive: false };
  }
  return { value: maximum, exclusive: exclusive === true };
}

/** -1 stricter, 0 same, 1 looser for a lower bound. */
export function compareLower(a: NumericBound, b: NumericBound): number {
  if (a.value === undefined && b.value === undefined) return 0;
  if (a.value === undefined) return -1;
  if (b.value === undefined) return 1;
  if (b.value > a.value) return -1;
  if (b.value < a.value) return 1;
  if (a.exclusive === b.exclusive) return 0;
  return b.exclusive ? -1 : 1;
}

/** -1 stricter, 0 same, 1 looser for an upper bound. */
export function compareUpper(a: NumericBound, b: NumericBound): number {
  if (a.value === undefined && b.value === undefined) return 0;
  if (a.value === undefined) return -1;
  if (b.value === undefined) return 1;
  if (b.value < a.value) return -1;
  if (b.value > a.value) return 1;
  if (a.exclusive === b.exclusive) return 0;
  return b.exclusive ? -1 : 1;
}

export function describeLower(bound: NumericBound): string {
  if (bound.value === undefined) return "unbounded";
  return (bound.exclusive ? "> " : ">= ") + String(bound.value);
}

export function describeUpper(bound: NumericBound): string {
  if (bound.value === undefined) return "unbounded";
  return (bound.exclusive ? "< " : "<= ") + String(bound.value);
}
