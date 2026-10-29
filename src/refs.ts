import type { JsonObject } from "./types.js";

/** RFC 6901 escaping: "~" -> "~0", "/" -> "~1". */
export function escapeSegment(segment: string): string {
  return segment.split("~").join("~0").split("/").join("~1");
}

/** RFC 6901 unescaping. */
export function unescapeSegment(segment: string): string {
  return segment.split("~1").join("/").split("~0").join("~");
}

/** Join pointer segments into an RFC 6901 pointer ("" is the document root). */
export function pointerOf(segments: readonly (string | number)[]): string {
  let out = "";
  for (const segment of segments) out += "/" + escapeSegment(String(segment));
  return out;
}

/** Append segments to an existing pointer. */
export function appendPointer(pointer: string, ...segments: (string | number)[]): string {
  return pointer + pointerOf(segments);
}

/** Split a pointer into unescaped segments. */
export function splitPointer(pointer: string): string[] {
  if (pointer === "" || pointer === "#") return [];
  const body = pointer.startsWith("#") ? pointer.slice(1) : pointer;
  if (!body.startsWith("/")) return [];
  return body.slice(1).split("/").map(unescapeSegment);
}

/** True for non-array, non-null objects. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Walk a document by pointer. Returns undefined when the path is missing. */
export function getByPointer(document: unknown, pointer: string): unknown {
  let node: unknown = document;
  for (const segment of splitPointer(pointer)) {
    if (Array.isArray(node)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= node.length) return undefined;
      node = node[index];
    } else if (isJsonObject(node)) {
      if (!Object.prototype.hasOwnProperty.call(node, segment)) return undefined;
      node = node[segment];
    } else {
      return undefined;
    }
  }
  return node;
}

/** Split "./file.json#/a/b" into its file part and pointer part. */
export function parseRef(ref: string): { file: string; pointer: string } {
  const hash = ref.indexOf("#");
  if (hash < 0) return { file: ref, pointer: "" };
  return { file: ref.slice(0, hash), pointer: ref.slice(hash + 1) };
}

/** The literal $ref string of a node, if it has one. */
export function refOf(node: unknown): string | undefined {
  return isJsonObject(node) && typeof node.$ref === "string" ? node.$ref : undefined;
}

/** A single $ref hop. */
export interface RefHop {
  /** Document the hop landed in. */
  docId: string;
  /** Pointer inside that document. */
  pointer: string;
  /** The literal $ref string. */
  ref: string;
}

/** Where dereferencing ended up. */
export interface DerefResult {
  node: unknown;
  docId: string;
  pointer: string;
  /** Every hop taken, in order. Empty when the node was not a $ref. */
  hops: RefHop[];
  /** True when the chain revisited a target (a cycle) and stopped. */
  cyclic: boolean;
  /** True when a hop could not be followed. */
  broken: boolean;
}

const defaultRootId = "<root>";

/**
 * Follows $ref chains across documents.
 *
 * Cycles terminate: the chain stops as soon as it revisits a (docId, pointer)
 * pair, and the caller sees cyclic: true. Broken refs stop with broken: true
 * and leave the raw $ref node in place, so a differ can report it instead of
 * crashing.
 */
export class RefResolver {
  private readonly documents = new Map<string, unknown>();
  private readonly rootId: string;
  private readonly loader: ((specifier: string) => unknown) | undefined;
  private readonly loadFailures = new Set<string>();

  constructor(
    root: unknown,
    options: { loadDocument?: (specifier: string) => unknown; rootId?: string } = {},
  ) {
    this.rootId = options.rootId ?? defaultRootId;
    this.loader = options.loadDocument;
    this.documents.set(this.rootId, root);
  }

  /** Which document id this resolver treats as the root. */
  get rootDocumentId(): string {
    return this.rootId;
  }

  /** The stored document for an id, loading it on first use. */
  private document(docId: string): unknown {
    if (this.documents.has(docId)) return this.documents.get(docId);
    if (this.loader === undefined || this.loadFailures.has(docId)) return undefined;
    try {
      const loaded = this.loader(docId);
      this.documents.set(docId, loaded);
      return loaded;
    } catch {
      this.loadFailures.add(docId);
      return undefined;
    }
  }

  /** Dereference a node, following $ref chains. */
  deref(node: unknown, docId: string = this.rootId): DerefResult {
    const hops: RefHop[] = [];
    const seen = new Set<string>();
    let current = node;
    let currentDoc = docId;
    let currentPointer = "";

    while (isJsonObject(current) && typeof current.$ref === "string") {
      const ref = current.$ref;
      const parsed = parseRef(ref);
      const targetDocId = parsed.file === "" ? currentDoc : parsed.file;
      const key = targetDocId + "#" + parsed.pointer;
      if (seen.has(key)) {
        return { node: current, docId: currentDoc, pointer: currentPointer, hops, cyclic: true, broken: false };
      }
      seen.add(key);
      hops.push({ docId: targetDocId, pointer: parsed.pointer, ref });

      const document = this.document(targetDocId);
      if (document === undefined) {
        return { node: current, docId: currentDoc, pointer: currentPointer, hops, cyclic: false, broken: true };
      }
      const target = getByPointer(document, parsed.pointer);
      if (target === undefined) {
        return { node: current, docId: currentDoc, pointer: currentPointer, hops, cyclic: false, broken: true };
      }
      current = target;
      currentDoc = targetDocId;
      currentPointer = parsed.pointer;
    }

    return { node: current, docId: currentDoc, pointer: currentPointer, hops, cyclic: false, broken: false };
  }

  /** Resolve a node to a plain schema object, or undefined when broken. */
  resolve(node: unknown, docId?: string): unknown {
    const result = this.deref(node, docId);
    return result.broken ? undefined : result.node;
  }

  /** Whether two dereferences point at the same physical node. */
  static sameTarget(a: DerefResult, b: DerefResult): boolean {
    return a.docId === b.docId && a.pointer === b.pointer;
  }
}
