import type { EnvDiffResult, Finding } from "./types.js";
import { RULES } from "./rules.js";

/**
 * Parse a .env sample into its key set.
 *
 * Only the key is contract data: values in a sample file are secrets-shaped
 * placeholders, so comparing them would produce noise, not signal.
 */
export function parseEnvKeys(text: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = withoutExport.indexOf("=");
    const key = (eq < 0 ? withoutExport : withoutExport.slice(0, eq)).trim();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/**
 * Compare two .env samples.
 *
 * A removed variable is breaking: deployed configs that still set it are fine,
 * but code paths reading it will silently receive undefined. An added variable
 * is safe unless it is required, which .env cannot express, so it is "changed".
 */
export function diffEnv(oldText: string, newText: string): EnvDiffResult {
  const oldKeys = parseEnvKeys(oldText);
  const newKeys = parseEnvKeys(newText);
  const findings: Finding[] = [];
  const newSet = new Set(newKeys);
  const oldSet = new Set(oldKeys);

  for (const key of oldKeys) {
    if (newSet.has(key)) continue;
    findings.push({
      id: "env.key.removed@/" + key,
      rule: "env.key.removed",
      severity: RULES["env.key.removed"].severity,
      pointer: "/" + key,
      location: key,
      message: "environment variable " + key + " is no longer read",
      before: key,
    });
  }

  for (const key of newKeys) {
    if (oldSet.has(key)) continue;
    findings.push({
      id: "env.key.added@/" + key,
      rule: "env.key.added",
      severity: RULES["env.key.added"].severity,
      pointer: "/" + key,
      location: key,
      message: "environment variable " + key + " is new",
      after: key,
    });
  }

  return { kind: "env", findings };
}
