import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// The README ships a GitHub Actions step. Every line of it is a claim about how
// a checkout behaves: `actions/checkout` maps one branch, a bare `git fetch
// origin main` leaves `origin/main` undefined, and an absent baseline file turns
// into `error: invalid JSON` unless the step branches on it. None of that was
// checked by anything, so a well-meaning "simplification" of the refspec would
// have shipped a step that exports the wrong exit code on every pull request.
//
// The test rebuilds a real repository with a real `origin` and runs the quoted
// body under `bash -e`, which is what a runner does. Two substitutions are made
// so it stays offline: the `npm install` pair is dropped (the local build is the
// binary under test) and `npx apidiff` becomes `node dist/cli.js`. Everything
// that the step is actually about runs verbatim.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const cli = join(root, "dist", "cli.js");

const shells = spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("bash", ["-c", "true"], { stdio: "ignore" }).status === 0;

const workdirs: string[] = [];
afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true });
});

/** The `run:` script of the `yaml` fence in the README, dedented. */
function stepBody(): string {
  const lines = readme.split("\n");
  const open = lines.indexOf("```yaml");
  if (open < 0) throw new Error("README no longer has a yaml fence for the Action step");
  const close = lines.indexOf("```", open + 1);
  if (close < 0) throw new Error("the yaml fence in the README is never closed");
  const fence = lines.slice(open + 1, close);

  const header = fence.findIndex((line) => /^\s*run: \|$/.test(line));
  if (header < 0) throw new Error("the Action step has no `run: |` block");
  const headerLine = fence[header];
  if (headerLine === undefined) throw new Error("the `run: |` block vanished");
  const indent = /^\s*/.exec(headerLine)![0].length + 2;
  const body: string[] = [];
  for (const line of fence.slice(header + 1)) {
    if (line.trim() !== "" && line.trimStart().length === line.length) break;
    body.push(line.slice(Math.min(indent, line.length)));
  }
  return body.join("\n");
}

/** The body, made runnable here: local binary, no download. */
function runnable(): string[] {
  const script = stepBody();
  const lines: string[] = [];
  let skipContinuation = false;
  for (const line of script.split("\n")) {
    if (skipContinuation) { skipContinuation = line.endsWith("\\"); continue; }
    if (line.startsWith("npm install")) { skipContinuation = line.endsWith("\\"); continue; }
    lines.push(line.split("npx apidiff").join(`node "${cli}"`));
  }
  return lines;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

const OPENAPI = (paths: string): string =>
  JSON.stringify({ openapi: "3.0.0", info: { title: "demo", version: "1" }, paths: JSON.parse(paths) });

/** A repo with `origin` on main and a checkout of one feature branch, like a runner. */
function checkout(files: Record<string, string>, branch: Record<string, string>): string {
  const base = mkdtempSync(join(tmpdir(), "apidiff-action-"));
  workdirs.push(base);
  const seed = join(base, "seed");
  mkdirSync(join(seed, "api"), { recursive: true });
  git(seed, "init", "-q", "-b", "main");
  for (const [name, body] of Object.entries(files)) writeFileSync(join(seed, name), body);
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "--allow-empty", "-m", "base");
  execFileSync("git", ["clone", "-q", "--bare", seed, join(base, "origin.git")], { stdio: "ignore" });

  const work = join(base, "work");
  execFileSync("git", ["clone", "-q", join(base, "origin.git"), work], { stdio: "ignore" });
  git(work, "checkout", "-qb", "feature");
  for (const [name, body] of Object.entries(branch)) {
    mkdirSync(dirname(join(work, name)), { recursive: true });
    writeFileSync(join(work, name), body);
  }
  git(work, "add", "-A");
  git(work, "commit", "-q", "--allow-empty", "-m", "branch");
  git(work, "push", "-q", "origin", "feature");

  // actions/checkout maps exactly one branch; the step has to ask for main.
  const runner = join(base, "runner");
  execFileSync("git", ["clone", "-q", "--single-branch", "--branch", "feature", join(base, "origin.git"), runner], {
    stdio: "ignore",
  });
  return runner;
}

function runStep(cwd: string): { code: number; out: string } {
  const script = join(cwd, "step.sh");
  writeFileSync(script, `${runnable().join("\n")}\n`);
  const result = spawnSync("bash", ["-e", script], { cwd, encoding: "utf8" });
  return { code: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
}

const COMPATIBLE = { "api/openapi.json": OPENAPI('{"\/users":{"get":{"responses":{"200":{"description":"ok"}}}}}') };

describe.skipIf(!shells)("README GitHub Action step", () => {
  it("asks for main by name instead of trusting the default fetch", () => {
    // A bare `git fetch origin main` only writes FETCH_HEAD, so the recorded
    // refspec is the whole reason `git show origin/main:...` resolves at all.
    expect(stepBody()).toContain("+refs/heads/main:refs/remotes/origin/main");
  });

  it("fails the step for a breaking branch", () => {
    const runner = checkout(COMPATIBLE, { "api/openapi.json": OPENAPI("{}") });
    const { code, out } = runStep(runner);
    expect(out).toContain("verdict: breaking (major)");
    expect(out).toContain("[openapi.path.removed]");
    expect(code).toBe(1);
  });

  it("passes the step for a compatible branch", () => {
    const runner = checkout(COMPATIBLE, { "api/openapi.json": COMPATIBLE["api/openapi.json"]! });
    const { code, out } = runStep(runner);
    expect(out).toContain("verdict: compatible (none)");
    expect(code).toBe(0);
  });

  it("passes the step when the file has no baseline on main", () => {
    const runner = checkout({}, { "api/openapi.json": OPENAPI("{}") });
    const { code, out } = runStep(runner);
    expect(out).toContain("is new on this branch");
    expect(out).not.toContain("invalid JSON");
    expect(code).toBe(0);
  });
});
