import { z } from "zod";

import { AUDIT_SCORE_JOB } from "@/audit/follow-up";
import { calculateAuditScore } from "@/audit/score/calculate";
import { AUDIT_SCORE_VERSION } from "@/audit/score/rules";
import { NonRetryableJobError, type JobContext, type JobOutcome, type JobRegistry } from "@/jobs/processor";
import type { ScoreStore } from "@/performance/store";

// Deterministic score job (RL-070/071). Reads stored rows, runs the pure calculator, inserts the score if absent.
// A stored score is immutable: re-running this job, or changing weights later, never rewrites it (a new version adds a new row).
// No provider calls, no LLM (ai/rules/no-llm-in-crawler.md).

export const auditScorePayloadSchema = z.object({ auditRunId: z.string().uuid(), prospectId: z.string().uuid() });
export type AuditScorePayload = z.infer<typeof auditScorePayloadSchema>;

export type ScoreJobDependencies = { store: ScoreStore; now?: () => Date };

export async function runAuditScore(payload: AuditScorePayload, context: Pick<JobContext, "job" | "logger">, deps: ScoreJobDependencies): Promise<JobOutcome> {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const workspaceId = context.job.workspace_id;

  const run = await store.getRun(workspaceId, payload.auditRunId);
  if (!run || run.prospect_id !== payload.prospectId) throw new NonRetryableJobError("Audit run not found");
  if (run.status === "failed") return { status: "completed" };
  if (run.status !== "completed") throw new Error("Website audit has not completed yet");
  if (await store.getScore(run.id, AUDIT_SCORE_VERSION)) return { status: "completed" };

  const [pages, observations] = await Promise.all([store.listPages(run.id), store.listObservations(run.id)]);
  const result = calculateAuditScore({ run, pages, observations });
  const inserted = await store.insertScore({
    workspace_id: workspaceId,
    prospect_id: run.prospect_id,
    audit_run_id: run.id,
    scoring_version: result.scoringVersion,
    score_status: result.status,
    overall_score: result.overallScore,
    technical_score: result.categoryScores.technical,
    local_seo_score: result.categoryScores.local_seo,
    content_structure_score: result.categoryScores.content_structure,
    performance_score: result.categoryScores.performance,
    crawl_score: result.categoryScores.crawl,
    evaluated_weight: result.evaluatedWeight,
    evidence_coverage: result.evidenceCoverage,
    breakdown_json: result.breakdown as unknown as Record<string, unknown>,
    calculated_at: now().toISOString(),
  });
  if (!inserted) return { status: "completed" };

  const headline = result.overallScore === null ? `no overall score (insufficient evidence, ${result.evidenceCoverage}% coverage)` : `${result.overallScore}/100 (${result.status}, ${result.evidenceCoverage}% evidence coverage)`;
  await store.recordActivity({ workspaceId, prospectId: run.prospect_id, eventType: "audit.scored", summary: `Audit score ${result.scoringVersion}: ${headline}.`, metadata: { auditRunId: run.id, scoringVersion: result.scoringVersion, scoreStatus: result.status, overallScore: result.overallScore, evidenceCoverage: result.evidenceCoverage }, idempotencyKey: `audit.scored:${run.id}:${result.scoringVersion}` });
  await store.recordDomainEvent({ workspaceId, aggregateType: "website_audit_run", aggregateId: run.id, eventType: "audit.scored", payload: { prospectId: run.prospect_id, scoringVersion: result.scoringVersion, scoreStatus: result.status, overallScore: result.overallScore, evidenceCoverage: result.evidenceCoverage }, idempotencyKey: `audit.scored:${run.id}:${result.scoringVersion}` });
  context.logger.info("audit.scored", { auditRunId: run.id, scoringVersion: result.scoringVersion, scoreStatus: result.status, overallScore: result.overallScore, evidenceCoverage: result.evidenceCoverage });
  return { status: "completed" };
}

export function registerScoreJobs(registry: JobRegistry, deps: ScoreJobDependencies): JobRegistry {
  registry.register(AUDIT_SCORE_JOB, auditScorePayloadSchema, (payload, context) => runAuditScore(payload, context, deps));
  return registry;
}
