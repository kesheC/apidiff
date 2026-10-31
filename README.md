# apidiff

**Semver verdict for API contract changes: diff two JSON Schemas, two OpenAPI documents, or two `.env` files and get `major` / `minor` / `none` plus a list of what actually breaks.**

**API 契约变更的语义化版本判定：对比两个 JSON Schema、两份 OpenAPI 文档或两个 `.env` 文件，直接给出 `major` / `minor` / `none` 结论和具体的破坏点清单。**

[![CI](https://github.com/kesheC/apidiff/actions/workflows/ci.yml/badge.svg)](https://github.com/kesheC/apidiff/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime dependencies: 0](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)](#zero-runtime-dependencies)

---

## The problem / 痛点

Your changelog says `1.4.0 -> 1.5.0`. Your consumers find out the hard way.

A field quietly moves from optional to required, an enum loses a member, a
`DELETE` endpoint disappears, `minimum` goes from `0` to `18` — none of these
are caught by a type checker, because both documents are valid JSON. And the
version bump that supposedly told everyone the answer was picked by a human
reading a diff at 6pm.

apidiff decides the bump mechanically. Every difference maps to a rule, every
rule has a fixed severity, and the most severe finding wins. Two runs over the
same inputs produce byte-identical output, so it can gate CI.

版本的语义不该靠人读 diff 来猜。apidiff 把每条差异映射到固定严重度的规则，
取最严重的一条作为结论，并输出可直接贴进 PR 的清单。

## Install / 安装

`apidiff` is **not published to the npm registry.** The name is still free; this
project just has no publishing credentials yet. Each release ships a tarball you
can install directly:

```console
$ npm install -g https://github.com/kesheC/apidiff/releases/latest/download/apidiff.tgz
$ apidiff --version
0.1.6
```

Every release publishes the same tarball under a stable name (`apidiff.tgz`) alongside an
`apidiff.tgz.sha256` checksum. To verify the download before running it:

```bash
curl -sLO https://github.com/kesheC/apidiff/releases/latest/download/apidiff.tgz
curl -sLO https://github.com/kesheC/apidiff/releases/latest/download/apidiff.tgz.sha256
sha256sum -c apidiff.tgz.sha256          # apidiff.tgz: OK
npm install -g ./apidiff.tgz
```

On macOS use `shasum -a 256 -c apidiff.tgz.sha256` — there is no `sha256sum` by default.

As a project dev dependency / 装成项目依赖：

```console
$ npm install -D https://github.com/kesheC/apidiff/releases/latest/download/apidiff.tgz
$ npx apidiff demo/schema/user-v1.json demo/schema/user-v2.json
```

Or build it from a checkout / 或从源码编译：

```console
$ git clone https://github.com/kesheC/apidiff.git && cd apidiff
$ npm ci && npm run build && npm link
```

Node.js >= 20.11. No runtime dependencies.

> Installing straight from git (`npm install -g git+https://github.com/...`) does
> **not** work: the checkout has no build output and a global install skips
> `devDependencies`, so there is no `tsc` to build it with. Use the tarball, or
> clone and build it yourself.

## Quick start / 60 秒上手

The repo ships the fixtures every snippet below uses, so you can run them as
written after `git clone`.

```console
$ apidiff demo/schema/user-v1.json demo/schema/user-v2.json
verdict: breaking (major)
│   ├─ BREAKING     /properties/age/minimum
│          minimum changed from 0 to 18  [schema.bounds.narrowed]
│   └─ BREAKING     /required
│          property "age" became required  [schema.required.added]
│
│ 2 breaking -> bump major
```

Exit code `1` means "the bump you need is a major one". Drop it in CI:

```console
$ apidiff demo/schema/user-v1.json demo/schema/user-v2.json > /dev/null || echo "this is a major release"
this is a major release
```

The same pair, as a PR comment:

```console
$ apidiff --format markdown demo/users-v1.json demo/users-v2.json
**apidiff verdict: breaking (major)**

| Severity | Location | Change | Rule |
| --- | --- | --- | --- |
| BREAKING | DELETE /users/{id} | DELETE /users/{id} was removed; existing callers will get an error | `openapi.operation.removed` |
| BREAKING | GET /users/{id} | GET /users/{id} parameter query "verbose" became required | `openapi.parameter.became-required` |
| BREAKING | GET /users/{id} | properties.age.minimum: minimum changed from 0 to 18 | `schema.bounds.narrowed` |
| BREAKING | GET /users/{id} | properties.role: enum member "member" is no longer accepted | `schema.enum.value.removed` |
| BREAKING | GET /users/{id} | required: property "nickname" became required | `schema.required.added` |
| BREAKING | GET /users/{id} | GET /users/{id} no longer documents response 404 | `openapi.response.removed` |
| CHANGED | GET /users/{id} | GET /users/{id} operationId changed from getUser to fetchUser; generated clients will rename methods | `openapi.operationId.changed` |
| CHANGED | GET /users/{id} | GET /users/{id} parameter query "fields" was added | `openapi.parameter.added-optional` |
```

## Usage / 用法

```console
$ apidiff --help
apidiff — semver verdict for API contract changes

Usage:
  apidiff <old.json> <new.json> [options]
  apidiff <old.env> <new.env> [options]

Options:
  --contract <auto|schema|openapi|env>  Document family to compare (default: auto)
  --format <text|json|markdown>         Output format (default: text)
  --fail-on <breaking|deprecation|never> Exit 1 at or above this severity (default: breaking)
  --allow-breaking                      Report breaking changes but still exit 0
  --ascii                               Use ASCII branch characters
  --quiet                               Print only the verdict line
  --rules                               Print the rule table and exit
  --version                             Print the version and exit
  -h, --help                            Show this help

Exit codes:
  0  compatible, or nothing at or above --fail-on
  1  a change at or above --fail-on was found
  2  the command itself failed (bad arguments, unreadable file, bad document)

Documents are JSON (Schema or OpenAPI) or .env samples; auto-detects which.
OpenAPI must be JSON: convert YAML first, e.g. yq -o=json.
```

### `--contract auto` — pick the differ for you

`auto` is the default and decides per file. **Content outranks the name:**

- if the bytes parse as JSON, the file is a document — an `openapi`/`swagger`/
  `paths` key means OpenAPI, anything else is a JSON Schema. A schema called
  `.env.a.json` is still a schema
- only when JSON parsing fails does the name get a vote: `.env`, `.env.local`,
  `app.env`, **or** a body where every meaningful line is `KEY=value` with no
  `{` anywhere, is an environment file

Both files must land in the same family. A dotenv sample compared against a JSON
document, or an OpenAPI document against a JSON Schema, is an error (exit 2) that
tells you to pass `--contract` — not a nonsense diff where one side "removed
everything".

### `--format json` — for machine consumption

```console
$ apidiff --format json demo/schema/user-v1.json demo/schema/user-v2.json
{
  "verdict": "breaking",
  "bump": "major",
  "counts": {
    "breaking": 2,
    "deprecation": 0,
    "changed": 0
  },
  "total": 2,
  "findings": [
    {
      "id": "schema.bounds.narrowed@/properties/age/minimum",
      "rule": "schema.bounds.narrowed",
      "severity": "breaking",
      "pointer": "/properties/age/minimum",
      "message": "minimum changed from 0 to 18",
      "before": 0,
      "after": 18
    },
    {
      "id": "schema.required.added@/required",
      "rule": "schema.required.added",
      "severity": "breaking",
      "pointer": "/required",
      "message": "property \"age\" became required",
      "after": "age"
    }
  ]
}
```

Field order is stable on purpose, so `diff`-ing two reports is meaningful.

### `--quiet` — just the verdict

```console
$ apidiff --quiet demo/users-v1.json demo/users-v2.json
breaking (major)
```

`--quiet` overrides `--format json` and `--format markdown`, whatever order the
flags appear in: one line on stdout, nothing else. The one exception is a
failing run — an error still emits its `{"error": ...}` object so a caller
piping stdout into a JSON parser never has to special-case failure.

### `--fail-on` — how strict the gate is

```console
$ apidiff --fail-on deprecation demo/schema/user-v1.json demo/schema/user-v1.json
verdict: compatible (none)
│ no contract differences found
```

`--fail-on never` (or `--allow-breaking`) never exits `1`: useful while a
breaking change is still being rolled out.

### Errors go to stderr, and `--format json` stays JSON

The verdict is data, so it owns stdout. Anything that makes the run fail (a bad
flag, a missing file, a document that is neither JSON nor a dotenv sample) is
written to stderr and exits `2`, which means `2>/dev/null` really is silent and
`| jq` never sees prose:

```console
$ apidiff demo/schema/user-v1.json 2>/dev/null
$ echo $?
2
```

And the machine-readable form of a failure, still on stdout when `--format json` is
in effect:

```console
$ apidiff --format json nope.json nope2.json 2>/dev/null
{"error":{"message":"cannot read nope.json"},"exitCode":2}
```

When `--format json` is in effect the error is *also* printed to stdout as one
JSON object, so a machine consumer can parse failures and successes the same way.
The human sentence still goes to stderr — you get both, on the stream that suits
each audience.

## Real-world demo / 真实演示

An OpenAPI document that changed in six places at once — `demo/users-v1.json`
vs `demo/users-v2.json`:

```console
$ apidiff demo/users-v1.json demo/users-v2.json
verdict: breaking (major)
│   ├─ BREAKING     DELETE /users/{id}
│          DELETE /users/{id} was removed; existing callers will get an error  [openapi.operation.removed]
│   ├─ BREAKING     GET /users/{id}
│          GET /users/{id} parameter query "verbose" became required  [openapi.parameter.became-required]
│   ├─ BREAKING     GET /users/{id}
│          properties.age.minimum: minimum changed from 0 to 18  [schema.bounds.narrowed]
│   ├─ BREAKING     GET /users/{id}
│          properties.role: enum member "member" is no longer accepted  [schema.enum.value.removed]
│   ├─ BREAKING     GET /users/{id}
│          required: property "nickname" became required  [schema.required.added]
│          via #/components/schemas/User
│   ├─ BREAKING     GET /users/{id}
│          GET /users/{id} no longer documents response 404  [openapi.response.removed]
│   ├─ CHANGED      GET /users/{id}
│          GET /users/{id} operationId changed from getUser to fetchUser; generated clients will rename methods  [openapi.operationId.changed]
│   └─ CHANGED      GET /users/{id}
│          GET /users/{id} parameter query "fields" was added  [openapi.parameter.added-optional]
│
│ 6 breaking, 2 changed -> bump major
```

Environment files take the same treatment — a variable that disappeared and one
that appeared:

```console
$ apidiff --contract env demo/env/app-v1.env demo/env/app-v2.env
verdict: breaking (major)
│   ├─ BREAKING     DB_URL
│          environment variable DB_URL is no longer read  [env.key.removed]
│   └─ CHANGED      LOG_LEVEL
│          environment variable LOG_LEVEL is new  [env.key.added]
│
│ 1 breaking, 1 changed -> bump major
```

## The rule table / 规则表

```console
$ apidiff --rules
Rule table (severity is fixed per rule):

  CHANGED     env.key.added                           A new environment variable was added
  BREAKING    env.key.removed                         An environment variable was removed
  CHANGED     openapi.mediaType.added                 A new media type was added
  BREAKING    openapi.mediaType.removed               A media type is no longer accepted or returned
  CHANGED     openapi.operation.added                 A new operation was added
  DEPRECATION openapi.operation.deprecated            An operation was marked deprecated
  ...
```

57 rules today: **31 breaking, 24 changed, 2 deprecation**. Print the full table
with `apidiff --rules`.

Severity is a property of the rule, not of the occurrence: `schema.bounds.narrowed`
is breaking every time it fires, so a change can never be "breaking on Tuesdays".
The one rule that is deliberately advisory is `schema.ref.broken` — a `$ref` that
cannot be resolved (a missing sibling file, a typo'd anchor) is reported as
`changed` with the offending ref in the message, because a compare that could not
happen is not the same thing as an API that broke.

Three severities, in ladder order:

| Severity | Bump | Meaning |
| --- | --- | --- |
| `breaking` | `major` | An existing caller can be broken by this change |
| `deprecation` | `minor` | Still works, but is going away |
| `changed` | `minor` | Additive or advisory; existing callers keep working |
| *(none)* | `none` | Byte-identical contracts |

The bump is derived, not guessed: `verdictOf` takes the most severe finding.
There are no ties to break, because the ladder is total.

## How it works / 实现要点

```
old.json ─┐
          ├─→ detect contract kind ─→ differ ─→ findings ─→ verdictOf ─→ render/exit
new.json ─┘                          (schema |            (most severe
                                      openapi |            wins)
                                      env)
```

- **Pure library, thin CLI.** `src/index.ts` exports only functions; nothing
  reads `process.argv` or calls `process.exit`. `src/cli.ts` does argument
  parsing, file reading and the exit-code mapping. That split is why the library
  is testable without spawning a process.
- **Findings are the only currency.** Every rule emits a `Finding` carrying
  `rule`, `severity`, an RFC 6901 `pointer`, a one-sentence `message` and, when
  meaningful, `before`/`after`. Severity is looked up from the rule table, so a
  rule cannot disagree with its own documentation.
- **Determinism.** Findings are sorted most-severe-first, then by pointer. No
  timestamps, no map iteration order, no absolute paths leak into the JSON.
- **`$ref` following.** `RefResolver` walks `#/components/...` pointers and
  records the `viaRef` that led to a finding, so `nickname became required`
  points at `#/components/schemas/User` instead of an anonymous node.
- **No runtime dependencies.** Everything is `node:fs`, `node:path`,
  `node:url`. The only `devDependencies` are TypeScript, `@types/node` and Vitest.

## Library API

```ts
import { diffSchemas, verdictOf, formatText, shouldFail } from "apidiff";

const { findings } = diffSchemas(oldSchema, newSchema);  // { kind, findings }
const verdict = verdictOf(findings);
console.log(formatText(verdict));
console.log(verdict.bump);     // "major" | "minor" | "none"
console.log(verdict.verdict);  // "breaking" | "deprecation" | "changed" | null

if (shouldFail(verdict, "breaking")) process.exitCode = 1;
```

Every differ returns the same `{ kind, findings }` shape — `diffSchemas`,
`diffOpenApi` and `diffEnv` — so one aggregation path works for all three:

```ts
import { diffEnv, diffOpenApi, diffSchemas, verdictOf } from "apidiff";

// diffEnv takes raw text (it parses KEY=value itself); the JSON differs take
// already-parsed documents. Nothing here touches the filesystem.
const differ =
  family === "env"     ? () => diffEnv(oldText, newText) :
  family === "openapi" ? () => diffOpenApi(oldDoc, newDoc) :
                         () => diffSchemas(oldDoc, newDoc);

const verdict = verdictOf(differ().findings);
```

Library calls never read files, write output or call `process.exit`. Anything
that needs to be fixed by the caller (a mixed family, an array root) throws
`UsageError`, which the CLI turns into exit code 2.

## Zero runtime dependencies

```console
$ node -e "console.log(Object.keys(require('./package.json').dependencies ?? {}).length)"
0
```

## FAQ / 边界

**Does it convert YAML?** No. OpenAPI documents must already be JSON; pipe a
YAML file through `yq -o=json` first. A YAML parser is a runtime dependency and
a large one, and every CI runner already has one available.

**Is `changed` really non-breaking?** By construction, yes: `changed` means
"additive or advisory". If you find a rule in the table that should be
`breaking` instead, that is a bug in the table, not in your document — the
severity is data, in `src/rules.ts`, and it is the single place to fix it.

**Why is `schema.required.removed` breaking?** The schema became *more
permissive*, which sounds harmless, but a property that was guaranteed may now
be absent. Callers that decode into a strict type or read the field
unconditionally break on the missing value. Withdrawing a guarantee is a major
bump.

**What if a document is not valid UTF-8?** The run fails with exit `2` and
`error: <path> is not valid UTF-8`. Decoding is strict on purpose: a file that
only *almost* decodes would otherwise be compared with U+FFFD replacing the bad
bytes, and a compare against corrupted text is worse than no compare at all.
A leading UTF-8 BOM is rejected the same way, for the same reason — `ignoreBOM`
is deliberate, so a BOM-prefixed document cannot parse as something slightly
different from the bytes on disk. Strip it (`sed -i '1s/^\xEF\xBB\xBF//'`).

**What if a document is simply too large?** Past 536870888 bytes (V8's ceiling
on a single string) no text can exist at all, so the run fails with exit `2` and
`error: <path> is too large to compare (<n> bytes; the text limit is <limit>)`
— a size problem, not a corrupt file. Splitting the document, or comparing the
sub-schemas with `diffSchemasAt`, is the way through.

**What if the two files are different kinds?** That is an error, not a diff. A
dotenv sample against a JSON document, or an OpenAPI document against a JSON
Schema, exits `2` and tells you to pass `--contract`. Reporting "everything was
removed" would be technically true and completely useless.

**Does it care about `description`, `example` and other annotations?** No.
Annotations do not change what a caller must send or can receive, so they are
ignored — otherwise every doc typo would demand a release.

**Can it compare OpenAPI 3.0 against 3.1?** It reports
`openapi.version.changed` as breaking and then diffs the parts it understands.
3.1's `type: ["string", "null"]` array form and `nullable` are not fully
equivalent, and the tool does not pretend otherwise.

## Security and changes / 安全与变更

发现安全问题请**不要**开公开 issue —— [SECURITY.md](SECURITY.md) 说明了私密上报渠道以及
需要提供哪些信息。每个版本的改动都记在 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT — see [LICENSE](LICENSE).