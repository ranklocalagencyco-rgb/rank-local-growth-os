import { describe, expect, it } from "vitest";

import { findViolations, isProtectedPath, scanRepository } from "../../ai/scripts/check-llm-imports.mjs";

const protectedFile = "src/discovery/website/http-probe.ts";

describe("no-llm-in-crawler scanner", () => {
  it("protects crawler, audit and website verification paths only", () => {
    expect(isProtectedPath("src/discovery/website/verify.ts")).toBe(true);
    expect(isProtectedPath("src/audit/crawler.ts")).toBe(true);
    expect(isProtectedPath("src/crawler/fetch.ts")).toBe(true);
    expect(isProtectedPath("src/discovery/providers/dataforseo.ts")).toBe(false);
    expect(isProtectedPath("src/ai/model-router.ts")).toBe(false);
    expect(isProtectedPath("app/page.tsx")).toBe(false);
  });

  it("flags every forbidden provider in import, export-from, dynamic import and require forms", () => {
    const cases: [string, string][] = [
      ['import Anthropic from "@anthropic-ai/sdk";', "@anthropic-ai/*"],
      ['import OpenAI from "openai";', "openai"],
      ['import { OpenRouter } from "@openrouter/ai-sdk-provider";', "openrouter"],
      ['import { GoogleGenerativeAI } from "@google/generative-ai";', "@google/generative-ai"],
      ['import { GoogleGenAI } from "@google/genai";', "@google/genai"],
      ['import { Mistral } from "@mistralai/mistralai";', "@mistralai/*"],
      ['import { CohereClient } from "cohere-ai";', "cohere-ai"],
      ['import ollama from "ollama";', "ollama"],
      ['import { ChatOpenAI } from "@langchain/openai";', "langchain"],
      ['import { anthropic } from "@ai-sdk/anthropic";', "@ai-sdk/*"],
      ['import { generateText } from "ai";', "ai (Vercel AI SDK)"],
      ['import { getModelRouter } from "@/ai/model-router";', "model router"],
      ["export * from '../../ai/model-router';", "model router"],
      ['const client = await import("openai");', "openai"],
      ['const { Anthropic } = require("@anthropic-ai/sdk");', "@anthropic-ai/*"],
    ];
    for (const [line, rule] of cases) {
      const violations = findViolations(protectedFile, `${line}\nexport const x = 1;`);
      expect(violations, line).toHaveLength(1);
      expect(violations[0]).toMatchObject({ file: protectedFile, line: 1, rule });
    }
  });

  it("ignores the same imports outside protected paths", () => {
    expect(findViolations("src/data/discovery.ts", 'import OpenAI from "openai";')).toEqual([]);
    expect(findViolations("src/ai/model-router.ts", 'import Anthropic from "@anthropic-ai/sdk";')).toEqual([]);
  });

  it("does not flag comments, strings or unrelated packages", () => {
    const content = [
      '// import OpenAI from "openai";',
      "/* import Anthropic from \"@anthropic-ai/sdk\"; */",
      "/*",
      '  import { generateText } from "ai";',
      "*/",
      'const note = "we never import openai here";',
      'import { load } from "cheerio";',
      'import { Agent } from "undici";',
      'import { isIP } from "node:net";',
      'import { normalizeDomain } from "@/domain/identifiers";',
      'import { mail } from "aiohttp";',
      'import x from "openai-tokenizer-lite";',
    ].join("\n");
    expect(findViolations(protectedFile, content)).toEqual([]);
  });

  it("reports the correct line numbers for multiple violations", () => {
    const content = ['import { load } from "cheerio";', "", 'import OpenAI from "openai";', 'import ollama from "ollama";'].join("\n");
    expect(findViolations(protectedFile, content).map((v) => v.line)).toEqual([3, 4]);
  });

  it("finds no violations in the current repository", () => {
    expect(scanRepository(process.cwd())).toEqual([]);
  });
});
