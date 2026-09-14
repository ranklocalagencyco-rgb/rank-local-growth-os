import type { z } from "zod";

import type { JobRow } from "@/db/types";
import { claimJobs, completeJob, failJob, requeueJob, type DbClient } from "@/jobs/queue";
import { createLogger } from "@/logging/logger";

export type JobOutcome = { status: "completed" } | { status: "continue"; delaySeconds?: number };

export type JobContext = {
  client: DbClient;
  job: JobRow;
  traceId: string;
  /** Epoch milliseconds by which the handler should return, persisting progress first. */
  deadline: number;
  logger: ReturnType<ReturnType<typeof createLogger>["child"]>;
};

export type JobHandler<TPayload> = (payload: TPayload, context: JobContext) => Promise<JobOutcome | void>;

/** Thrown by handlers for failures that retrying cannot fix (bad config, invalid payload). */
export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableJobError";
  }
}

type Registration = { schema: z.ZodType<unknown>; handler: JobHandler<unknown> };

export class JobRegistry {
  private readonly handlers = new Map<string, Registration>();

  register<TSchema extends z.ZodType>(type: string, schema: TSchema, handler: JobHandler<z.infer<TSchema>>): this {
    this.handlers.set(type, { schema, handler: handler as JobHandler<unknown> });
    return this;
  }

  get(type: string): Registration | undefined {
    return this.handlers.get(type);
  }

  types(): string[] {
    return [...this.handlers.keys()];
  }
}

export type ProcessJobsOptions = {
  client: DbClient;
  registry: JobRegistry;
  workerId: string;
  limit?: number;
  timeBudgetMs?: number;
  perJobBudgetMs?: number;
  logger?: ReturnType<typeof createLogger>;
};

export type ProcessJobsSummary = {
  claimed: number;
  completed: number;
  continued: number;
  failed: number;
  deadLettered: number;
  errors: { jobId: string; type: string; message: string }[];
};

export function isRetryable(error: unknown): boolean {
  if (error instanceof NonRetryableJobError) return false;
  if (error && typeof error === "object" && "retryable" in error && typeof (error as { retryable: unknown }).retryable === "boolean") {
    return (error as { retryable: boolean }).retryable;
  }
  return true;
}

export async function processJobs(options: ProcessJobsOptions): Promise<ProcessJobsSummary> {
  const { client, registry, workerId } = options;
  const limit = options.limit ?? 5;
  const timeBudgetMs = options.timeBudgetMs ?? 45_000;
  const perJobBudgetMs = options.perJobBudgetMs ?? 25_000;
  const logger = options.logger ?? createLogger();
  const startedAt = Date.now();
  const summary: ProcessJobsSummary = { claimed: 0, completed: 0, continued: 0, failed: 0, deadLettered: 0, errors: [] };

  const jobs = await claimJobs(client, workerId, limit);
  summary.claimed = jobs.length;

  for (const job of jobs) {
    const remaining = startedAt + timeBudgetMs - Date.now();
    const jobLogger = logger.child(job.trace_id, { jobId: job.id, jobType: job.type, attempt: job.attempts });

    if (remaining < 2_000) {
      // Out of time: hand the job back untouched so another worker can pick it up.
      await requeueJob(client, job.id, 1);
      continue;
    }

    const registration = registry.get(job.type);
    if (!registration) {
      const status = await failJob(client, job, new NonRetryableJobError(`No handler registered for job type ${job.type}`), { retryable: false });
      summary.deadLettered += status === "dead_letter" ? 1 : 0;
      summary.errors.push({ jobId: job.id, type: job.type, message: "No handler registered" });
      continue;
    }

    const parsed = registration.schema.safeParse(job.payload);
    if (!parsed.success) {
      await failJob(client, job, new NonRetryableJobError(`Invalid payload for ${job.type}`), { retryable: false });
      summary.deadLettered += 1;
      summary.errors.push({ jobId: job.id, type: job.type, message: "Invalid payload" });
      continue;
    }

    const context: JobContext = { client, job, traceId: job.trace_id, deadline: Date.now() + Math.min(perJobBudgetMs, remaining), logger: jobLogger };

    try {
      jobLogger.info("job.start");
      const outcome = (await registration.handler(parsed.data, context)) ?? { status: "completed" };
      if (outcome.status === "continue") {
        await requeueJob(client, job.id, outcome.delaySeconds ?? 1);
        summary.continued += 1;
        jobLogger.info("job.continue");
      } else {
        await completeJob(client, job.id);
        summary.completed += 1;
        jobLogger.info("job.completed");
      }
    } catch (error) {
      const status = await failJob(client, job, error, { retryable: isRetryable(error) });
      if (status === "dead_letter") summary.deadLettered += 1;
      else summary.failed += 1;
      summary.errors.push({ jobId: job.id, type: job.type, message: error instanceof Error ? error.message : "Job failed" });
      jobLogger.error("job.failed", error, { status });
    }
  }

  return summary;
}
