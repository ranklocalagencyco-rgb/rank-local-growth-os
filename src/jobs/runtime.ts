import { getSupabaseAdminClient } from "@/db/client";
import { createJobHandlers } from "@/jobs/handlers";
import { SupabaseJobQueue } from "@/jobs/queue";
import { processJobBatch, type BatchResult } from "@/jobs/worker";

/** Runs one bounded batch of durable jobs against Postgres. Used by the worker loop and the cron route. */
export async function runJobBatch(workerId: string, batchSize = 5): Promise<BatchResult> {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase service role configuration is required to process jobs");
  const queue = new SupabaseJobQueue(client);
  return processJobBatch({ queue, handlers: createJobHandlers(client, queue), workerId, batchSize });
}
