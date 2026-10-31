import type { DiffOptions, Finding, JsonValue, SchemaDiffResult } from "./types.js";
import { RULES } from "./rules.js";
import { RefResolver, isJsonObject } from "./refs.js";
import { compareScalarRules } from "./schema-scalars.js";
import { compareStructureRules } from "./schema-structure.js";
import { show, type DiffContext, type Emit } from "./schema-util.js";

/**
 * Walks two schema trees in lockstep.
 *
 * Every rule slice (scalars, structure) reports through the same emit callback,
 * so severities always come from the rule table and are never decided inline.
 *
 * Cycle safety has two layers:
 *   1. RefResolver stops a $ref chain that revisits a target.
 *   2. The visited set stops a node pair from being compared twice, which is
 *      what terminates a self-referential object graph.
 */
class SchemaDiffer implements DiffContext {
  private readonly oldResolver: RefResolver;
  private readonly newResolver: RefResolver;
  /**
   * Ref targets currently being expanded, keyed by the resolved pair.
   *
   * This is a stack, not a global visited set: the same target legitimately
   * shows up at several pointers and each occurrence deserves its own finding,
   * but a target that reappears while it is already being expanded is a cycle
   * and must stop, otherwise a self-referential schema recurses forever.
   */
  private readonly expanding = new Set<string>();
  readonly findings: Finding[] = [];

  /**
   * @param oldRoot   document the old $refs resolve against (defaults to the schema itself)
   * @param newRoot   document the new $refs resolve against
   * @param basePointer pointer prefix every finding is reported under
   * @param start     the two nodes to compare, when they are not the roots
   */
  constructor(
    oldRoot: unknown,
    newRoot: unknown,
    private readonly basePointer: string,
    private readonly start: { old: unknown; new: unknown } = { old: oldRoot, new: newRoot },
    loadDocument?: (specifier: string) => unknown,
  ) {
    this.oldResolver = new RefResolver(oldRoot, { rootId: "<old>", ...(loadDocument === undefined ? {} : { loadDocument }) });
    this.newResolver = new RefResolver(newRoot, { rootId: "<new>", ...(loadDocument === undefined ? {} : { loadDocument }) });
  }

  run(): Finding[] {
    this.compare(this.start.old, this.start.new, this.basePointer);
    return this.findings;
  }

  emit(entry: Emit): void {
    const pointer = this.basePointer + entry.pointer;
    this.findings.push({
      id: entry.rule + "@" + pointer,
      rule: entry.rule,
      severity: RULES[entry.rule].severity,
      pointer,
      message: entry.message,
      ...(entry.before === undefined ? {} : { before: entry.before }),
      ...(entry.after === undefined ? {} : { after: entry.after }),
      ...(entry.viaRef === undefined ? {} : { viaRef: entry.viaRef }),
    });
  }

  compare(oldNode: unknown, newNode: unknown, pointer: string): void {
    const oldDeref = this.oldResolver.deref(oldNode);
    const newDeref = this.newResolver.deref(newNode);

    // A cycle is not a difference and must never become one: stopping here is
    // what makes a self-referential `$ref` pair terminate.
    if (oldDeref.cyclic || newDeref.cyclic) return;

    // A broken ref is different. Silently returning made a schema whose whole
    // body is `{"$ref": "missing.json#/x"}` diff clean against itself, which
    // reads as "compatible" when the truth is "this node was never compared".
    if (oldDeref.broken || newDeref.broken) {
      const broken = oldDeref.broken ? oldDeref : newDeref;
      const intact = oldDeref.broken ? newDeref : oldDeref;
      const failed = broken.hops[broken.hops.length - 1];
      const ref = failed === undefined ? "" : failed.ref;
      // Only worth reporting "via" when the other side did resolve: otherwise
      // it is the same dangling ref twice.
      const intactHop = intact.broken ? undefined : intact.hops[intact.hops.length - 1];
      this.emit({
        rule: "schema.ref.broken",
        pointer,
        message: "cannot follow $ref " + show(ref as JsonValue) + ", so this node was not compared",
        before: ref,
        ...(intactHop === undefined ? {} : { viaRef: intactHop.ref }),
      });
      return;
    }

    const lastHop = newDeref.hops[newDeref.hops.length - 1];
    const viaRef = lastHop === undefined ? undefined : lastHop.ref;

    const key = oldDeref.docId + "#" + oldDeref.pointer + "->" + newDeref.docId + "#" + newDeref.pointer;
    const throughRef = oldDeref.hops.length > 0 || newDeref.hops.length > 0;
    if (throughRef) {
      if (this.expanding.has(key)) return;
      this.expanding.add(key);
    }

    try {
      const oldSchema = oldDeref.node;
      const newSchema = newDeref.node;

      if (typeof oldSchema === "boolean" || typeof newSchema === "boolean") {
        this.compareBoolean(oldSchema, newSchema, pointer, viaRef);
        return;
      }

      if (!isJsonObject(oldSchema) || !isJsonObject(newSchema)) {
        if (show(oldSchema as JsonValue) !== show(newSchema as JsonValue)) {
          this.emit({ rule: "schema.replaced", pointer, message: "schema replaced with a non-object form", before: oldSchema as JsonValue, after: newSchema as JsonValue, viaRef });
        }
        return;
      }

      compareScalarRules(oldSchema, newSchema, pointer, viaRef, this);
      compareStructureRules(oldSchema, newSchema, pointer, viaRef, this);
    } finally {
      if (throughRef) this.expanding.delete(key);
    }
  }

  private compareBoolean(oldSchema: unknown, newSchema: unknown, pointer: string, viaRef: string | undefined): void {
    if (oldSchema === newSchema) return;
    if (newSchema === false) {
      this.emit({ rule: "schema.replaced", pointer, message: "schema now rejects every value (false schema)", before: oldSchema as JsonValue, after: false, viaRef });
      return;
    }
    if (newSchema === true) {
      this.emit({ rule: "schema.replaced", pointer, message: "schema now accepts every value (true schema)", before: oldSchema as JsonValue, after: true, viaRef });
      return;
    }
    this.emit({ rule: "schema.replaced", pointer, message: "boolean schema changed", before: oldSchema as JsonValue, after: newSchema as JsonValue, viaRef });
  }
}

/**
 * Compare two JSON Schemas and return every difference.
 *
 * Pure: no IO, no globals, no mutation of the inputs.
 */
export function diffSchemas(oldSchema: unknown, newSchema: unknown, options: DiffOptions = {}): SchemaDiffResult {
  const differ = new SchemaDiffer(options.oldRoot ?? oldSchema, options.newRoot ?? newSchema, "", { old: oldSchema, new: newSchema }, options.loadDocument);
  return { kind: "schema", findings: differ.run() };
}

/**
 * Compare two schemas that live at a known pointer inside a bigger document.
 *
 * `roots` matters for OpenAPI: a $ref inside a response schema points at
 * #/components/schemas/..., which only resolves against the whole document.
 */
export function diffSchemasAt(
  oldSchema: unknown,
  newSchema: unknown,
  pointer: string,
  roots: { oldRoot?: unknown; newRoot?: unknown; loadDocument?: (specifier: string) => unknown } = {},
): Finding[] {
  const differ = new SchemaDiffer(roots.oldRoot ?? oldSchema, roots.newRoot ?? newSchema, "", { old: oldSchema, new: newSchema }, roots.loadDocument);
  differ.compare(oldSchema, newSchema, pointer);
  return differ.findings;
}
