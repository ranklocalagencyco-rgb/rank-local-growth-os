import type { ClaimedJob, JobQueue } from "@/jobs/queue";
import { createLogger } from "@/logging/logger";

export type JobContext = { job: ClaimedJob; logger: ReturnType<ReturnType<typeof createLogger>["child"]> };
export type DurableJobHandler = (payload: Record<string, unknown>, context: JobContext) => Promise<void>;
export type HandlerRegistry = Record<string, DurableJobHandler>;

export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableJobError";
  }
}

export type BatchResult = { claimed: number; completed: number; failed: number; deadLettered: number };

export async function processJobBatch(input: { queue: JobQueue; handlers: HandlerRegistry; workerId: string; batchSize?: number; logger?: ReturnType<typeof createLogger> }): Promise<BatchResult> {
  const logger = input.logger ?? createLogger();
  const jobs = await input.queue.claim(input.workerId, input.batchSize ?? 5);
  const result: BatchResult = { claimed: jobs.length, completed: 0, failed: 0, deadLettered: 0 };

  for (const job of jobs) {
    const jobLogger = logger.child(job.trace_id, { jobId: job.id, jobType: job.job_type, attempt: job.attempts });
    const handler = input.handlers[job.job_type];
    try {
      if (!handler) throw new NonRetryableJobError(`No handler registered for job type ${job.job_type}`);
      jobLogger.info("job.started");
      await handler(job.payload_json, { job, logger: jobLogger });
      await input.queue.complete(job.id);
      result.completed += 1;
      jobLogger.info("job.completed");
    } catch (error) {
      const retryable = !(error instanceof NonRetryableJobError) && !(typeof error === "object" && error !== null && "retryable" in error && (error as { retryable?: boolean }).retryable === false);
      const status = await input.queue.fail(job, error, { retryable });
      if (status === "dead_letter") result.deadLettered += 1;
      else result.failed += 1;
      jobLogger.error(`job.${status}`, error);
    }
  }

  return result;
}
