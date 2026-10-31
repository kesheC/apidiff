import { describe, expect, it } from "vitest";

import { bumpOf, severitiesAtOrAbove, shouldFail, verdictOf } from "../src/verdict.js";
import type { Finding } from "../src/types.js";
import type { RuleId, Severity } from "../src/rules.js";

const finding = (severity: Severity, rule: string, pointer = "/a"): Finding => ({
  id: rule + "@" + pointer,
  // Synthetic ids here exercise the ordering, not the rule table.
  rule: rule as RuleId,
  severity,
  pointer,
  message: rule,
});

describe("verdict aggregation", () => {
  it("returns a null verdict for no findings", () => {
    const verdict = verdictOf([]);
    expect(verdict.verdict).toBeNull();
    expect(verdict.bump).toBe("none");
    expect(verdict.total).toBe(0);
    expect(verdict.counts).toEqual({ breaking: 0, deprecation: 0, changed: 0 });
  });

  it("counts every severity", () => {
    const verdict = verdictOf([finding("changed", "a"), finding("breaking", "b"), finding("breaking", "c"), finding("deprecation", "d")]);
    expect(verdict.counts).toEqual({ breaking: 2, deprecation: 1, changed: 1 });
    expect(verdict.total).toBe(4);
  });

  it("lets the most severe finding win", () => {
    expect(verdictOf([finding("changed", "a"), finding("deprecation", "b")]).verdict).toBe("deprecation");
    expect(verdictOf([finding("changed", "a"), finding("deprecation", "b"), finding("breaking", "c")]).verdict).toBe("breaking");
  });

  it("maps severities to semver bumps", () => {
    expect(bumpOf("breaking")).toBe("major");
    expect(bumpOf("deprecation")).toBe("minor");
    expect(bumpOf("changed")).toBe("minor");
    expect(bumpOf(null)).toBe("none");
  });

  it("sorts findings most severe first, then by pointer, then by rule", () => {
    const verdict = verdictOf([
      finding("changed", "z", "/b"),
      finding("breaking", "m", "/b"),
      finding("breaking", "a", "/b"),
      finding("breaking", "a", "/a"),
    ]);
    expect(verdict.findings.map((f) => f.id)).toEqual(["a@/a", "a@/b", "m@/b", "z@/b"]);
  });

  it("is deterministic for shuffled input", () => {
    const list = [finding("changed", "c", "/2"), finding("breaking", "b", "/1"), finding("deprecation", "d", "/3")];
    const forward = verdictOf(list).findings.map((f) => f.id);
    const backward = verdictOf([...list].reverse()).findings.map((f) => f.id);
    expect(backward).toEqual(forward);
  });

  it("exposes the severities at or above a threshold", () => {
    expect(severitiesAtOrAbove("breaking")).toEqual(["breaking"]);
    expect(severitiesAtOrAbove("deprecation")).toEqual(["breaking", "deprecation"]);
    expect(severitiesAtOrAbove("changed")).toEqual(["breaking", "deprecation", "changed"]);
  });

  it("fails only on breaking by default", () => {
    const breaking = verdictOf([finding("breaking", "a")]);
    const deprecation = verdictOf([finding("deprecation", "b")]);
    expect(shouldFail(breaking, "breaking")).toBe(true);
    expect(shouldFail(deprecation, "breaking")).toBe(false);
  });

  it("fails on deprecation when asked", () => {
    const deprecation = verdictOf([finding("deprecation", "b")]);
    const changed = verdictOf([finding("changed", "c")]);
    expect(shouldFail(deprecation, "deprecation")).toBe(true);
    expect(shouldFail(changed, "deprecation")).toBe(false);
  });

  it("never fails with fail-on never", () => {
    expect(shouldFail(verdictOf([finding("breaking", "a")]), "never")).toBe(false);
  });
});
