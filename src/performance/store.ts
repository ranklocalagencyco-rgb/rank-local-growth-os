import type { AuditStore } from "@/audit/store";
import type { WebsiteAuditScore, WebsitePerformanceObservation } from "@/db/types";
import type { PerformanceMeasurement, PerformanceStrategy } from "@/performance/provider";

// Persistence contract for the audit.performance and audit.score jobs. Implemented by Supabase in src/data/performance-store.ts
// and in-memory in tests. Observation rows double as the job cursor: pending -> succeeded | failed, never back.

export type PendingObservationInput = { workspaceId: string; prospectId: string; auditRunId: string; provider: string; strategy: PerformanceStrategy; requestedUrl: string };

export type AuditScoreInsert = Omit<WebsiteAuditScore, "id" | "created_at" | "retention_class">;

export interface PerformanceStore extends Pick<AuditStore, "getRun" | "enqueue" | "recordActivity" | "recordDomainEvent"> {
  /** Idempotent: ids derive from (run, provider, strategy, URL); existing rows are left untouched. */
  ensureObservations(rows: PendingObservationInput[]): Promise<void>;
  listObservations(auditRunId: string): Promise<WebsitePerformanceObservation[]>;
  /**
   * Atomic compare-and-set taken before every provider request: attempts = seenAttempts + 1 only while the row is still
   * pending with exactly `seenAttempts`. False means another execution owns the row, so no request may be made.
   */
  claimAttempt(observationId: string, seenAttempts: number): Promise<boolean>;
  /** Pending rows only. Keeps the row pending and remembers why the last request failed. */
  noteTransientFailure(observationId: string, error: { code: string; summary: string }): Promise<void>;
  /** Pending rows only: a terminal row is never rewritten. */
  completeObservation(observationId: string, measurement: PerformanceMeasurement): Promise<void>;
  failObservation(observationId: string, error: { code: string; summary: string }): Promise<void>;
}

export interface ScoreStore extends Pick<AuditStore, "getRun" | "listPages" | "recordActivity" | "recordDomainEvent"> {
  listObservations(auditRunId: string): Promise<WebsitePerformanceObservation[]>;
  getScore(auditRunId: string, scoringVersion: string): Promise<WebsiteAuditScore | null>;
  /** Insert-if-absent by (run, scoring version). Returns false when a score already existed; it is never overwritten. */
  insertScore(score: AuditScoreInsert): Promise<boolean>;
}
