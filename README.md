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
0.1.8
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

中文对照：仓库自带下面用到的全部样例文件，`git clone` 之后每条命令都能原样跑通。
第一段输出说明这次改动的结论是 `major`——`/properties/age/minimum` 与
`/required` 两处都是 `BREAKING`；第二段把这个退出码直接当 CI 门禁用，只要判定为
major，`||` 右边就会打印 `this is a major release`；第三段是同一对 OpenAPI 文件
改用 `--format markdown` 渲染出的整张表，可以直接贴进 PR 评论。

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

中文对照：上面就是 `--help` 的原样输出——每个选项的取值、三个退出码的含义，
以及「文档要么是 JSON（Schema 或 OpenAPI），要么是 `.env` 样例，自动识别；OpenAPI
必须是 JSON，YAML 先过 `yq -o=json`」这条前提，都写在这里。

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

中文对照：`auto` 是默认值，并且**逐文件判定**。内容优先于文件名——能解析成
JSON 的就是文档（带 `openapi`/`swagger`/`paths` 键的是 OpenAPI，其余按 JSON Schema
处理），所以一个叫作 `.env.a.json` 的文件仍然是 schema；只有 JSON 解析失败时文件名才
有投票权：`.env`、`.env.local`、`app.env`，**或者**正文每一行有意义的内容都是
`KEY=value` 且整篇没有 `{`，才算环境文件。两侧必须落在同一族：dotenv 对 JSON 文档、
或 OpenAPI 对 JSON Schema，都会直接报错（退出码 2）并提示你显式传 `--contract`，
而不是给出一份「对方把一切都删光了」的荒谬 diff。

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

中文对照：字段顺序是刻意固定的，因此两份报告可以直接 `diff`。`verdict`/`bump`
是结论，`counts` 按严重度计数，`findings` 里每条都带 `id`（`<rule>@<JSON Pointer>`）、
`rule`、`severity`、`pointer` 与一句话 `message`，需要时还有 `before`/`after`。

### `--quiet` — just the verdict

```console
$ apidiff --quiet demo/users-v1.json demo/users-v2.json
breaking (major)
```

`--quiet` overrides `--format json` and `--format markdown`, whatever order the
flags appear in: one line on stdout, nothing else. The one exception is a
failing run — an error still emits its `{"error": ...}` object so a caller
piping stdout into a JSON parser never has to special-case failure.

中文对照：只留一行结论（`breaking (major)`），并且会压过 `--format json` 和
`--format markdown`，与选项出现顺序无关。唯一的例外是运行失败：错误仍然会输出
`{"error": ...}` 对象，这样把 stdout 直接喂给 JSON 解析器的调用方不必为失败单独分支。

### `--fail-on` — how strict the gate is

```console
$ apidiff --fail-on deprecation demo/schema/user-v1.json demo/schema/user-v1.json
verdict: compatible (none)
│ no contract differences found
```

`--fail-on never` (or `--allow-breaking`) never exits `1`: useful while a
breaking change is still being rolled out.

中文对照：默认阈值是 `--fail-on breaking`——出现 breaking 即退出 1。这一例把阈值
提到 `deprecation`，而两个文件完全相同，所以结论是 `compatible (none)`、退出 0。
`--fail-on never`（等价于 `--allow-breaking`）永不返回 1，适合破坏性变更还在灰度、
暂时不想卡住流水线的阶段。

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

中文对照：结论是数据，所以 stdout 归它所有；任何让本次运行失败的原因（选项写错、
文件不存在、文档既不是 JSON 也不是 dotenv 样例）都写 stderr 并退出 2，因此
`2>/dev/null` 是真的安静、`| jq` 也永远不会读到散文。上面两段：前者只有退出码
（被 `2>/dev/null` 吞掉的正是 stderr 上的那句 `error:`）；后者是 `--format json`
生效时的失败形态——同一个 `{"error":{"message":...},"exitCode":2}` 对象也留在 stdout 上，
机器消费者可以用同一种方式解析成功与失败。

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

中文对照：第一段是一份同时改了六处的 OpenAPI 文档——`DELETE /users/{id}` 被删、
query 参数 `verbose` 由可选变必填、`age.minimum` 从 0 提到 18、enum 少了一个 `member`、
`nickname` 变成必填（该条经 `$ref` 追到 `#/components/schemas/User`，所以多一行
`via #/components/schemas/User`）、响应 404 不再文档化；再加上 operationId 改名与新增
query 参数两条 `CHANGED`，最终 `6 breaking, 2 changed -> bump major`。第二段是同样
处理方式下的两个 `.env` 样例：`DB_URL` 不再被读取（breaking），`LOG_LEVEL` 是新变量
（changed），结论同样是 `major`。

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

中文对照：上面是 `--rules` 的截断输出（完整表用 `apidiff --rules` 自己打印）。
当前共 **57 条规则：31 breaking、24 changed、2 deprecation**。严重度是规则自身的属性，
不是单次命中的属性——`schema.bounds.narrowed` 每次都是 breaking，不会「周二变温和」。
唯一一条刻意降级为提示的规则是 `schema.ref.broken`：解析不到的 `$ref`（缺文件、
锚点拼错）以 `changed` 报出并把那个 ref 写进消息，因为「没能比成」不等于「接口挂了」。
三级严重度阶梯依次是 `breaking`（major：现有调用方可能被破坏）、`deprecation`
（minor：还能用但正在退场）、`changed`（minor：增量或提示，调用方不受影响），
完全相同时为 `none`。bump 是**推导**出来的：`verdictOf` 取最严重的一条，
阶梯是全序的，所以不存在需要打破的平局。

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

中文对照：上图是数据流——两份文档先判定契约种类（schema / openapi / env），
交给对应的 differ 产出 findings，再由 `verdictOf` 取最严重的一条，最后渲染或映射退出码。
下面五条是设计要点：**纯库 + 薄 CLI**（`src/index.ts` 只导出函数，不读 `process.argv`、
不调 `process.exit`；参数解析、读文件、退出码映射都在 `src/cli.ts`，这正是库可以不起进程
就能测的原因）；**findings 是唯一货币**（每条规则产出带 `rule`、`severity`、RFC 6901
`pointer`、一句话 `message` 以及必要时的 `before`/`after` 的 `Finding`，严重度从规则表
查，规则不可能跟自己的文档打架）；**确定性**（findings 先按严重度、再按 pointer 排序，
JSON 里不会有时间戳、map 迭代顺序或绝对路径）；**`$ref` 追踪**（`RefResolver` 走
`#/components/...` 指针并记录 `viaRef`，所以 `nickname became required` 指向
`#/components/schemas/User` 而不是匿名节点）；**零运行时依赖**（只用 `node:fs`、
`node:path`、`node:url`，devDependencies 只有 TypeScript、`@types/node` 和 Vitest）。

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
that needs to be fixed by the caller is a `UsageError`, which the CLI turns into
exit code 2: `diffDetect` throws one when the two documents come from different
families, and the CLI throws its own when a schema root is not an object or a
boolean. `diffSchemas` itself does not reject an array root — it reports a
single `schema.replaced` finding.

中文对照：`diffSchemas` / `diffOpenApi` / `diffEnv` 三个 differ 返回同一种
`{ kind, findings }` 结构，所以一套聚合逻辑通吃：`verdictOf(findings)` 得到 `verdict` 与
`bump`，`formatText` 渲染成文本，`shouldFail(verdict, "breaking")` 给出是否应当失败。
`diffEnv` 接收原始文本（它自己解析 `KEY=value`），两个 JSON differ 接收已经解析好的文档；
库函数不碰文件系统、不写输出、不调 `process.exit`。需要调用方自己修正的问题会抛
`UsageError`，由 CLI 统一转成退出码 2：两侧族别不同由库里的 `diffDetect` 抛出；根不是
对象或布尔则由 CLI 入口的 `assertSchemaRoot` 拦下（库本身对数组根不抛错，只报一条
`schema.replaced`）。英文段与这里说法一致，两边都不再声称数组根会抛 `UsageError`。

## Zero runtime dependencies

```console
$ node -e "console.log(Object.keys(require('./package.json').dependencies ?? {}).length)"
0
```

中文对照：`package.json` 里没有 `dependencies` 字段，上面的命令打印 `0`——
这不是约定，而是这个项目可以被 CI 在任何一台干净机器上跑起来的前提。

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

**What if a document is nested absurdly deep?** The walk stops at 512 levels
with exit `2` and
`error: schemas nest more than 512 levels deep (stopped at <pointer>)`.
The limit is not arbitrary: the walker is recursive, so without it the ceiling
was whatever the runtime's call stack happened to be, and the same file got a
verdict on one Node version and a stack overflow on another — exit 1 either way,
which this tool reserves for "a breaking change was found". Compare the two
sub-schemas with `diffSchemasAt`, or flatten the nesting, to go past it.

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

中文对照，逐条对应上面的七问七答：

1. **会转 YAML 吗？** 不会。OpenAPI 必须已经是 JSON，先用 `yq -o=json` 转换；YAML 解析器
   是体积不小的运行时依赖，而且每个 CI runner 上基本都现成可用。
2. **`changed` 真的不破坏吗？** 按定义如此：`changed` 就是「增量或提示」。如果你发现表里
   某条规则应该是 `breaking`，那是表错了不是文档错了——严重度是数据，就在 `src/rules.ts`
   一处可改。
3. **为什么 `schema.required.removed` 反而是 breaking？** schema 变宽松听起来无害，但一个
   原本被保证存在的字段现在可能缺失；把值解码进严格类型、或无条件读取该字段的调用方
   会崩。**收回一个保证就是 major。**
4. **文档不是合法 UTF-8 怎么办？** 退出码 `2` 并打印
   `error: <path> is not valid UTF-8`。解码刻意严格：只「几乎」能解码的文件若用 U+FFFD
   顶替坏字节再去比较，比不比更糟。文件开头的 UTF-8 BOM 同样被拒（`ignoreBOM` 是有意
   为之，免得带 BOM 的文档解析出与磁盘字节微妙不同的东西），用
   `sed -i '1s/^\xEF\xBB\xBF//'` 去掉即可。
5. **文档太大怎么办？** 超过 536870888 字节（V8 单个字符串的上限）根本没有文本能装下，
   于是退出 `2` 并打印
   `error: <path> is too large to compare (<n> bytes; the text limit is <limit>)`
   ——这是大小问题，不是文件损坏。办法是拆分文档，或改用 `diffSchemasAt` 比较子 schema。
6. **嵌套深得离谱怎么办？** 遍历到 512 层就停下，退出 `2` 并打印
   `error: schemas nest more than 512 levels deep (stopped at <pointer>)`。这个上限不是
   随手定的：遍历是递归实现，没有它时天花板取决于运行时的调用栈，同一个文件在某个 Node
   版本得到结论、在另一个版本栈溢出，而两者都是退出 1——可退出 1 在本工具里专指「发现了
   破坏性变更」。要越过它，用 `diffSchemasAt` 比较两个子 schema，或把嵌套拍平。
7. **两个文件是不同种类怎么办？** 那是错误，不是 diff。dotenv 样例对 JSON 文档、或
   OpenAPI 对 JSON Schema，都会退出 `2` 并提示传 `--contract`——报告「所有东西都被删了」
   在技术上成立、在实用上毫无价值。

另外两条：**它关心 `description`、`example` 这类注解吗？** 不关心——注解不改变调用方
要发什么、能收到什么，否则每次文档改错别字都得发版。**能比 OpenAPI 3.0 与 3.1 吗？**
会先把 `openapi.version.changed` 报成 breaking，再比较它理解的部分；3.1 的
`type: ["string", "null"]` 数组形式与 `nullable` 并不完全等价，这个工具不会假装等价。

## Security and changes / 安全与变更

发现安全问题请**不要**开公开 issue —— [SECURITY.md](SECURITY.md) 说明了私密上报渠道以及
需要提供哪些信息。每个版本的改动都记在 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT — see [LICENSE](LICENSE).

中文对照：MIT 许可，全文见 [LICENSE](LICENSE)；版权归 2026 kesheC。
