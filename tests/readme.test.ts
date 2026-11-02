import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { diff, diffEnv, formatJson, formatMarkdown, formatRules, formatText, verdictOf } from "../src/index.js";

// The README is mostly transcripts of real runs against demo/*.json and
// demo/env/*.env. Those files are committed, so a new rule, a changed demo
// document or a formatting touch moves several blocks at once — and the CI step
// only greps for one line of one block. Deriving each block with the same
// library calls the CLI uses catches the rest.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const json = (relative: string): unknown => JSON.parse(readFileSync(join(root, relative), "utf8"));
const text = (relative: string): string => readFileSync(join(root, relative), "utf8");

function expectQuoted(block: string): void {
  expect(readme).toContain(block);
}

describe("README transcripts", () => {
  const schema = (): ReturnType<typeof diff> =>
    diff(json("demo/schema/user-v1.json"), json("demo/schema/user-v2.json"));
  const openapi = (): ReturnType<typeof diff> => diff(json("demo/users-v1.json"), json("demo/users-v2.json"));

  it("quotes the text report for the schema pair", () => {
    expectQuoted(formatText(schema()));
  });

  it("quotes the json report for the schema pair", () => {
    expectQuoted(JSON.stringify(formatJson(schema()), null, 2));
  });

  it("quotes the markdown table for the OpenAPI pair", () => {
    expectQuoted(formatMarkdown(openapi()));
  });

  it("quotes the text report for the OpenAPI pair", () => {
    expectQuoted(formatText(openapi()));
  });

  it("quotes the text report for the env pair", () => {
    const findings = diffEnv(text("demo/env/app-v1.env"), text("demo/env/app-v2.env")).findings;
    expectQuoted(formatText(verdictOf(findings)));
  });

  it("quotes the first eight rows of the rule table", () => {
    expectQuoted(formatRules().split("\n").slice(0, 8).join("\n"));
  });

  it("quotes the no-differences report", () => {
    expectQuoted(formatText(diff(json("demo/schema/user-v1.json"), json("demo/schema/user-v1.json"))));
  });
});