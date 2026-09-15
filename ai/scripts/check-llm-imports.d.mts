export type LlmImportViolation = { file: string; line: number; specifier: string; rule: string };
export const PROTECTED_PATHS: string[];
export const FORBIDDEN_SPECIFIERS: { label: string; test: (specifier: string) => boolean }[];
export function normalizeRepoPath(filePath: string, root?: string): string;
export function isProtectedPath(repoPath: string): boolean;
export function findViolations(repoPath: string, content: string): LlmImportViolation[];
export function scanRepository(root?: string): LlmImportViolation[];
