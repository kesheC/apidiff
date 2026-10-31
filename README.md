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

`apidiff` is **not published to the npm registry** — that name belongs to an
unrelated package. Each release ships a tarball you can install directly:

```console
$ npm install -g https://github.com/kesheC/apidiff/releases/latest/download/apidiff.tgz
$ apidiff --version
0.1.5
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
$ apidiff demo/schema/user-v1.json demo/schema/user-v2.json || echo "this is a major release"
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
  apidiff --contract env <old.env> <new.env>

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
  2  the command itself failed (bad arguments, unreadable file, bad JSON)

Both documents must be JSON (OpenAPI: convert YAML first, e.g. yq -o=json).
```

### `--contract auto` — pick the differ for you

`auto` is the default and looks at the document shape: an `openapi` field means
OpenAPI, a top-level `type`/`properties`/`$schema` means JSON Schema, a `.env`
extension means environment file. Force one with `--contract` when a document is
ambiguous (for instance a bare `{}`, which is a valid schema and a valid OpenAPI
skeleton).

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

### `--fail-on` — how strict the gate is

```console
$ apidiff --fail-on deprecation demo/schema/user-v1.json demo/schema/user-v1.json
verdict: compatible (none)
│ no contract differences found
```

`--fail-on never` (or `--allow-breaking`) never exits `1`: useful while a
breaking change is still being rolled out.

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

56 rules today: **31 breaking, 23 changed, 2 deprecation**. Print the full table
with `apidiff --rules`.

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
import { diffSchemas, diffOpenApi, diffEnv, verdictOf, formatText } from "apidiff";

const findings = diffSchemas(oldSchema, newSchema);   // Finding[]
const verdict = verdictOf(findings);
console.log(formatText(verdict));
console.log(verdict.bump);        // "major" | "minor" | "none"
console.log(verdict.verdict);     // "breaking" | "deprecation" | "changed" | null
```

Every differ returns the same shape, so a caller can mix them:

```ts
import { diffEnv, parseEnvKeys, shouldFail, severityRank } from "apidiff";

const result = diffEnv(parseEnvKeys(oldEnvText), parseEnvKeys(newEnvText));
if (shouldFail(result.findings, "breaking")) process.exitCode = 1;
```

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