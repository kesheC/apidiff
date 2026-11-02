# Contributing to apidiff

Thanks for wanting to help. `apidiff` is a small tool that does one thing: turn a diff between two JSON Schemas, OpenAPI documents or `.env` samples into a semver verdict.

## Before you start

- **Bugs and feature ideas go to [Issues](https://github.com/kesheC/apidiff/issues)**, using the
  templates there. Include the exact command and its complete output; a screenshot of a terminal is
  not reproducible.
- **Security problems never go to a public issue.** Use the private channel in
  [SECURITY.md](https://github.com/kesheC/apidiff/blob/main/SECURITY.md).
- For anything larger than a typo, open an issue first and describe the problem you are trying to
  solve. A pull request that arrives before the problem is agreed on is hard to accept, however
  good the code is.

## Setting up

You need Node.js 20.11 or newer. There is nothing to install beyond dev dependencies:

> The shipped CLI runs on Node 20.11. The **test runner is newer than the runtime floor**:
> vitest 4 pulls in vite 8, which declares `^20.19.0 || >=22.12.0`. On Node 20.11–20.18 the
> tool still runs, but `npm test` does not — use a current 20.x, 22.x or 24.x to work on it.
> CI's `node: 20` column resolves to the latest 20.x, so it is above that line.

```bash
git clone https://github.com/kesheC/apidiff.git
cd apidiff
npm ci
npm run build
node dist/cli.js --help
```

`dist/` is what the published tarball ships, so `npm run build` has to succeed for anything to be
reviewable. `node dist/cli.js` runs the build you just made; a `apidiff` on your PATH is whatever
release you installed earlier and is usually stale.

## The quality gates

Every change has to pass the commands CI runs:

```bash
npm run typecheck   # tsc --noEmit, tests included
npm run build       # tsc -p tsconfig.build.json
npm test            # vitest run
npm audit --audit-level=high   # the toolchain is the entire supply chain
```

Opening the pull request runs them on Ubuntu and Windows across Node 20, 22 and 24.

The audit is part of the gate because this package ships no runtime dependencies: what you
install to work on it *is* the whole supply chain. It fails on high and critical advisories
only; a moderate finding is worth reading when you next touch the dependencies, but it is not
worth blocking an unrelated fix.

Two layers keep the README honest. `tests/readme.test.ts` re-derives the reports the demo pairs
produce — text, JSON, markdown, the env verdict, the rule-table excerpt — through the same library
calls the CLI uses, and `tests/package.test.ts` pins the documented rule counts to `RULES`. The CI
step `README demo transcripts still reproduce` then re-runs the OpenAPI demo and the rule-count
check against the built CLI. Transcripts of the error paths and exit codes are checked by hand.

## House rules

These are not style preferences; the code depends on them.

1. **Zero runtime dependencies.** `dependencies` in `package.json` stays empty — everything ships
   from `node:*` and the standard library. Dev dependencies are fine. A pull request that adds a
   dependency has to remove one first.
2. **ESM only.** `"type": "module"`, `moduleResolution: NodeNext`, and relative imports carry the
   `.js` extension even though the source is `.ts`.
3. **Strict TypeScript**, including `noUncheckedIndexedAccess`. Indexing an array yields
   `T | undefined`; handle it instead of asserting it away. `any` needs a reason in a comment.
4. **stdout is machine output, stderr is human output.** Piping the machine output into `jq` has to
   keep working, so progress notes, warnings and summaries go to stderr.
5. **Node >= 20.11 is the floor.** `package.json`, the README and the CI matrix all say so. The
   tool has to run on plain Node with no bundler and no runtime helper.

## Tests

- Every behaviour change comes with a test that fails without it. A bug fix without a test is a bug
  waiting to come back.
- Tests must not depend on the machine they run on: no absolute paths from your home directory, no
  network, no `docker`. Anything that needs a repository builds a fixture in `os.tmpdir()`.
- Table-driven cases are preferred for parsing work; include the negative case (input that looks
  similar but must not match), not just the positive one.

## Commits and pull requests

- One logical change per commit. `fix:`, `feat:`, `docs:`, `test:`, `chore:` prefixes, then a
  sentence in the imperative mood that says what the change does — not "update stuff".
- The pull request body explains **why**, and quotes the command and output that show the change
  working. "Tests pass" is not evidence that the behaviour asked for is the behaviour delivered.
- Do not bump the version or edit `CHANGELOG.md` in a feature pull request; releases are cut
  separately, from the merged history.

## Licence

By contributing you agree that your contribution is licensed under the MIT Licence in
[LICENSE](https://github.com/kesheC/apidiff/blob/main/LICENSE).
