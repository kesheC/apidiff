import type { Finding, Verdict } from "./types.js";
import { RULES, SEVERITY_LABEL, type RuleId, type Severity } from "./rules.js";

/** Backtick, built at runtime so this file has no nested-quote hazards. */
const TICK = String.fromCharCode(96);

function labelOf(finding: Finding): string {
  return finding.location === undefined ? finding.pointer : finding.location;
}

/**
 * Render a verdict as the tree the README shows.
 *
 * Layout is stable so it can be diffed in CI logs: a verdict line, then one row
 * per finding, most severe first. Pass ascii: true for terminals that render
 * box-drawing characters badly (legacy Windows consoles).
 */
export function formatText(verdict: Verdict, options: { ascii?: boolean } = {}): string {
  const ascii = options.ascii === true;
  const branchFirst = ascii ? "  - " : "  \u251c\u2500 ";
  const branchLast = ascii ? "  - " : "  \u2514\u2500 ";
  const pipe = ascii ? "|" : "\u2502";
  const lines: string[] = [];

  const head = verdict.verdict === null ? "compatible (none)" : verdict.verdict + " (" + verdict.bump + ")";
  lines.push("verdict: " + head);

  if (verdict.total === 0) {
    lines.push(pipe + " no contract differences found");
    return lines.join("\n");
  }

  verdict.findings.forEach((finding, index) => {
    const branch = index === verdict.findings.length - 1 ? branchLast : branchFirst;
    const severity = SEVERITY_LABEL[finding.severity].padEnd(12);
    lines.push(pipe + " " + branch + severity + " " + labelOf(finding));
    lines.push(pipe + "          " + finding.message + "  [" + finding.rule + "]");
    if (finding.viaRef !== undefined) lines.push(pipe + "          via " + finding.viaRef);
  });

  const summary = (["breaking", "deprecation", "changed"] as Severity[])
    .filter((severity) => verdict.counts[severity] > 0)
    .map((severity) => verdict.counts[severity] + " " + severity)
    .join(", ");
  lines.push(pipe);
  lines.push(pipe + " " + summary + " -> bump " + verdict.bump);
  return lines.join("\n");
}

/** JSON shape printed by --format json. Field order is stable on purpose. */
export interface JsonReport {
  verdict: Severity | null;
  bump: Verdict["bump"];
  counts: Record<Severity, number>;
  total: number;
  findings: Array<{
    id: string;
    rule: string;
    severity: Severity;
    pointer: string;
    location?: string;
    message: string;
    before?: unknown;
    after?: unknown;
    viaRef?: string;
  }>;
}

export function formatJson(verdict: Verdict): JsonReport {
  return {
    verdict: verdict.verdict,
    bump: verdict.bump,
    counts: verdict.counts,
    total: verdict.total,
    findings: verdict.findings.map((finding) => ({
      id: finding.id,
      rule: finding.rule,
      severity: finding.severity,
      pointer: finding.pointer,
      ...(finding.location === undefined ? {} : { location: finding.location }),
      message: finding.message,
      ...(finding.before === undefined ? {} : { before: finding.before }),
      ...(finding.after === undefined ? {} : { after: finding.after }),
      ...(finding.viaRef === undefined ? {} : { viaRef: finding.viaRef }),
    })),
  };
}

/** Markdown table, for pasting into a PR comment. */
export function formatMarkdown(verdict: Verdict): string {
  const lines: string[] = [];
  const title = verdict.verdict === null ? "compatible" : verdict.verdict + " (" + verdict.bump + ")";
  lines.push("**apidiff verdict: " + title + "**");
  lines.push("");
  if (verdict.total === 0) {
    lines.push("No contract differences found.");
    return lines.join("\n");
  }
  lines.push("| Severity | Location | Change | Rule |");
  lines.push("| --- | --- | --- | --- |");
  for (const finding of verdict.findings) {
    const cells = [SEVERITY_LABEL[finding.severity], labelOf(finding), finding.message, TICK + finding.rule + TICK];
    lines.push("| " + cells.map((cell) => cell.split("|").join("\\|")).join(" | ") + " |");
  }
  return lines.join("\n");
}

/** The rule table rendered for --rules. */
export function formatRules(): string {
  const ids = Object.keys(RULES).sort() as RuleId[];
  const width = ids.reduce((max, id) => Math.max(max, id.length), 0);
  const lines = ["Rule table (severity is fixed per rule):", ""];
  for (const id of ids) {
    const definition = RULES[id];
    lines.push("  " + SEVERITY_LABEL[definition.severity].padEnd(12) + id.padEnd(width) + "  " + definition.title);
  }
  return lines.join("\n");
}

/** Count findings per severity without building a full verdict. */
export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { breaking: 0, deprecation: 0, changed: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}
