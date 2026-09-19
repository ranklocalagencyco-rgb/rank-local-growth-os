import { createSupabaseAuditStore } from "@/data/audit-store";
import { deterministicUuid } from "@/domain/deterministic-id";
import type { DbClient } from "@/jobs/queue";
import type { PerformanceStore, ScoreStore } from "@/performance/store";

// Supabase-backed stores for the audit.performance and audit.score jobs. Writes are idempotent (deterministic ids, on-conflict
// ignore) and every state change is guarded by `status = 'pending'`, so a retried or concurrent job never rewrites a terminal row.

export function performanceObservationId(auditRunId: string, provider: string, strategy: string, requestedUrl: string): string {
  return deterministicUuid("performance_observation", `${auditRunId}:${provider}:${strategy}:${requestedUrl}`);
}

export function auditScoreId(auditRunId: string, scoringVersion: string): string {
  return deterministicUuid("audit_score", `${auditRunId}:${scoringVersion}`);
}

async function listObservations(client: DbClient, auditRunId: string) {
  const { data, error } = await client.from("website_performance_observations").select("*").eq("audit_run_id", auditRunId).order("created_at", { ascending: true });
  if (error) throw new Error(`Unable to load performance observations: ${error.message}`);
  return data ?? [];
}

export function createSupabasePerformanceStore(client: DbClient): PerformanceStore {
  const audit = createSupabaseAuditStore(client);
  return {
    getRun: audit.getRun,
    enqueue: audit.enqueue,
    recordActivity: audit.recordActivity,
    recordDomainEvent: audit.recordDomainEvent,

    async ensureObservations(rows) {
      if (rows.length === 0) return;
      const { error } = await client.from("website_performance_observations").upsert(
        rows.map((row) => ({ id: performanceObservationId(row.auditRunId, row.provider, row.strategy, row.requestedUrl), workspace_id: row.workspaceId, prospect_id: row.prospectId, audit_run_id: row.auditRunId, provider: row.provider, strategy: row.strategy, page_role: "homepage", requested_url: row.requestedUrl, status: "pending" as const })),
        { onConflict: "id", ignoreDuplicates: true },
      );
      if (error) throw new Error(`Unable to create performance observations: ${error.message}`);
    },

    listObservations: (auditRunId) => listObservations(client, auditRunId),

    async claimAttempt(observationId, seenAttempts) {
      const { data, error } = await client.from("website_performance_observations").update({ attempts: seenAttempts + 1 }).eq("id", observationId).eq("status", "pending").eq("attempts", seenAttempts).select("id");
      if (error) throw new Error(`Unable to claim performance observation: ${error.message}`);
      return (data ?? []).length === 1;
    },

    async noteTransientFailure(observationId, failure) {
      const { error } = await client.from("website_performance_observations").update({ error_code: failure.code, error_summary: failure.summary }).eq("id", observationId).eq("status", "pending");
      if (error) throw new Error(`Unable to update performance observation: ${error.message}`);
    },

    async completeObservation(observationId, measurement) {
      const { error } = await client
        .from("website_performance_observations")
        .update({
          status: "succeeded",
          error_code: null,
          error_summary: null,
          provider_version: measurement.providerVersion,
          final_url: measurement.finalUrl,
          performance_score: measurement.scores.performance,
          accessibility_score: measurement.scores.accessibility,
          best_practices_score: measurement.scores.bestPractices,
          seo_score: measurement.scores.seo,
          fcp_ms: measurement.lab.fcpMs,
          lcp_ms: measurement.lab.lcpMs,
          cls: measurement.lab.cls,
          tbt_ms: measurement.lab.tbtMs,
          speed_index_ms: measurement.lab.speedIndexMs,
          tti_ms: measurement.lab.ttiMs,
          field_data_available: measurement.field !== null,
          field_scope: measurement.field?.scope ?? null,
          field_lcp_ms: measurement.field?.lcpMs ?? null,
          field_inp_ms: measurement.field?.inpMs ?? null,
          field_cls: measurement.field?.cls ?? null,
          field_overall_category: measurement.field?.overallCategory ?? null,
          run_warnings: measurement.warnings,
          observed_at: measurement.observedAt,
        })
        .eq("id", observationId)
        .eq("status", "pending");
      if (error) throw new Error(`Unable to store performance observation: ${error.message}`);
    },

    async failObservation(observationId, failure) {
      const { error } = await client.from("website_performance_observations").update({ status: "failed", error_code: failure.code, error_summary: failure.summary }).eq("id", observationId).eq("status", "pending");
      if (error) throw new Error(`Unable to fail performance observation: ${error.message}`);
    },
  };
}

export function createSupabaseScoreStore(client: DbClient): ScoreStore {
  const audit = createSupabaseAuditStore(client);
  return {
    getRun: audit.getRun,
    listPages: audit.listPages,
    recordActivity: audit.recordActivity,
    recordDomainEvent: audit.recordDomainEvent,
    listObservations: (auditRunId) => listObservations(client, auditRunId),

    async getScore(auditRunId, scoringVersion) {
      const { data, error } = await client.from("website_audit_scores").select("*").eq("audit_run_id", auditRunId).eq("scoring_version", scoringVersion).maybeSingle();
      if (error) throw new Error(`Unable to load audit score: ${error.message}`);
      return data;
    },

    async insertScore(score) {
      const { data, error } = await client.from("website_audit_scores").upsert({ id: auditScoreId(score.audit_run_id, score.scoring_version), ...score }, { onConflict: "id", ignoreDuplicates: true }).select("id");
      if (error) throw new Error(`Unable to store audit score: ${error.message}`);
      return (data ?? []).length === 1;
    },
  };
}
