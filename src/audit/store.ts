import type { AuditFindingSeverity, Prospect, WebsiteAuditFinding, WebsiteAuditPage, WebsiteAuditRun } from "@/db/types";

// Persistence contract for the website audit job. Implemented by Supabase in src/data/audit-store.ts and in-memory in tests.

export type AuditRunPatch = Partial<{
  status: WebsiteAuditRun["status"];
  jobId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  blockedAt: string | null;
  pagesAttempted: number;
  pagesSucceeded: number;
  pagesFailed: number;
  errorSummary: string | null;
  siteSummary: Record<string, unknown>;
  crawlState: Record<string, unknown>;
}>;

export type AuditPageInsert = Omit<WebsiteAuditPage, "id" | "created_at">;

export type AuditFindingInsert = {
  workspaceId: string;
  auditRunId: string;
  prospectId: string;
  pageId: string | null;
  scope: WebsiteAuditFinding["scope"];
  code: string;
  severity: AuditFindingSeverity;
  evidence: Record<string, unknown>;
  ruleVersion: string;
};

export type AuditProspect = Pick<Prospect, "id" | "workspace_id" | "display_name" | "website_state" | "website_url" | "canonical_domain">;

export interface AuditStore {
  getRun(workspaceId: string, runId: string): Promise<WebsiteAuditRun | null>;
  getProspect(workspaceId: string, prospectId: string): Promise<AuditProspect | null>;
  updateRun(runId: string, patch: AuditRunPatch): Promise<void>;
  /** Idempotent: the page id is derived from (run, requested URL); a retried insert returns the existing id. */
  insertPage(page: AuditPageInsert): Promise<{ id: string }>;
  listPages(runId: string): Promise<WebsiteAuditPage[]>;
  /** Idempotent: finding ids derive from (run, page, code). */
  insertFindings(rows: AuditFindingInsert[]): Promise<void>;
  /** Idempotent by (workspace, idempotencyKey): enqueueing the same follow-up twice returns the existing job. */
  enqueue(input: { workspaceId: string; type: string; idempotencyKey: string; payload: Record<string, unknown>; maxAttempts?: number; traceId?: string }): Promise<void>;
  recordActivity(input: { workspaceId: string; prospectId: string; eventType: string; summary: string; metadata?: Record<string, unknown>; idempotencyKey: string }): Promise<void>;
  recordDomainEvent(input: { workspaceId: string; aggregateType: string; aggregateId: string; eventType: string; payload: Record<string, unknown>; idempotencyKey: string }): Promise<void>;
}
