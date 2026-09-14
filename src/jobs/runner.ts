import { createTraceId } from "@/logging/logger";

import type { Job, JobHandler } from "@/jobs/types";

type JobStore = {
  jobs: Map<string, Job>;
  byIdempotencyKey: Map<string, string>;
};

export class InMemoryJobRunner {
  private readonly store: JobStore = { jobs: new Map(), byIdempotencyKey: new Map() };

  enqueue<TPayload>(input: { type: string; workspaceId: string; idempotencyKey: string; payload: TPayload; maxAttempts?: number; traceId?: string }): Job<TPayload> {
    const existingId = this.store.byIdempotencyKey.get(input.idempotencyKey);
    if (existingId) return this.store.jobs.get(existingId) as Job<TPayload>;

    const job: Job<TPayload> = {
      id: crypto.randomUUID(),
      type: input.type,
      workspaceId: input.workspaceId,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      status: "queued",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      traceId: input.traceId ?? createTraceId(),
    };
    this.store.jobs.set(job.id, job);
    this.store.byIdempotencyKey.set(job.idempotencyKey, job.id);
    return job;
  }

  async run<TPayload>(jobId: string, handler: JobHandler<TPayload>): Promise<Job<TPayload>> {
    const job = this.store.jobs.get(jobId) as Job<TPayload> | undefined;
    if (!job) throw new Error("Job not found");
    if (job.status === "completed" || job.status === "dead_letter") return job;

    job.status = "running";
    job.attempts += 1;
    try {
      await handler(job);
      job.status = "completed";
      job.lastError = undefined;
    } catch (error) {
      job.lastError = error instanceof Error ? error.message : "Job failed";
      job.status = job.attempts >= job.maxAttempts ? "dead_letter" : "failed";
    }
    return job;
  }

  get(jobId: string): Job | undefined {
    return this.store.jobs.get(jobId);
  }
}
