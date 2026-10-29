import type { JsonObject, JsonValue } from "./types.js";
import { appendPointer, isJsonObject } from "./refs.js";
import type { DiffContext } from "./schema-util.js";

const COMPOSITION_KEYS = ["allOf", "anyOf", "oneOf"] as const;

/** properties / required / additionalProperties / items / uniqueItems / compositions. */
export function compareStructureRules(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  compareObjectShape(o, n, pointer, viaRef, ctx);
  compareArrayShape(o, n, pointer, viaRef, ctx);
  compareComposition(o, n, pointer, viaRef, ctx);
}

function stringSet(value: JsonValue | undefined): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((entry): entry is string => typeof entry === "string"));
}

function compareObjectShape(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  const oldProps = isJsonObject(o.properties) ? o.properties : {};
  const newProps = isJsonObject(n.properties) ? n.properties : {};
  const oldRequired = stringSet(o.required);
  const newRequired = stringSet(n.required);

  for (const name of Object.keys(newProps)) {
    const childPointer = appendPointer(pointer, "properties", name);
    if (!Object.prototype.hasOwnProperty.call(oldProps, name)) {
      ctx.emit({
        rule: "schema.property.added",
        pointer: childPointer,
        message: "property " + JSON.stringify(name) + " was added" + (newRequired.has(name) ? " and is required" : ""),
        after: newProps[name] as JsonValue,
        viaRef,
      });
      if (newRequired.has(name)) {
        ctx.emit({ rule: "schema.required.added", pointer: appendPointer(pointer, "required"), message: "property " + JSON.stringify(name) + " is required", after: name, viaRef });
      }
      continue;
    }
    if (newRequired.has(name) && !oldRequired.has(name)) {
      ctx.emit({ rule: "schema.required.added", pointer: appendPointer(pointer, "required"), message: "property " + JSON.stringify(name) + " became required", after: name, viaRef });
    }
    if (!newRequired.has(name) && oldRequired.has(name)) {
      ctx.emit({ rule: "schema.required.removed", pointer: appendPointer(pointer, "required"), message: "property " + JSON.stringify(name) + " is no longer required", before: name, viaRef });
    }
    ctx.compare(oldProps[name], newProps[name], childPointer);
  }

  for (const name of Object.keys(oldProps)) {
    if (Object.prototype.hasOwnProperty.call(newProps, name)) continue;
    ctx.emit({ rule: "schema.property.removed", pointer: appendPointer(pointer, "properties", name), message: "property " + JSON.stringify(name) + " was removed", before: oldProps[name] as JsonValue, viaRef });
  }

  // `required` can name a property the schema does not describe (common with
  // additionalProperties), so the loops above would miss it entirely.
  for (const name of oldRequired) {
    if (newRequired.has(name)) continue;
    if (Object.prototype.hasOwnProperty.call(newProps, name)) continue;
    ctx.emit({ rule: "schema.required.removed", pointer: appendPointer(pointer, "required"), message: "property " + JSON.stringify(name) + " is no longer required", before: name, viaRef });
  }

  compareAdditionalProperties(o, n, pointer, viaRef, ctx);
}

function compareAdditionalProperties(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  const before = o.additionalProperties;
  const after = n.additionalProperties;
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const oldAllowed = before === undefined || before === true;
  const newAllowed = after === undefined || after === true;
  const childPointer = appendPointer(pointer, "additionalProperties");
  if (oldAllowed && !newAllowed) {
    ctx.emit({ rule: "schema.additionalProperties.restricted", pointer: childPointer, message: "additional properties are no longer accepted", after: after as JsonValue, viaRef });
    return;
  }
  if (!oldAllowed && newAllowed) {
    ctx.emit({ rule: "schema.additionalProperties.relaxed", pointer: childPointer, message: "additional properties are now accepted freely", before: before as JsonValue, viaRef });
    return;
  }
  if (before === false && after === false) return;
  ctx.emit({ rule: "schema.additionalProperties.changed", pointer: childPointer, message: "the additionalProperties schema changed", before: before as JsonValue, after: after as JsonValue, viaRef });
  if (isJsonObject(before) && isJsonObject(after)) ctx.compare(before, after, childPointer);
}

function compareArrayShape(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  const oldUnique = o.uniqueItems === true;
  const newUnique = n.uniqueItems === true;
  if (oldUnique !== newUnique) {
    if (newUnique) ctx.emit({ rule: "schema.uniqueItems.added", pointer: appendPointer(pointer, "uniqueItems"), message: "array items must now be unique", after: true, viaRef });
    else ctx.emit({ rule: "schema.uniqueItems.removed", pointer: appendPointer(pointer, "uniqueItems"), message: "array items no longer have to be unique", before: true, viaRef });
  }

  const before = o.items;
  const after = n.items;
  if (before === undefined && after !== undefined) {
    ctx.emit({ rule: "schema.items.added", pointer: appendPointer(pointer, "items"), message: "an item schema was introduced for this array", after: after as JsonValue, viaRef });
    return;
  }
  if (before !== undefined && after === undefined) {
    ctx.emit({ rule: "schema.items.removed", pointer: appendPointer(pointer, "items"), message: "the item schema was removed; any item shape is now accepted", before: before as JsonValue, viaRef });
    return;
  }
  if (before === undefined && after === undefined) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) ctx.compare(before[index], after[index], appendPointer(pointer, "items", String(index)));
    return;
  }
  ctx.compare(before, after, appendPointer(pointer, "items"));
}

function compareComposition(o: JsonObject, n: JsonObject, pointer: string, viaRef: string | undefined, ctx: DiffContext): void {
  for (const key of COMPOSITION_KEYS) {
    const before = o[key];
    const after = n[key];
    if (before === undefined && after === undefined) continue;
    const childPointer = appendPointer(pointer, key);
    if (before === undefined) {
      ctx.emit({ rule: "schema.composition.added", pointer: childPointer, message: key + " composition introduced", after: after as JsonValue, viaRef });
      continue;
    }
    if (after === undefined) {
      ctx.emit({ rule: "schema.composition.removed", pointer: childPointer, message: key + " composition removed", before: before as JsonValue, viaRef });
      continue;
    }
    if (!Array.isArray(before) || !Array.isArray(after)) {
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        ctx.emit({ rule: "schema.composition.changed", pointer: childPointer, message: key + " composition changed", before: before as JsonValue, after: after as JsonValue, viaRef });
      }
      continue;
    }
    if (before.length !== after.length) {
      ctx.emit({ rule: "schema.composition.changed", pointer: childPointer, message: key + " branch count changed from " + before.length + " to " + after.length, before: before.length, after: after.length, viaRef });
    }
    const length = Math.min(before.length, after.length);
    for (let index = 0; index < length; index += 1) ctx.compare(before[index], after[index], appendPointer(pointer, key, String(index)));
  }
}
