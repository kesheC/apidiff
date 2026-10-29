#!/usr/bin/env node
/**
 * apidiff CLI — argument parsing, file IO, and exit codes only.
 *
 * Everything interesting lives in the library; this file deliberately contains
 * no diff logic so it cannot drift from the exported API.
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { diffDetect, diffEnv } from "./index.js";
import { diffOpenApi } from "./openapi-diff.js";
import { formatJson, formatMarkdown, formatRules, formatText } from "./report.js";
import { diffSchemas } from "./schema-diff.js";
import type { Finding } from "./types.js";
import { exitCodeOf } from "./index.js";
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

const HELP = [
  "apidiff — semver verdict for API contract changes",
  "",
  "Usage:",
  "  apidiff <old.json> <new.json> [options]",
  "  apidiff --contract env <old.env> <new.env>",
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
  "  2  the command itself failed (bad arguments, unreadable file, bad JSON)",
  "",
  "Both documents must be JSON (OpenAPI: convert YAML first, e.g. yq -o=json).",
].join("\n");

class UsageError extends Error {}

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

function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new UsageError("cannot read " + path);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError("invalid JSON in " + path + ": " + message);
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new UsageError("cannot read " + path);
  }
}

/** Run the CLI. Returns the process exit code; never calls process.exit. */
export function run(argv: readonly string[], stdout: (line: string) => void): number {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      stdout("error: " + error.message);
      stdout("run apidiff --help for usage");
      return 2;
    }
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
    stdout("error: two files are required");
    stdout("run apidiff --help for usage");
    return 2;
  }

  let findings: Finding[];
  try {
    if (options.contract === "env") {
      findings = diffEnv(readText(options.oldPath), readText(options.newPath)).findings;
    } else {
      const oldDocument = readJson(options.oldPath);
      const newDocument = readJson(options.newPath);
      if (options.contract === "schema") {
        findings = diffSchemas(oldDocument, newDocument).findings;
      } else if (options.contract === "openapi") {
        findings = diffOpenApi(oldDocument, newDocument).findings;
      } else {
        findings = diffDetect(oldDocument, newDocument).findings;
      }
    }
  } catch (error) {
    if (error instanceof UsageError) {
      stdout("error: " + error.message);
      return 2;
    }
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

/** Entry point used by the bin shim. Writes to stdout and sets no exit code. */
export function main(argv: readonly string[] = process.argv.slice(2)): number {
  return run(argv, (line) => process.stdout.write(line + "\n"));
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  process.exitCode = main();
}

export { formatRules };
