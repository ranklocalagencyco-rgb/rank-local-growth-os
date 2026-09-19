import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_FINDING_CODES } from "@/audit/findings";
import { CATEGORY_ORDER, RULE_POINTS } from "@/audit/score/rules";
import { CATEGORY_LABELS, CLIENT_FINDING_TEXT, NOT_EVALUATED_REASON_TEXT, RULE_TEXT, STATE_TEXT, clientFindingText, notEvaluatedReasonText, ruleText } from "@/report/labels";

// The report's wording is a static lookup. These tests keep it complete (no code without text) and factual (no outcome claims).

const root = join(__dirname, "..", "..");
const sourceFiles = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : /\.(ts|tsx|css)$/.test(entry.name) ? [join(dir, entry.name)] : []));

describe("report label maps", () => {
  it("has text for every score rule", () => {
    const codes = CATEGORY_ORDER.flatMap((key) => Object.keys(RULE_POINTS[key]));
    expect(codes).toHaveLength(40);
    expect(Object.keys(RULE_TEXT).sort()).toEqual([...codes].sort());
    for (const code of codes) for (const text of Object.values(RULE_TEXT[code])) expect(text.trim().length).toBeGreaterThan(3);
  });

  it("has client text and a report category for every finding code the rules can emit", () => {
    expect(Object.keys(CLIENT_FINDING_TEXT).sort()).toEqual([...ALL_FINDING_CODES].sort());
    for (const code of ALL_FINDING_CODES) {
      expect(CLIENT_FINDING_TEXT[code].title.length).toBeGreaterThan(5);
      expect(CLIENT_FINDING_TEXT[code].explanation.length).toBeGreaterThan(10);
      expect(CATEGORY_ORDER).toContain(CLIENT_FINDING_TEXT[code].category);
    }
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual([...CATEGORY_ORDER].sort());
  });

  it("has text for every not-evaluated reason the score calculator writes", () => {
    const calculator = readFileSync(join(root, "src/audit/score/calculate.ts"), "utf8");
    const literal = [...calculator.matchAll(/notEvaluated\([^,]+,\s*"([a-z0-9_]+)"/g)].map((match) => match[1]);
    const templated = ["mobile", "desktop"].flatMap((strategy) => [`${strategy}_observation_failed`, `${strategy}_observation_not_collected`]);
    const reasons = [...new Set([...literal, ...templated, "insufficient_category_evidence"])];
    expect(literal.length).toBeGreaterThan(12);
    for (const reason of reasons) expect(NOT_EVALUATED_REASON_TEXT[reason], reason).toBeTruthy();
  });

  it("falls back to a neutral label for codes it does not know, never to a blank or an exception", () => {
    expect(ruleText("some_future_rule")).toEqual({ label: "Some future rule", pass: "Some future rule: passed", gap: "Some future rule: points were lost" });
    expect(clientFindingText("some_future_finding")).toMatchObject({ title: "Some future finding" });
    expect(notEvaluatedReasonText("some_future_reason")).toBe("Some future reason");
    expect(notEvaluatedReasonText(undefined)).toBe("Not enough evidence was collected");
  });

  it("makes no unsupported outcome claims and gives no advice", () => {
    const all = [...Object.values(RULE_TEXT).flatMap((text) => Object.values(text)), ...Object.values(CLIENT_FINDING_TEXT).flatMap((text) => [text.title, text.explanation]), ...Object.values(NOT_EVALUATED_REASON_TEXT), ...Object.values(STATE_TEXT)].join("\n");
    expect(all).not.toMatch(/costing|penali[sz]|losing|lost (?:customers|revenue|sales|leads)|revenue|rank(?:ing)? (?:drop|loss)|competitors?|guarantee|you should|we recommend|must fix|urgent|critical/i);
    expect(STATE_TEXT.fieldUnavailable).toBe("Real-user (CrUX) data was not available for this URL. These field-data checks were not evaluated.");
  });
});

describe("report code is deterministic and internal", () => {
  const files = [...sourceFiles("src/report"), ...sourceFiles("src/ui/audit-report"), ...sourceFiles("app/audits"), "src/data/audit-report.ts"];

  it("imports no LLM SDK, gateway or model router", () => {
    expect(files.length).toBeGreaterThan(8);
    for (const file of files) expect(readFileSync(join(root, file), "utf8"), file).not.toMatch(/from\s+["'](?:@anthropic-ai\/|anthropic|openai|openrouter|@google\/generative-ai|@google\/genai|@mistralai\/|cohere-ai|ollama|langchain|@ai-sdk\/|ai["']|@\/ai\/)/);
  });

  it("offers no share, copy-link or public access affordance, and uses no clock or randomness in the model", () => {
    for (const file of files) expect(readFileSync(join(root, file), "utf8"), file).not.toMatch(/copy link|share link|shareable|public link|share token|navigator\.clipboard/i);
    for (const file of sourceFiles("src/report")) expect(readFileSync(join(root, file), "utf8"), file).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random|toLocale/);
  });
});
