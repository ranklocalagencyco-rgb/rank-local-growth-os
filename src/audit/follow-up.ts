import type { AuditStore } from "@/audit/store";

// What happens after a website audit completes: performance evidence (when a provider is enabled), then the deterministic score.
// Job names and keys live here so the audit job, the performance job, the score job and the UI action all agree on them.
// Every enqueue is idempotent by key, so callers may assert the follow-up as often as they like.

export const PERFORMANCE_AUDIT_JOB = "audit.performance";
export const AUDIT_SCORE_JOB = "audit.score";

export function performanceJobIdempotencyKey(auditRunId: string): string {
  return `${PERFORMANCE_AUDIT_JOB}:${auditRunId}`;
}

export function scoreJobIdempotencyKey(auditRunId: string, scoringVersion: string): string {
  return `${AUDIT_SCORE_JOB}:${auditRunId}:${scoringVersion}`;
}

export type FollowUpInput = { workspaceId: string; auditRunId: string; prospectId: string; traceId?: string };

export async function enqueueScoreJob(store: Pick<AuditStore, "enqueue">, input: FollowUpInput, scoringVersion: string): Promise<void> {
  await store.enqueue({ workspaceId: input.workspaceId, type: AUDIT_SCORE_JOB, idempotencyKey: scoreJobIdempotencyKey(input.auditRunId, scoringVersion), payload: { auditRunId: input.auditRunId, prospectId: input.prospectId }, maxAttempts: 4, traceId: input.traceId });
}

/** Performance first when a provider is enabled (it enqueues the score when it ends); otherwise straight to the score. */
export async function enqueueAuditFollowUp(store: Pick<AuditStore, "enqueue">, input: FollowUpInput & { performanceEnabled: boolean; scoringVersion: string }): Promise<void> {
  if (!input.performanceEnabled) return enqueueScoreJob(store, input, input.scoringVersion);
  await store.enqueue({ workspaceId: input.workspaceId, type: PERFORMANCE_AUDIT_JOB, idempotencyKey: performanceJobIdempotencyKey(input.auditRunId), payload: { auditRunId: input.auditRunId, prospectId: input.prospectId }, maxAttempts: 4, traceId: input.traceId });
}
