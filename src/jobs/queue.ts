import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, JobRow } from "@/db/types";
import { createTraceId } from "@/logging/logger";

// Postgres-backed durable job queue (RL-006). Jobs survive restarts, are claimed atomically
// via the claim_jobs SQL function, retry with backoff, and dead-letter after max attempts.

export type DbClient = SupabaseClient<Database>;

export type EnqueueJobInput = {
  workspaceId: string;
  type: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  runAfter?: Date;
  traceId?: string;
};

export type EnqueueJobResult = { job: JobRow; deduplicated: boolean };

export async function enqueueJob(client: DbClient, input: EnqueueJobInput): Promise<EnqueueJobResult> {
  const insert = await client
    .from("jobs")
    .upsert(
      {
        workspace_id: input.workspaceId,
        type: input.type,
        idempotency_key: input.idempotencyKey,
        payload: input.payload,
        max_attempts: input.maxAttempts ?? 3,
        run_after: (input.runAfter ?? new Date()).toISOString(),
        trace_id: input.traceId ?? createTraceId(),
      },
      { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true },
    )
    .select("*")
    .maybeSingle();

  if (insert.error) throw new Error(`Unable to enqueue job: ${insert.error.message}`);
  if (insert.data) return { job: insert.data, deduplicated: false };

  const existing = await client.from("jobs").select("*").eq("workspace_id", input.workspaceId).eq("idempotency_key", input.idempotencyKey).single();
  if (existing.error) throw new Error(`Unable to load existing job: ${existing.error.message}`);
  return { job: existing.data, deduplicated: true };
}

export async function claimJobs(client: DbClient, workerId: string, limit: number): Promise<JobRow[]> {
  const { data, error } = await client.rpc("claim_jobs", { p_worker_id: workerId, p_limit: limit });
  if (error) throw new Error(`Unable to claim jobs: ${error.message}`);
  return data ?? [];
}

export async function completeJob(client: DbClient, jobId: string): Promise<void> {
  const { error } = await client
    .from("jobs")
    .update({ status: "completed", finished_at: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null })
    .eq("id", jobId);
  if (error) throw new Error(`Unable to complete job: ${error.message}`);
}

export function retryDelaySeconds(attempt: number): number {
  return Math.min(30 * 2 ** Math.max(attempt - 1, 0), 15 * 60);
}

export async function failJob(client: DbClient, job: Pick<JobRow, "id" | "attempts" | "max_attempts">, error: unknown, options: { retryable: boolean }): Promise<"failed" | "dead_letter"> {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Job failed";
  const deadLetter = !options.retryable || job.attempts >= job.max_attempts;
  const status = deadLetter ? "dead_letter" : "failed";
  const runAfter = new Date(Date.now() + retryDelaySeconds(job.attempts) * 1000).toISOString();

  const update = await client
    .from("jobs")
    .update({
      status,
      last_error: message,
      locked_at: null,
      locked_by: null,
      run_after: deadLetter ? undefined : runAfter,
      finished_at: deadLetter ? new Date().toISOString() : null,
    })
    .eq("id", job.id);
  if (update.error) throw new Error(`Unable to record job failure: ${update.error.message}`);
  return status;
}

/** Re-queues a job that made durable progress and wants another slice of work. Resets the retry budget. */
export async function requeueJob(client: DbClient, jobId: string, delaySeconds: number): Promise<void> {
  const { error } = await client
    .from("jobs")
    .update({ status: "queued", attempts: 0, locked_at: null, locked_by: null, run_after: new Date(Date.now() + delaySeconds * 1000).toISOString() })
    .eq("id", jobId);
  if (error) throw new Error(`Unable to requeue job: ${error.message}`);
}
