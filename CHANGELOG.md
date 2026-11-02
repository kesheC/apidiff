# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.23] - 2026-11-02

### Fixed

- **The dependabot ignore list named one half of a pair npm resolves as a single
  version.** `@vitest/coverage-v8` declares `peerDependencies: { vitest: "<exact
  version>" }`, so the two release in lockstep and neither major can install
  without the other. The list held back `vitest` and `@types/node` but not
  coverage-v8, and the bot opened exactly that pull request the day after
  coverage-v8 joined the tree: all six CI legs died on `ERESOLVE` on a pull
  request that could never have worked. Both halves are now ignored together,
  each line stating the condition that lifts it, and `tests/workflow.test.ts`
  reads package.json, package-lock.json and dependabot.yml side by side: an
  exactly-pinned peer pair has to be ignored as a pair, and every ignored name
  still has to be a dependency this repository declares.

### Quality

- 224 tests across 14 spec files, 2495 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Coverage: one leg only, Linux on Node 24, so the numbers stay comparable between runs.

## [0.1.22] - 2026-11-02

### Added

- **Coverage is measured, gated, and green — the suite had never been run under a
  coverage provider before, so every coverage claim in this repository was unverifiable.**
  `@vitest/coverage-v8` is now a dev dependency and `npm run coverage` runs the same
  suite under v8. The config excludes `dist/**`: every spec imports the built output, so
  without that exclusion each module is counted twice — once through its source map and
  once as the emitted `dist` file — which halves the number. Measured on the sibling
  `repropack`, the same suite read 46.75% with `dist` counted and 89.66% without it.
  Floor numbers for the tree today: 90.7% statements, 82.61% branches, 93.75% functions, 93.24% lines.

### Changed

- **TypeScript 5.9.3 → 7.0.2.** This was declined in `dependabot.yml` when the major
  first appeared, because TS 7 stopped pulling `@types/node` in implicitly and every
  build failed on `Cannot find name 'process'`. The fix turned out to be one line —
  `"types": ["node"]` in the base tsconfig — so TS 7 is adopted, TypeScript is no longer
  in the ignore list, `vitest` and `@types/node` still are. The comment in
  `dependabot.yml` records what the ignore is waiting for: an ignore with no stated exit
  condition silently swallows a whole track of upgrades long after the reason expired.

### Quality

- 222 tests across 14 spec files, 2495 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Coverage: one leg only, Linux on Node 24, so the numbers stay comparable between runs.

## [0.1.21] - 2026-11-02

### Security

- **The workflows pinned third-party actions by tag, which is a mutable pointer.**
  `actions/checkout@v5` means whatever the action's maintainers push to that tag, so a
  moved tag silently swaps the code this repository's own token runs — and CI would stay
  green throughout. Both actions are now pinned to a commit sha with the readable version
  kept beside them (`# v7.0.1`, `# v7.1.0`), and `tests/workflow.test.ts` fails when a
  `uses:` line carries a tag instead of a 40-character sha, or a sha without its comment.
  Dependabot bumps the two halves together, so the comment cannot drift away from the sha.

### Added

- `.github/dependabot.yml` covers the two ecosystems this repository actually installs:
  the workflow actions and the dev toolchain in `package-lock.json`. Weekly, grouped, so a
  bump arrives as one pull request with a green run behind it rather than a queue of them.
  Dependabot alerts and automated security fixes were already on; without a version-update
  config, a pinned sha would only ever move when someone remembered to move it.
- The dev toolchain's two major-version bumps are now explicitly declined rather than
  silently pending: `vitest` 5 requires Node ^22.12 and this package still promises
  20.11, so adopting it would either drop the floor or ship a matrix column that cannot
  install the toolchain; `@types/node` majors describe a runtime newer than the floor.
  `dependabot.yml` ignores those two majors only — minors and patches still arrive, and
  **security updates are not filtered by `ignore`**, so an advisory on either one still
  opens a pull request.

### Quality

- 221 tests across 14 spec files, 2495 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.20] - 2026-11-02

### Fixed

- **CONTRIBUTING.md promised "the same three commands CI runs" and listed three, while CI ran
  four.** The sentence is a claim about the workflow, and it went stale the moment the audit
  step landed: a contributor following the list would have skipped the one check that reads
  the whole supply chain. The heading is now "the commands CI runs" without a count, the list
  includes `npm audit --audit-level=high`, and `tests/workflow.test.ts` walks all four names
  through both files so a step added to one without the other fails the suite instead of the
  reader.
- **`package-lock.json` was marked `-diff`, so its diff was never readable.** The attribute
  reads like "also treat this as text" and means the opposite: `diff` set to *unset*, do not
  diff this file. Every dependency change therefore rendered as `Binary files differ` with zero
  lines to review, and the only way to see which packages moved was to open the lockfile and
  read it by hand. The lockfile is the one file a reviewer actually reads on a dependency bump,
  so this was backwards. The attribute is now `text eol=lf`, and `tests/package.test.ts` asks
  git (`git check-attr diff -- package-lock.json`) rather than inspecting the file, because
  `-diff`, `diff=false` and `binary` all spell differently and end in the same place.

### Security

- **The test toolchain was carrying six advisories, two of them critical.** `npm audit`
  reported `3 moderate, 1 high, 2 critical` on every repository in this set. All six came in
  through `vitest 2.1.9`: `tinypool <=2.1.1` (prototype-pollution gadget reaching RCE, twice),
  `@vitest/mocker <=4.1.11` (path traversal, manual-mock code injection) and the `vite`/`esbuild`
  dev-server request forwarding. The package itself ships zero runtime dependencies, so this
  was never a user-facing hole — but a contributor's machine runs all of it on `npm test`.
  `vitest` is now `^4.1.12`, which resolves the tree to vite 8 and reports `0 vulnerabilities`.

  The fix exposed a second thing the gates could not see: **vitest 4 pulls in vite 8, whose
  `engines` is `^20.19.0 || >=22.12.0`, one minor above the 20.11 floor the shipped CLI still
  promises.** Those are two different promises — what the tool runs on versus what the test
  runner runs on — so the floor stays at 20.11 and `CONTRIBUTING.md` now says plainly that
  working on the code needs a newer 20.x than using it does. CI's `node: 20` column resolves to
  the latest 20.x, so it sits above that line.

### Added

- **`npm audit --audit-level=high` is now a CI step**, placed after `npm ci` so it inspects the
  installed tree rather than an empty one. Moderate and low advisories are not gate failures;
  they get read on the next dependency bump instead of blocking an unrelated fix.

- **Two guards keep the promise honest.** One fails when the audit step disappears or is
  reordered before the install; the other fails when `engines.node` and the oldest matrix
  column disagree — a floor above the matrix is a version nobody runs, a floor below it is a
  version never promised. Moving either number alone now breaks `tests/workflow.test.ts`.

### Quality

- 220 tests across 14 spec files, 2495 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.


## [0.1.19] - 2026-11-02

### Fixed

- **A bare `tsc` wrote its output next to the sources.** `npm run typecheck` passes `--noEmit`,
  but the editor and anyone typing `npx tsc` obey `tsconfig.json` alone. Without `noEmit` there,
  a full compile dropped .js, .d.ts and .js.map beside every .ts — 90 untracked files in this
  repository the first time it was measured — which the next `git add .` would have swept into a
  commit. `noEmit` now lives in the base config, so emitting is something the build config has to
  ask for explicitly rather than a thing you forget to turn off.

- **The tsconfig split is now pinned by tests.** `tests/package.test.ts` gained two cases: the
  base config must set `noEmit` and carry no `outDir`, and the build config must restate
  `noEmit: false` with `rootDir` and `include: ["src"]`. Both were true before only by accident of
  whichever file was edited last.

### Quality

- 216 tests across 14 spec files, 2495 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.17] - 2026-11-02

### Fixed

- **`npm run dev` could not start, in any of the six repositories.** The script was
  `node --experimental-strip-types src/cli.ts`, which never worked here: every source file imports its
  siblings with a `.js` suffix, because that is what `moduleResolution: NodeNext` requires for the
  compiled output to resolve, and the type-stripping loader does not map `./errors.js` back to
  `./errors.ts`. It exited 1 with `ERR_MODULE_NOT_FOUND` before printing a line of the program.
- The script now builds first and runs the build: `npm run build && node dist/cli.js`.
  The build takes under two seconds, and a development entry point that cannot start is worse than
  no entry point at all.

### Quality

- 214 tests across 14 spec files, 2495 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.16] - 2026-11-02

### Added

- **The README finally shows the GitHub Action it has been recommending.** The Usage section told
  readers to gate CI on the exit code and then left them to reverse-engineer the wiring, and the
  wiring has two traps a careful reader still walks into: `actions/checkout` maps a single branch,
  so `git fetch origin main` fills `FETCH_HEAD` and leaves `origin/main` undefined for `git show`,
  and a contract file that is new on the branch makes `git show` write an empty baseline that
  apidiff reads as `error: invalid JSON` (exit `2`) instead of "nothing to compare yet". The new
  `### As a GitHub Action` section quotes the whole step, an explicit
  `+refs/heads/main:refs/remotes/origin/main` refspec and all, and `tests/action.test.ts` builds a
  real repository with a real `origin`, checks out one branch the way a runner does, and runs the
  quoted body under `bash -e` — breaking branch exits 1, compatible branch exits 0, new file
  reports the honest reason. Dropping the refspec, reading the baseline from `HEAD`, or flattening
  the `else` away each turns it red.

### Quality

- 214 tests across 14 spec files, 2495 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.


## [0.1.15] - 2026-11-02

### Fixed

- **The README's severity split had nothing watching it.** CI compares the rows `--rules` prints
  with `Object.keys(RULES).length`, so a rule added without a README edit fails there — but the
  sentence a reader actually uses to decide whether this tool is strict enough quotes three
  numbers, one per severity, and the Chinese mirror quotes them again. `tests/package.test.ts`
  now derives all four numbers from `RULES` and asserts both paragraphs quote them, so moving a
  rule from `changed` to `breaking` fails with `expected 30 to be 31` instead of silently
  underselling the severity.
- **The README quoted seven reports nothing compared against the demo files.** The text report,
  the `--format json` body, the markdown table, the `.env` comparison, the first eight rows of the
  rule table and the no-differences case are all transcripts of runs against `demo/`, and that
  directory is committed — so a new rule, a nudged `minimum` or a formatting touch rewrites three
  blocks at once. The CI step only greps for `verdict: breaking (major)` and one rule id, which
  would stay green through all of it. `tests/readme.test.ts` derives each block with the library
  calls the CLI itself uses — `diff`, `diffEnv`, `verdictOf`, `formatText`, `formatJson`,
  `formatMarkdown`, `formatRules` — and asserts the README contains the rendered text verbatim.
- **The contributing guide implied CI re-ran every transcript the README quotes.** The CI step
  greps one verdict line and one rule id out of the OpenAPI demo and derives the rule count; it
  does not re-derive the text report, the JSON body, the markdown table or the `.env` verdict.
  Those are covered by `tests/readme.test.ts` instead, and the guide now draws the line between
  the two.

### Quality

- 210 tests across 13 spec files, 2495 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.


## [0.1.14] - 2026-11-02

### Added

- **The files GitHub looks for on a healthy repository.** The repository had issue templates and
  workflows but no `CONTRIBUTING.md`, no `CODE_OF_CONDUCT.md` and no pull request template, so
  the community profile counted it as incomplete and a first-time contributor had to guess at the
  house rules. `CONTRIBUTING.md` writes down what the code actually depends on — zero runtime
  dependencies, ESM with NodeNext and `.js` import suffixes, strict TypeScript including
  `noUncheckedIndexedAccess`, stdout for machine output and stderr for human output, Node >= 20.11
  — plus the three local gates CI runs. `CODE_OF_CONDUCT.md` is Contributor Covenant 2.1 with
  reporting pointed at the private advisory channel. The pull request template asks for the command
  and its output, because "tests pass" only shows that nothing already covered broke.

### Fixed

- **The lockfile still described 0.1.0 with an engines floor of `>=20`.** It was last written
  before the version bumps, and nothing in CI reads it closely enough to fail, so a stale lock
  could have sat there indefinitely. Regenerating it against the current manifest brings the
  version, the root package entry and `engines.node` back in line.
- **The bug report template offered a version from nine releases ago.** It asked for `0.1.1` as
  the example version and pinned the install field to `.../download/v0.1.1/....tgz`. Both still
  resolve, so nothing was broken — but anyone filling the form in copies a stale shape and the
  report arrives describing a version nobody runs. The install placeholder now uses
  `releases/latest/download/`, which keeps working as releases move on.
- **The channel picker had no route to the one report that must not be public.** `config.yml` had
  `contact_links: []`; it now carries a link to the private security advisory page.
- **`CONTRIBUTING.md` was reachable only from the file list.** The security paragraph at the end
  of the README now points at it, in the same bilingual shape that paragraph already uses.

### Quality

- 202 tests across 12 spec files, 2495 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.13] - 2026-11-02

### Changed

- **Every README transcript now reproduces from a clean checkout.** A dash-named document was
  shown as working before `--` existed as an option terminator, and the rule listing skipped from
  the first rows to the last with a literal ellipsis that no command produces. Both are now real
  runs: the leading-dash block shows the failure, the `cp`, and the retry that works; the rule
  table is `--rules | head -8`, with the real line count stated separately.

### Fixed

- **The changelog described a CI matrix that no longer existed.** Every quality note from 0.1.2
  onwards said "Node 20 and 22", but the matrix has run 20, 22 and 24 since that release — so each
  of those sections, and the GitHub release notes generated from them, named a matrix the project
  had already outgrown. The notes now list the versions CI actually runs.

### Quality

- 202 tests across 12 spec files, 2495 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.12] - 2026-11-02

### Fixed

- **A closed pipe is an ending, not a crash.** `apidiff old.json new.json | head -5` printed its
  first lines and then died with `Error: write EPIPE` and exit 1: the reader
  had what it wanted, Node raised an error event on stdout, and nothing was
  listening, so a finished run looked like a failed one. stdout now reads a
  closed pipe as "the reader is done" and exits 0; stderr carries only
  progress and warnings, so an EPIPE there is swallowed and the command runs
  to the end. Any other stream error is still thrown.

### Quality

- 202 tests across 12 spec files, 2495 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.11] - 2026-11-01

### Fixed

- **A lone `-` is a path, not a bad option.** The stdin placeholder was answered
  with `unknown option -`, which is not even true -- `-` is a path. It parses as
  one now, and reading it says what actually happened: `apidiff does not read
  stdin; pass the path of a document instead of "-"`.

### Quality

- 200 tests across 11 spec files, 2462 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.10] - 2026-11-01

### Fixed

- **`--` ends the options and starts the file paths.** Everything that starts
  with a dash was read as an option, so a document actually named
  `-old.json` had no spelling that worked: `apidiff -- -old.json new.json`
  answered `unknown option --`. The two documents are the only positionals
  apidiff takes, and they are the reason to reach for the terminator.
- **`--flag=value` is accepted for `--format`, `--fail-on` and `--contract`.**
  `apidiff --format=json old.json new.json` answered `unknown option
  --format=json`, which is the spelling half the world types first. The value
  is split off before the switch; a boolean given a value (`--quiet=yes`) is a
  usage error instead of a silently ignored word.

### Quality

- 198 tests across 11 spec files, 2,452 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.9] - 2026-11-01

### Added

- **The README is Chinese as well as English.** All twelve sections now carry a
  Chinese paragraph under the English one -- same commands, same transcripts,
  same limits. 2,073 CJK characters, up from 170.

### Fixed

- **The README no longer claims `diffSchemas` rejects an array root.** The
  English FAQ said a call that needs fixing by the caller throws `UsageError`.
  It does not: `diffSchemas([1, 2], { type: 'string' })` returns a single
  `schema.replaced` finding. Only the CLI's `assertSchemaRoot()` refuses a root
  that is not an object or a boolean, and only `diffDetect` throws for mixed
  families. Both halves of the README now say that.
- **The 0.1.8 notes now match what changed.** The "three guards" bullet claimed
  guards v0.1.7 already had; only some were new. Version headings had no link
  definitions, so `[0.1.7]` and `[0.1.8]` rendered as literal text, and
  `[Unreleased]` still compared against v0.1.6.

### Quality

- 194 tests across 11 spec files, 2,422 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.8] - 2026-11-01

### Added

- **The release gates are executed, not spell-checked.** `release.yml` and
  `ci.yml` only ever run on a push, so nothing on a laptop exercised them.
  `tests/workflow.test.ts` now cuts each guard's own shell body out of the YAML
  and runs it -- the tag gate against matching, drifted, non-semver and
  prerelease tags and ordered before the CHANGELOG lookup and before any `gh`
  call; the package-contents assertion against a complete manifest, a stray
  `.js.map`, an empty `dist/` and a leaked `src/`. 21 cases.
- **`npm run build` now clears `dist/` first, and the bin is smoke tested.**
  `clean` did not exist at v0.1.7, so any file tsc no longer emits survived in
  `dist/` from an earlier build and `npm pack` shipped it; and nothing until now
  ran the `apidiff` bin from the installed package rather than from the checkout.

## [0.1.7] - 2026-11-01

### Fixed

- **Nesting past 512 levels is a usage error, not a runtime accident.** The
  depth at which the walker blew the call stack was a property of the host, not
  of the document: a 1300-deep pair gave `breaking (major)` on node 20 and
  `RangeError: Maximum call stack size exceeded` on node 24, so the same commit
  failed three of six CI jobs and passed the other three. The walker now counts
  depth itself and stops at `MAX_SCHEMA_DEPTH = 512` with a usage error that
  names the fix (`diffSchemasAt`).
- **Content outranks the filename in auto-detect.** A JSON Schema saved as
  `.env.a.json` was compared as a dotenv sample and the verdict was fiction:
  `environment variable {"type":"object"} is no longer read` instead of the
  real `/properties/PORT` narrowing. Parsing now decides first; only when JSON
  parsing fails does the name get a vote, and a side that is neither JSON nor
  dotenv reports its parse error instead of being coerced into one family.
- **An oversize document is named as oversize, not as bad UTF-8.**
  `ERR_STRING_TOO_LONG` was reported as an encoding error; it now reads `is too
  large to compare (n bytes; the text limit is 536870888)`.
- **An unexpected crash exits 2, not 1.** `main()` now wraps `run()`, so a
  crash is an error with one stderr line (plus the `{"error": ...}` object
  under `--format json`) instead of exit 1, which means 'a breaking change was
  found' to every caller.
- **Errors go to stderr.** They were written to stdout, which made
  `2>/dev/null` useless and fed prose to `jq`; a pipeline on stdout now sees
  only verdicts, and `--format json` keeps a machine-readable object even when
  a flag itself is bad.
- **Invalid UTF-8 and a non-schema JSON root are loud.** Invalid bytes used to
  be substituted with U+FFFD and compared as corrupted text, and an array root
  produced a 'compatible' verdict.

### Added

- **dotenv samples are a first-class input.** The auto contract mode only ever
  produced JSON, so two `.env` samples failed with a decoder message about the
  wrong problem; a dotenv name (`.env`, `.env.local`, `app.env`) or a body of
  only `KEY=value` lines is now recognised, and a mixed pair is an explicit
  error.
- **A broken `$ref` is reported as `schema.ref.broken`** instead of being
  silently dropped.

### Changed

- **The tarball no longer ships unusable sourcemaps.** 15 `.js.map` files
  pointed at `../src/*.ts` with no `sourcesContent` — 79119 map bytes against
  89235 js bytes, ~90% dead weight. With `sourceMap`/`declarationMap` off in
  `tsconfig.build.json`, the package is 48 entries / 50114 B / 218298 B
  unpacked to 33 entries / 36660 B / 138639 B unpacked, and `--version`,
  `--help` (byte-identical, same sha256) and a real diff are unchanged.
- The document root is shown as `/` instead of a blank location.
- `UsageError` lives in its own module.
- The README documents the stream split, the 536870888-byte text ceiling, the
  deliberate BOM rejection and the 57-rule table; every console block was
  replayed against the built CLI, and two that did not match were corrected.

### Security

- The release job refuses to publish when the tag and `package.json` disagree
  (before the first `gh` call, so a drifted tag reads as drift); CI parses
  `npm pack --dry-run --json` before any `cd` to assert the dist entry points,
  no `tests/`/`src/`/`node_modules/` prefixes and no `.js.map`, then imports the
  installed package and asserts the public exports are functions.

### Quality

- 13 regression cases in `tests/hardening.test.ts` (B1, M1, M2), all of which
  fail against the parent commit's `src/`: 9 files, 168 tests.

## [0.1.6] - 2026-11-01

### Fixed

- **The README claimed the npm name was taken.** It said the `apidiff` name on npm belonged to an unrelated package. It does not: `npm view apidiff` returns 404, the name is unregistered. The README now says this project has no publishing credentials yet, instead of blaming a squatter.

### Changed

- Sample transcripts in the README show the version this release actually prints.

## [0.1.5] - 2026-11-01

### Changed

- **The release page now explains the release.** The workflow used to publish a body containing only a compare link, so the one page a prospective user lands on said nothing about what changed. The body is now the `CHANGELOG.md` section for the tag, and a tag with no written section fails the job instead of shipping an empty release.

## [0.1.4] - 2026-11-01

### Changed

- **README examples showed a version the tarball no longer ships.** The released tarball bundles the README, so a stale `0.1.2` in a sample transcript was shipping to users. Every version string in it now matches the package.
- The install section documents the `apidiff.tgz.sha256` checksum every release publishes, so a download can be verified before it is executed.

## [0.1.3] - 2026-11-01

### Fixed

- **The CLI exited silently when started from an npm bin link.** The entry
  guard compared `process.argv[1]` with `import.meta.url` as raw strings. Node
  resolves `import.meta.url` to the real path but leaves `argv[1]` as written,
  so whenever the binary was reached through a link the guard was false, `main`
  never ran, and the process exited 0 having printed nothing. Every invocation
  is compared through `realpathSync` on both sides now, with a regression test
  that runs the built binary through a link and a CI step that asserts the
  printed version instead of only the exit code.

## [0.1.2] - 2026-11-01

### Changed

- **CI runs every Node version the package claims to support.** The matrix was
  Node 20 and 22; it is now 20, 22 and 24. The floor still matches `engines`,
  and 24 is the current active LTS.
- **CI now installs the packed tarball and runs the binary from it.** Tests
  prove the source compiles; this proves the thing users download works.
- GitHub Actions moved from `checkout@v4` / `setup-node@v4` to `v5`, which runs
  on Node 24 and clears the Node 20 deprecation warning on every job.
- The README install commands point at
  `releases/latest/download/NAME.tgz` instead of a version-pinned URL, so the
  documented command keeps working across releases. Each release now uploads a
  stable-named copy next to the versioned tarball.

### Fixed

- **`npm run typecheck` failed on a clean checkout.** Two test files imported
  `Severity` from `types.js`, which re-exports nothing, and built `Finding`
  objects with untyped rule ids. They now import from `rules.js` and cast the
  synthetic ids, so `tsc --noEmit` is clean over src and tests.

## [0.1.1] - 2026-10-31

### Fixed

- **Install instructions that could not work.** The README told you to run
  `npm install -g github:kesheC/apidiff`, which resolves to an SSH URL, and in
  the case of `apidiff` also implied an npm registry package that does not exist.
  Both paths are gone. The documented install path is now the release tarball,
  which is built, smoke-tested and uploaded by CI on every tag.

### Added

- `.github/workflows/release.yml`: on a `v*` tag, build, test, `npm pack`, install
  the resulting tarball in a clean directory, run the packaged binary, then upload
  the tarball and its `.sha256` to the GitHub Release.
- `SECURITY.md` with a supported-versions table, a private reporting channel and an
  explicit in-scope / out-of-scope list.
- `prepack` script, so `npm pack` always ships a freshly built `dist/`.
- `author`, `bugs` and `homepage` fields in `package.json`.

### Changed

- `engines.node` is now `>=20.11` for every release artefact, matching the oldest
  Node version the test matrix exercises.
- The build hook moved from `prepare` to `prepack`. `prepare` ran on every
  consumer's machine during install — where `devDependencies` are absent — and npm
  11 warns loudly about unreviewed install scripts, so the documented install path
  printed a warning for no benefit. The tarball now ships a prebuilt `dist/`.

### Removed

- npm registry badges and `npm install -D apidiff` snippets that pointed at an
  unrelated (or non-existent) registry package.

## [0.1.0] - 2026-10-29

### Added

- Initial release: Semver verdict for API contract changes: diff two JSON Schemas or OpenAPI 3.x documents and get a major/minor/none answer plus a readable list of breaking changes.

- Diffs two JSON Schemas or two OpenAPI 3.x documents and classifies every change as breaking, deprecation or non-breaking.
- Prints the semver verdict (major / minor / none) alongside the change list.
- `--contract auto|schema|openapi|env` selects the parser; `--format text|json|markdown` selects the output.
- `--fail-on breaking|deprecation|never` makes CI gates configurable; `--allow-breaking` for an explicit escape hatch.
- `--rules` lists every rule with its id and default severity.
- `--contract env` diffs two `.env` files for changed or removed keys.

### Quality

- 129 tests across 7 spec files, 2082 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20 and 22.
- Zero runtime dependencies.

[0.1.11]: https://github.com/kesheC/apidiff/compare/v0.1.10...v0.1.11
[0.1.12]: https://github.com/kesheC/apidiff/compare/v0.1.11...v0.1.12
[0.1.13]: https://github.com/kesheC/apidiff/compare/v0.1.12...v0.1.13
[0.1.14]: https://github.com/kesheC/apidiff/compare/v0.1.13...v0.1.14
[0.1.15]: https://github.com/kesheC/apidiff/compare/v0.1.14...v0.1.15
[0.1.16]: https://github.com/kesheC/apidiff/compare/v0.1.15...v0.1.16
[0.1.17]: https://github.com/kesheC/apidiff/compare/v0.1.16...v0.1.17
[0.1.19]: https://github.com/kesheC/apidiff/compare/v0.1.17...v0.1.19
[0.1.20]: https://github.com/kesheC/apidiff/compare/v0.1.19...v0.1.20
[0.1.21]: https://github.com/kesheC/apidiff/compare/v0.1.20...v0.1.21
[0.1.22]: https://github.com/kesheC/apidiff/compare/v0.1.21...v0.1.22
[0.1.23]: https://github.com/kesheC/apidiff/compare/v0.1.22...v0.1.23
[Unreleased]: https://github.com/kesheC/apidiff/compare/v0.1.23...HEAD
[0.1.10]: https://github.com/kesheC/apidiff/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/kesheC/apidiff/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/kesheC/apidiff/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/kesheC/apidiff/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/kesheC/apidiff/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/kesheC/apidiff/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/kesheC/apidiff/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/kesheC/apidiff/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/kesheC/apidiff/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/kesheC/apidiff/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kesheC/apidiff/releases/tag/v0.1.0