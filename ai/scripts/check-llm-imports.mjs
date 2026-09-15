#!/usr/bin/env node
// Enforces ai/rules/no-llm-in-crawler.md: no LLM SDK, gateway or model-router import inside crawler/audit fetch and parse paths.
//
//   node ai/scripts/check-llm-imports.mjs --scan          walk protected paths in the repo; exit 1 on any violation
//   node ai/scripts/check-llm-imports.mjs --hook          read a Claude Code PreToolUse JSON payload from stdin; exit 2 to block
//   node ai/scripts/check-llm-imports.mjs --check <file>  check one file on disk; exit 1 on violation
//
// The --scan mode is the authoritative, model-agnostic check (run by ai/scripts/quality-gate.sh).
// The --hook mode is an optional early warning for Claude Code and fails open on unreadable input.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PROTECTED_PATHS = ["src/discovery/website/", "src/audit/", "src/crawler/"];

export const FORBIDDEN_SPECIFIERS = [
  { label: "@anthropic-ai/*", test: (s) => s.startsWith("@anthropic-ai/") },
  { label: "anthropic", test: (s) => s === "anthropic" || s.startsWith("anthropic/") },
  { label: "openai", test: (s) => s === "openai" || s.startsWith("openai/") },
  { label: "openrouter", test: (s) => s.toLowerCase().includes("openrouter") },
  { label: "@google/generative-ai", test: (s) => s.startsWith("@google/generative-ai") },
  { label: "@google/genai", test: (s) => s.startsWith("@google/genai") },
  { label: "@mistralai/*", test: (s) => s.startsWith("@mistralai/") },
  { label: "cohere-ai", test: (s) => s === "cohere-ai" || s.startsWith("cohere-ai/") },
  { label: "ollama", test: (s) => s === "ollama" || s.startsWith("ollama/") },
  { label: "langchain", test: (s) => s === "langchain" || s.startsWith("langchain/") || s.startsWith("@langchain/") },
  { label: "@ai-sdk/*", test: (s) => s.startsWith("@ai-sdk/") },
  { label: "ai (Vercel AI SDK)", test: (s) => s === "ai" || s.startsWith("ai/") },
  { label: "model router", test: (s) => /(^|\/)ai\/model-router(\.[cm]?[jt]s)?$/.test(s) },
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const SPECIFIER_PATTERNS = [
  /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function normalizeRepoPath(filePath, root = process.cwd()) {
  const absolute = resolve(root, filePath);
  return relative(root, absolute).split(sep).join("/");
}

export function isProtectedPath(repoPath) {
  const normalized = repoPath.replace(/^\.\//, "");
  return PROTECTED_PATHS.some((prefix) => normalized.startsWith(prefix));
}

/** Returns one entry per forbidden import statement found in `content` (comments ignored). */
export function findViolations(repoPath, content) {
  if (!isProtectedPath(repoPath)) return [];
  const violations = [];
  const lines = String(content ?? "").split(/\r?\n/);
  let inBlockComment = false;
  lines.forEach((rawLine, index) => {
    let line = rawLine;
    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end === -1) return;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const blockStart = line.indexOf("/*");
    if (blockStart !== -1) {
      const blockEnd = line.indexOf("*/", blockStart + 2);
      if (blockEnd === -1) { inBlockComment = true; line = line.slice(0, blockStart); } else { line = line.slice(0, blockStart) + line.slice(blockEnd + 2); }
    }
    const lineComment = line.indexOf("//");
    if (lineComment !== -1) line = line.slice(0, lineComment);
    if (!line.trim()) return;
    for (const pattern of SPECIFIER_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const specifier = match[1];
        const hit = FORBIDDEN_SPECIFIERS.find((entry) => entry.test(specifier));
        if (hit) violations.push({ file: repoPath, line: index + 1, specifier, rule: hit.label });
      }
    }
  });
  return violations;
}

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, out);
    else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) out.push(full);
  }
  return out;
}

export function scanRepository(root = process.cwd()) {
  const files = PROTECTED_PATHS.flatMap((prefix) => walk(resolve(root, prefix), []));
  return files.flatMap((file) => findViolations(normalizeRepoPath(file, root), readFileSync(file, "utf8")));
}

function formatViolations(violations) {
  return violations.map((v) => `  ${v.file}:${v.line}  imports "${v.specifier}" (${v.rule})`).join("\n");
}

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function runHook(root) {
  let payload;
  try { payload = JSON.parse(readStdin()); } catch { return 0; }
  const input = payload?.tool_input ?? {};
  const filePath = input.file_path ?? input.path;
  if (typeof filePath !== "string") return 0;
  const repoPath = normalizeRepoPath(filePath, root);
  if (!isProtectedPath(repoPath)) return 0;
  const pieces = [];
  if (typeof input.content === "string") pieces.push(input.content);
  if (typeof input.new_string === "string") pieces.push(input.new_string);
  if (Array.isArray(input.edits)) for (const edit of input.edits) if (typeof edit?.new_string === "string") pieces.push(edit.new_string);
  const violations = findViolations(repoPath, pieces.join("\n"));
  if (violations.length === 0) return 0;
  process.stderr.write(`Blocked by ai/rules/no-llm-in-crawler.md: LLM imports are not allowed under ${PROTECTED_PATHS.join(", ")}.\n${formatViolations(violations)}\nMove AI interpretation outside the crawler/audit paths, behind the model router.\n`);
  return 2;
}

function main(argv) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const mode = argv[0];
  if (mode === "--hook") return runHook(root);
  if (mode === "--check") {
    const file = argv[1];
    if (!file) { console.error("usage: --check <file>"); return 1; }
    const violations = findViolations(normalizeRepoPath(file, root), readFileSync(resolve(root, file), "utf8"));
    if (violations.length) { console.error(formatViolations(violations)); return 1; }
    console.log(`ok: ${file}`);
    return 0;
  }
  const violations = scanRepository(root);
  if (violations.length) {
    console.error(`LLM imports found in protected crawler/audit paths (ai/rules/no-llm-in-crawler.md):\n${formatViolations(violations)}`);
    return 1;
  }
  console.log(`ok: no LLM imports under ${PROTECTED_PATHS.join(", ")}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
