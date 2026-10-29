import type { Finding, Verdict } from "./types.js";
import { SEVERITY_LADDER, severityRank, type Severity } from "./rules.js";

/** Which severities are allowed to fail the process, most permissive last. */
export type FailOn = "breaking" | "deprecation" | "never";

/** Severities at or above the threshold, in ladder order. */
export function severitiesAtOrAbove(threshold: Severity): Severity[] {
  const limit = severityRank(threshold);
  return SEVERITY_LADDER.filter((severity) => severityRank(severity) <= limit);
}

/** The semver bump a verdict severity implies. */
export function bumpOf(severity: Severity | null): Verdict["bump"] {
  if (severity === "breaking") return "major";
  if (severity === "deprecation" || severity === "changed") return "minor";
  return "none";
}

/**
 * Collapse a finding list into one verdict.
 *
 * The most severe finding wins; ties do not exist because the ladder is total.
 * Findings are sorted most-severe-first, then by pointer, so the output is
 * deterministic regardless of the order rules fired in.
 */
export function verdictOf(findings: readonly Finding[]): Verdict {
  const counts: Record<Severity, number> = { breaking: 0, deprecation: 0, changed: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  let verdict: Severity | null = null;
  for (const severity of SEVERITY_LADDER) {
    if (counts[severity] > 0) {
      verdict = severity;
      break;
    }
  }

  const sorted = [...findings].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    const byPointer = a.pointer < b.pointer ? -1 : a.pointer > b.pointer ? 1 : 0;
    if (byPointer !== 0) return byPointer;
    return a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0;
  });

  return { verdict, bump: bumpOf(verdict), counts, findings: sorted, total: sorted.length };
}

/**
 * Whether a verdict should make the CLI exit non-zero.
 *
 * breaking     -> fail only when something is breaking
 * deprecation  -> fail on breaking or deprecation
 * never        -> never fail (report only)
 */
export function shouldFail(verdict: Verdict, failOn: FailOn): boolean {
  if (failOn === "never") return false;
  const allowed = severitiesAtOrAbove(failOn === "breaking" ? "breaking" : "deprecation");
  return allowed.some((severity) => verdict.counts[severity] > 0);
}
