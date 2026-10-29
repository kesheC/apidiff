import type { JsonObject, JsonValue } from "./types.js";
import { appendPointer } from "./refs.js";
import {
  compareLower,
  compareUpper,
  covers,
  describeLower,
  describeUpper,
  formatTypes,
  lowerBound,
  nonNullTypes,
  nullable,
  num,
  show,
  upperBound,
  type DiffContext,
} from "./schema-util.js";

const LOWER_BOUND_KEYS = ["minimum", "minLength", "minItems", "minProperties"] as const;
const UPPER_BOUND_KEYS = ["maximum", "maxLength", "maxItems", "maxProperties"] as const;

/** Type, nullability, enum, const, bounds, pattern, format, default, deprecation. */
export function compareScalarRules(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  compareTypes(o, n, pointer, viaRef, ctx);
  compareNullability(o, n, pointer, viaRef, ctx);
  compareEnum(o, n, pointer, viaRef, ctx);
  compareConst(o, n, pointer, viaRef, ctx);
  compareBounds(o, n, pointer, viaRef, ctx);
  comparePattern(o, n, pointer, viaRef, ctx);
  compareFormat(o, n, pointer, viaRef, ctx);
  compareDeprecated(o, n, pointer, viaRef, ctx);
  compareDefault(o, n, pointer, viaRef, ctx);
}

function compareTypes(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  const oldTypes = nonNullTypes(o);
  const newTypes = nonNullTypes(n);
  if (oldTypes === undefined && newTypes === undefined) return;
  if (newTypes === undefined) {
    if (oldTypes === undefined || oldTypes.size === 0) return;
    ctx.emit({ rule: "schema.type.widened", pointer, message: "type constraint removed; any type is now accepted (was " + formatTypes(oldTypes) + ")", before: formatTypes(oldTypes), viaRef });
    return;
  }
  if (oldTypes === undefined || oldTypes.size === 0) {
    ctx.emit({ rule: "schema.type.narrowed", pointer, message: "type constraint introduced: only " + formatTypes(newTypes) + " is now accepted", after: formatTypes(newTypes), viaRef });
    return;
  }
  const oldCoversNew = covers(oldTypes, newTypes);
  const newCoversOld = covers(newTypes, oldTypes);
  if (oldCoversNew && newCoversOld) return;
  if (oldCoversNew) {
    ctx.emit({ rule: "schema.type.narrowed", pointer, message: "type narrowed from " + formatTypes(oldTypes) + " to " + formatTypes(newTypes), before: formatTypes(oldTypes), after: formatTypes(newTypes), viaRef });
    return;
  }
  if (newCoversOld) {
    ctx.emit({ rule: "schema.type.widened", pointer, message: "type widened from " + formatTypes(oldTypes) + " to " + formatTypes(newTypes), before: formatTypes(oldTypes), after: formatTypes(newTypes), viaRef });
    return;
  }
  ctx.emit({ rule: "schema.type.narrowed", pointer, message: "type changed from " + formatTypes(oldTypes) + " to " + formatTypes(newTypes) + " (not a pure widening)", before: formatTypes(oldTypes), after: formatTypes(newTypes), viaRef });
}

function compareNullability(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  const wasNullable = nullable(o);
  const isNullable = nullable(n);
  if (wasNullable === isNullable) return;
  if (isNullable) ctx.emit({ rule: "schema.nullable.added", pointer, message: "null is now an accepted value", after: true, viaRef });
  else ctx.emit({ rule: "schema.nullable.removed", pointer, message: "null is no longer accepted", before: true, viaRef });
}

function compareEnum(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  const oldEnum = Array.isArray(o.enum) ? o.enum : undefined;
  const newEnum = Array.isArray(n.enum) ? n.enum : undefined;
  if (oldEnum === undefined && newEnum === undefined) return;
  if (oldEnum === undefined) {
    ctx.emit({ rule: "schema.enum.added", pointer, message: "values are now restricted to an enum of " + newEnum!.length + " members", after: newEnum as JsonValue, viaRef });
    return;
  }
  if (newEnum === undefined) {
    ctx.emit({ rule: "schema.enum.removed", pointer, message: "enum constraint removed; any value is now accepted", before: oldEnum as JsonValue, viaRef });
    return;
  }
  const key = (value: JsonValue): string => JSON.stringify(value);
  const oldKeys = new Set(oldEnum.map(key));
  const newKeys = new Set(newEnum.map(key));
  for (const value of newEnum) {
    if (!oldKeys.has(key(value))) ctx.emit({ rule: "schema.enum.value.added", pointer, message: "enum member " + key(value) + " is now accepted", after: value, viaRef });
  }
  for (const value of oldEnum) {
    if (!newKeys.has(key(value))) ctx.emit({ rule: "schema.enum.value.removed", pointer, message: "enum member " + key(value) + " is no longer accepted", before: value, viaRef });
  }
}

function compareConst(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  if (!("const" in o) && !("const" in n)) return;
  const before = o.const;
  const after = n.const;
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  ctx.emit({ rule: "schema.const.changed", pointer, message: "const changed from " + show(before) + " to " + show(after), before, after, viaRef });
}

/**
 * Bounds are reported per keyword, plus one aggregate note when the same bound
 * moved through a different keyword spelling (minimum -> exclusiveMinimum).
 * Emitting both for the same keyword would double-count one change.
 */
function compareBounds(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  let lowerKeyChanged = false;
  let upperKeyChanged = false;

  const allKeys: readonly string[] = [...LOWER_BOUND_KEYS, ...UPPER_BOUND_KEYS];
  for (const key of allKeys) {
    const isLower = (LOWER_BOUND_KEYS as readonly string[]).includes(key);
    if (isLower) {
      if (num(o[key]) !== num(n[key])) lowerKeyChanged = true;
    } else if (num(o[key]) !== num(n[key])) {
      upperKeyChanged = true;
    }
  }

  const oldLower = lowerBound(o);
  const newLower = lowerBound(n);
  const lowerDelta = compareLower(oldLower, newLower);
  if (!lowerKeyChanged && lowerDelta === -1) {
    ctx.emit({ rule: "schema.bounds.narrowed", pointer, message: "lower bound tightened to " + describeLower(newLower), before: oldLower.value, after: newLower.value, viaRef });
  } else if (!lowerKeyChanged && lowerDelta === 1) {
    ctx.emit({ rule: "schema.bounds.widened", pointer, message: "lower bound relaxed to " + describeLower(newLower), before: oldLower.value, after: newLower.value, viaRef });
  }

  const oldUpper = upperBound(o);
  const newUpper = upperBound(n);
  const upperDelta = compareUpper(oldUpper, newUpper);
  if (!upperKeyChanged && upperDelta === -1) {
    ctx.emit({ rule: "schema.bounds.narrowed", pointer, message: "upper bound tightened to " + describeUpper(newUpper), before: oldUpper.value, after: newUpper.value, viaRef });
  } else if (!upperKeyChanged && upperDelta === 1) {
    ctx.emit({ rule: "schema.bounds.widened", pointer, message: "upper bound relaxed to " + describeUpper(newUpper), before: oldUpper.value, after: newUpper.value, viaRef });
  }

  for (const key of allKeys) {
    const before = num(o[key]);
    const after = num(n[key]);
    if (before === after) continue;
    const isLowerKey = (LOWER_BOUND_KEYS as readonly string[]).includes(key);
    const stricter = before === undefined ? true : after === undefined ? false : isLowerKey ? after > before : after < before;
    ctx.emit({
      rule: stricter ? "schema.bounds.narrowed" : "schema.bounds.widened",
      pointer: appendPointer(pointer, key),
      message: key + " " + (before === undefined ? "added as " + show(after) : "changed from " + show(before) + " to " + show(after)),
      before,
      after,
      viaRef,
    });
  }

  const oldMultiple = num(o.multipleOf);
  const newMultiple = num(n.multipleOf);
  if (oldMultiple !== newMultiple) {
    const stricter = oldMultiple === undefined || newMultiple !== undefined;
    ctx.emit({
      rule: stricter ? "schema.bounds.narrowed" : "schema.bounds.widened",
      pointer: appendPointer(pointer, "multipleOf"),
      message: "multipleOf " + (oldMultiple === undefined ? "introduced as " + show(newMultiple) : "changed from " + show(oldMultiple) + " to " + show(newMultiple)),
      before: oldMultiple,
      after: newMultiple,
      viaRef,
    });
  }
}

function comparePattern(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  const before = typeof o.pattern === "string" ? o.pattern : undefined;
  const after = typeof n.pattern === "string" ? n.pattern : undefined;
  if (before === after) return;
  if (before === undefined) ctx.emit({ rule: "schema.pattern.added", pointer, message: "pattern constraint introduced: " + after, after, viaRef });
  else if (after === undefined) ctx.emit({ rule: "schema.pattern.removed", pointer, message: "pattern constraint removed", before, viaRef });
  else ctx.emit({ rule: "schema.pattern.changed", pointer, message: "pattern changed from " + before + " to " + after, before, after, viaRef });
}

function compareFormat(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  const before = typeof o.format === "string" ? o.format : undefined;
  const after = typeof n.format === "string" ? n.format : undefined;
  if (before === after) return;
  ctx.emit({ rule: "schema.format.changed", pointer, message: "format changed from " + show(before) + " to " + show(after), before, after, viaRef });
}

function compareDeprecated(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  if (n.deprecated === true && o.deprecated !== true) ctx.emit({ rule: "schema.deprecated.added", pointer, message: "schema is now deprecated", after: true, viaRef });
}

function compareDefault(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  if (!("default" in o) && !("default" in n)) return;
  const before = o.default;
  const after = n.default;
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  ctx.emit({ rule: "schema.default.changed", pointer: appendPointer(pointer, "default"), message: "default changed from " + show(before) + " to " + show(after), before, after, viaRef });
}
