#!/usr/bin/env node
/**
 * apidiff CLI — argument parsing, file IO, and exit codes only.
 *
 * Everything interesting lives in the library; this file deliberately contains
 * no diff logic so it cannot drift from the exported API.
 */
import { constants as bufferConstants } from "node:buffer";
import { readFileSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { UsageError } from "./errors.js";
import { diffDetect, diffEnv, exitCodeOf } from "./index.js";
import { diffOpenApi } from "./openapi-diff.js";
import { formatJson, formatMarkdown, formatRules, formatText } from "./report.js";
import { diffSchemas } from "./schema-diff.js";
import type { Finding } from "./types.js";
import { verdictOf, type FailOn } from "./verdict.js";
import { getVersion } from "./version.js";

type Format = "text" | "json" | "markdown";

interface CliOptions {
  oldPath: string | undefined;
  newPath: string | undefined;
  format: Format;
  failOn: FailOn;
  contract: "auto" | "schema" | "openapi" | "env";
  ascii: boolean;
  quiet: boolean;
  help: boolean;
  version: boolean;
  rules: boolean;
  allowBreaking: boolean;
}

/** Where a run writes. Two sinks so errors can leave on stderr. */
export interface Sinks {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const HELP = [
  "apidiff — semver verdict for API contract changes",
  "",
  "Usage:",
  "  apidiff <old.json> <new.json> [options]",
  "  apidiff <old.env> <new.env> [options]",
  "",
  "Options:",
  "  --contract <auto|schema|openapi|env>  Document family to compare (default: auto)",
  "  --format <text|json|markdown>         Output format (default: text)",
  "  --fail-on <breaking|deprecation|never> Exit 1 at or above this severity (default: breaking)",
  "  --allow-breaking                      Report breaking changes but still exit 0",
  "  --ascii                               Use ASCII branch characters",
  "  --quiet                               Print only the verdict line",
  "  --rules                               Print the rule table and exit",
  "  --version                             Print the version and exit",
  "  -h, --help                            Show this help",
  "",
  "Exit codes:",
  "  0  compatible, or nothing at or above --fail-on",
  "  1  a change at or above --fail-on was found",
  "  2  the command itself failed (bad arguments, unreadable file, bad document)",
  "",
  "Documents are JSON (Schema or OpenAPI) or .env samples; auto-detects which.",
  "OpenAPI must be JSON: convert YAML first, e.g. yq -o=json.",
].join("\n");

/** Parse argv. Throws UsageError for anything a user can fix. */
export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    oldPath: undefined,
    newPath: undefined,
    format: "text",
    failOn: "breaking",
    contract: "auto",
    ascii: false,
    quiet: false,
    help: false,
    version: false,
    rules: false,
    allowBreaking: false,
  };
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-v":
      case "--version":
        options.version = true;
        break;
      case "--rules":
        options.rules = true;
        break;
      case "--ascii":
        options.ascii = true;
        break;
      case "-q":
      case "--quiet":
        options.quiet = true;
        break;
      case "--allow-breaking":
        options.allowBreaking = true;
        break;
      case "--format": {
        const value = argv[(index += 1)];
        if (value !== "text" && value !== "json" && value !== "markdown") {
          throw new UsageError("--format expects text, json, or markdown (got " + String(value) + ")");
        }
        options.format = value;
        break;
      }
      case "--fail-on": {
        const value = argv[(index += 1)];
        if (value !== "breaking" && value !== "deprecation" && value !== "never") {
          throw new UsageError("--fail-on expects breaking, deprecation, or never (got " + String(value) + ")");
        }
        options.failOn = value;
        break;
      }
      case "--contract": {
        const value = argv[(index += 1)];
        if (value !== "auto" && value !== "schema" && value !== "openapi" && value !== "env") {
          throw new UsageError("--contract expects auto, schema, openapi, or env (got " + String(value) + ")");
        }
        options.contract = value;
        break;
      }
      default:
        if (arg.startsWith("-")) throw new UsageError("unknown option " + arg);
        positional.push(arg);
        break;
    }
  }

  if (positional.length > 2) throw new UsageError("expected two files, got " + positional.length);
  options.oldPath = positional[0];
  options.newPath = positional[1];
  if (options.allowBreaking) options.failOn = "never";
  return options;
}

/**
 * Read a file as UTF-8 and refuse to guess.
 *
 * The previous implementation let Node substitute U+FFFD for malformed bytes,
 * which turned a corrupt contract into a silently "compatible" diff. Decoding
 * with `fatal: true` makes that a loud error instead.
 */
function readSource(path: string): string {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new UsageError("cannot read " + path);
  }
  return decodeUtf8(bytes, path);
}

/** V8's ceiling on a single string; above it nothing can be decoded at all. */
export const MAX_TEXT_BYTES = bufferConstants.MAX_STRING_LENGTH;

/**
 * Decode bytes as UTF-8, giving each failure its own message.
 *
 * Two very different things used to share one sentence: a file with broken
 * bytes, and a perfectly valid file too large for V8 to hold as a single
 * string (ERR_STRING_TOO_LONG). Telling a user their 1 GB JSON is "not valid
 * UTF-8" sends them off to repair a file that is fine -- and a file whose
 * bytes are genuinely malformed gets the detail it deserves.
 */
export function decodeUtf8(bytes: Buffer, path: string): string {
  try {
    // ignoreBOM keeps a leading BOM in the text, so a BOM-prefixed file still
    // fails JSON.parse instead of silently changing meaning.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ERR_STRING_TOO_LONG") {
      throw new UsageError(
        path + " is too large to compare (" + bytes.byteLength + " bytes; the text limit is " + MAX_TEXT_BYTES + ")",
      );
    }
    throw new UsageError(path + " is not valid UTF-8");
  }
}

type Parsed = { ok: true; document: unknown } | { ok: false; message: string };

function tryParseJson(text: string): Parsed {
  try {
    return { ok: true, document: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function parseJson(text: string, path: string): unknown {
  const parsed = tryParseJson(text);
  if (!parsed.ok) throw new UsageError("invalid JSON in " + path + ": " + parsed.message);
  return parsed.document;
}

function readJson(path: string): unknown {
  return parseJson(readSource(path), path);
}

function readText(path: string): string {
  return readSource(path);
}

/**
 * The format the run should be reported in, even when argv never parses.
 *
 * `--format json` is a promise that stdout stays JSON; a bad flag must not be
 * allowed to break that promise, so the hint is taken from argv directly.
 */
function formatHint(argv: readonly string[]): Format {
  let hint: Format = "text";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--format") continue;
    const value = argv[index + 1];
    if (value === "text" || value === "json" || value === "markdown") hint = value;
    index += 1;
  }
  return hint;
}

/**
 * Report a user-fixable failure.
 *
 * The human sentence always goes to stderr, so `2>/dev/null` hides it and a
 * pipeline on stdout stays clean. When the caller asked for JSON, stdout gets a
 * one-object error document instead of prose, so `| jq` keeps parsing.
 */
function failure(sinks: Sinks, format: Format, message: string, showHelp: boolean): number {
  if (format === "json") {
    sinks.stdout(JSON.stringify({ error: { message }, exitCode: 2 }));
  }
  sinks.stderr("error: " + message);
  if (showHelp) sinks.stderr("run apidiff --help for usage");
  return 2;
}

/** `.env`, `.env.local`, `app.env` — the names a dotenv sample actually uses. */
function looksLikeEnvName(path: string): boolean {
  const name = basename(path);
  return /^\.env(\..+)?$/i.test(name) || /\.env$/i.test(name);
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_.]*$/;

/**
 * Decide by content whether a file is a dotenv sample rather than JSON.
 *
 * Deliberately strict: no braces anywhere, and every meaningful line has to be
 * `KEY=value` (with an optional leading `export `). JSON and YAML both fail
 * that, so this cannot steal a document the JSON parser would have accepted.
 */
function looksLikeEnvText(text: string): boolean {
  if (text.includes("{") || text.includes("}")) return false;
  let assignments = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equals = body.indexOf("=");
    if (equals < 0) return false;
    if (!ENV_KEY.test(body.slice(0, equals).trim())) return false;
    assignments += 1;
  }
  return assignments > 0;
}

type AutoSide =
  | { kind: "document"; document: unknown }
  | { kind: "env" }
  | { kind: "unparsed"; message: string };

/** Narrow for the mixed-family check: only an env side can mismatch. */
function isEnv(side: AutoSide): boolean {
  return side.kind === "env";
}

/**
 * Classify one side of an auto-detected comparison.
 *
 * Content is authoritative: if the bytes parse as JSON, this is a document,
 * full stop. The filename only gets a vote once JSON parsing has already
 * failed, which is the case a dotenv sample is actually in. That ordering is
 * what keeps `.env.schema.json` (a real schema whose name happens to start
 * with `.env`) out of the environment differ.
 */
function autoSide(text: string, path: string): AutoSide {
  const parsed = tryParseJson(text);
  if (parsed.ok) return { kind: "document", document: parsed.document };
  if (looksLikeEnvName(path) || looksLikeEnvText(text)) return { kind: "env" };
  return { kind: "unparsed", message: parsed.message };
}

/** Why a document is not a usable schema root, or undefined when it is one. */
function schemaRootProblem(document: unknown): string | undefined {
  if (typeof document === "boolean") return undefined;
  if (Array.isArray(document)) return "an array";
  if (document === null) return "null";
  if (typeof document === "number") return "a number";
  if (typeof document === "string") return "a string";
  return undefined;
}

/**
 * Run the CLI. Returns the process exit code; never calls process.exit.
 *
 * `stderr` defaults to `stdout` so a caller that only wants one stream (a log
 * buffer, a test) keeps working.
 */
export function run(argv: readonly string[], stdout: (line: string) => void, stderr: (line: string) => void = stdout): number {
  const sinks: Sinks = { stdout, stderr };

  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) return failure(sinks, formatHint(argv), error.message, true);
    throw error;
  }

  if (options.help) {
    stdout(HELP);
    return 0;
  }
  if (options.version) {
    stdout(getVersion());
    return 0;
  }
  if (options.rules) {
    stdout(formatRules());
    return 0;
  }

  if (options.oldPath === undefined || options.newPath === undefined) {
    return failure(sinks, options.format, "two files are required", true);
  }
  const oldPath = options.oldPath;
  const newPath = options.newPath;

  let findings: Finding[];
  try {
    findings = compare(options, oldPath, newPath);
  } catch (error) {
    if (error instanceof UsageError) return failure(sinks, options.format, error.message, false);
    throw error;
  }

  const verdict = verdictOf(findings);

  if (options.quiet) {
    stdout(verdict.verdict === null ? "compatible" : verdict.verdict + " (" + verdict.bump + ")");
  } else if (options.format === "json") {
    stdout(JSON.stringify(formatJson(verdict), null, 2));
  } else if (options.format === "markdown") {
    stdout(formatMarkdown(verdict));
  } else {
    stdout(formatText(verdict, { ascii: options.ascii }));
  }

  return exitCodeOf(verdict, options.failOn);
}

/** Read both inputs, pick a differ, and return the findings. */
function compare(options: CliOptions, oldPath: string, newPath: string): Finding[] {
  if (options.contract === "env") {
    return diffEnv(readText(oldPath), readText(newPath)).findings;
  }

  if (options.contract !== "auto") {
    const oldDocument = readJson(oldPath);
    const newDocument = readJson(newPath);
    if (options.contract === "schema") {
      assertSchemaRoot(oldDocument, oldPath);
      assertSchemaRoot(newDocument, newPath);
      return diffSchemas(oldDocument, newDocument).findings;
    }
    return diffOpenApi(oldDocument, newDocument).findings;
  }

  // auto: content decides first, so a file that is valid JSON is diffed as a
  // document no matter what it is called. A name is only a label for bytes
  // the JSON parser has already refused -- otherwise `.env.schema.json`
  // holding a perfectly good schema would be read as environment keys.
  const oldText = readText(oldPath);
  const newText = readText(newPath);
  const oldSide = autoSide(oldText, oldPath);
  const newSide = autoSide(newText, newPath);

  if (oldSide.kind === "env" && newSide.kind === "env") return diffEnv(oldText, newText).findings;
  if (isEnv(oldSide) !== isEnv(newSide)) {
    const envPath = isEnv(oldSide) ? oldPath : newPath;
    const otherPath = isEnv(oldSide) ? newPath : oldPath;
    throw new UsageError(
      envPath + " is an environment file but " + otherPath + " is not; pass --contract to say which family these files are",
    );
  }
  if (oldSide.kind === "unparsed") throw new UsageError("invalid JSON in " + oldPath + ": " + oldSide.message);
  if (newSide.kind === "unparsed") throw new UsageError("invalid JSON in " + newPath + ": " + newSide.message);
  if (oldSide.kind !== "document" || newSide.kind !== "document") {
    throw new UsageError("internal error: unresolved contract family");
  }

  assertSchemaRoot(oldSide.document, oldPath);
  assertSchemaRoot(newSide.document, newPath);
  return diffDetect(oldSide.document, newSide.document).findings;
}

function assertSchemaRoot(document: unknown, path: string): void {
  const problem = schemaRootProblem(document);
  if (problem === undefined) return;
  throw new UsageError(path + " is not a JSON Schema (root is " + problem + ")");
}

/** The real process streams, as sinks. */
const PROCESS_SINKS: Sinks = {
  stdout: (line) => process.stdout.write(line + "\n"),
  stderr: (line) => process.stderr.write(line + "\n"),
};

/**
 * Entry point used by the bin shim. Writes to both streams and sets no exit code.
 *
 * The catch is the last line of defence, and it exists for one reason: exit
 * code 1 means "a change at or above --fail-on was found". Anything that
 * escapes the diff engine is a bug in this program, and letting it unwind
 * made the process die with exit 1 and an empty stdout -- a crashed stack
 * overflow reported to CI as a breaking API change. Every escape now lands on
 * the documented contract: exit 2, a human line on stderr, and a single JSON
 * error object on stdout when the caller asked for JSON.
 */
export function main(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    return run(argv, PROCESS_SINKS.stdout, PROCESS_SINKS.stderr);
  } catch (error) {
    const detail = error instanceof Error ? error.name + ": " + error.message : String(error);
    return failure(PROCESS_SINKS, formatHint(argv), "internal error: " + detail, false);
  }
}

// realpathSync on both sides: npm links the bin shim to this file, so
// process.argv[1] is the symlink while import.meta.url is already the real
// path. Comparing raw paths makes the CLI exit silently doing nothing.
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  process.exitCode = main();
}

export { formatRules };
