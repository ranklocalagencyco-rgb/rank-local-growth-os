import { describe, expect, it } from "vitest";

import { backoffSeconds, safeErrorMessage, type ClaimedJob, type EnqueueInput, type JobQueue } from "@/jobs/queue";
import { NonRetryableJobError, processJobBatch } from "@/jobs/worker";

class FakeQueue implements JobQueue {
  jobs: Array<ClaimedJob & { status: string }> = [];
  async enqueue<T extends Record<string, unknown>>(input: EnqueueInput<T>) {
    const existing = this.jobs.find((job) => job.idempotency_key === input.idempotencyKey);
    if (existing) return { jobId: existing.id, created: false };
    const job = { id: `job-${this.jobs.length + 1}`, workspace_id: input.workspaceId, job_type: input.jobType, idempotency_key: input.idempotencyKey, payload_json: input.payload, attempts: 0, max_attempts: input.maxAttempts ?? 3, trace_id: "trace", status: "queued" };
    this.jobs.push(job);
    return { jobId: job.id, created: true };
  }
  async claim(_workerId: string, batchSize: number) {
    const claimable = this.jobs.filter((job) => job.status === "queued" || job.status === "failed").slice(0, batchSize);
    for (const job of claimable) { job.status = "running"; job.attempts += 1; }
    return claimable;
  }
  async complete(jobId: string) { this.jobs.find((job) => job.id === jobId)!.status = "completed"; }
  async fail(job: ClaimedJob, _error: unknown, options: { retryable?: boolean } = {}) {
    const status = options.retryable === false || job.attempts >= job.max_attempts ? "dead_letter" : "failed";
    this.jobs.find((entry) => entry.id === job.id)!.status = status;
    return status;
  }
}

const silentLogger = { log() {}, child: () => ({ debug() {}, info() {}, warn() {}, error() {} }) } as unknown as Parameters<typeof processJobBatch>[0]["logger"];

describe("durable job processing", () => {
  it("enqueues idempotently, retries failures and dead-letters after bounded attempts", async () => {
    const queue = new FakeQueue();
    const first = await queue.enqueue({ workspaceId: "ws", jobType: "discovery.run", idempotencyKey: "discovery.run:run-1", payload: { runId: "run-1" }, maxAttempts: 2 });
    const duplicate = await queue.enqueue({ workspaceId: "ws", jobType: "discovery.run", idempotencyKey: "discovery.run:run-1", payload: { runId: "run-1" }, maxAttempts: 2 });
    expect(duplicate).toEqual({ jobId: first.jobId, created: false });

    const handlers = { "discovery.run": async () => { throw new Error("provider unavailable"); } };
    const one = await processJobBatch({ queue, handlers, workerId: "w", logger: silentLogger });
    expect(one).toMatchObject({ claimed: 1, failed: 1, deadLettered: 0 });
    const two = await processJobBatch({ queue, handlers, workerId: "w", logger: silentLogger });
    expect(two).toMatchObject({ claimed: 1, failed: 0, deadLettered: 1 });
    expect(queue.jobs[0].status).toBe("dead_letter");
  });

  it("dead-letters non-retryable errors immediately and completes successful jobs", async () => {
    const queue = new FakeQueue();
    await queue.enqueue({ workspaceId: "ws", jobType: "candidate.resolve", idempotencyKey: "a", payload: {} });
    await queue.enqueue({ workspaceId: "ws", jobType: "candidate.resolve", idempotencyKey: "b", payload: { fail: true } });
    await queue.enqueue({ workspaceId: "ws", jobType: "unknown.type", idempotencyKey: "c", payload: {} });
    const result = await processJobBatch({ queue, handlers: { "candidate.resolve": async (payload) => { if (payload.fail) throw new NonRetryableJobError("bad candidate"); } }, workerId: "w", logger: silentLogger });
    expect(result).toEqual({ claimed: 3, completed: 1, failed: 0, deadLettered: 2 });
  });

  it("uses bounded exponential backoff and safe error messages", () => {
    expect(backoffSeconds(1)).toBe(15);
    expect(backoffSeconds(3)).toBe(60);
    expect(backoffSeconds(20)).toBe(900);
    expect(safeErrorMessage(new Error("x".repeat(600))).length).toBeLessThanOrEqual(500);
    expect(safeErrorMessage("string")).toBe("Job failed");
  });
});
