import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { JobRow } from "@/db/types";
import { isRetryable, JobRegistry, NonRetryableJobError, processJobs } from "@/jobs/processor";
import { retryDelaySeconds, type DbClient } from "@/jobs/queue";

const workspaceId = "11111111-1111-4111-8111-111111111111";

function job(overrides: Partial<JobRow>): JobRow {
  return { id: "job-1", workspace_id: workspaceId, type: "test.job", idempotency_key: "k1", payload: { value: 1 }, status: "running", attempts: 1, max_attempts: 3, run_after: "t", locked_at: "t", locked_by: "w", last_error: null, trace_id: "trace", created_at: "t", updated_at: "t", finished_at: null, ...overrides };
}

/** Minimal stand-in for the Supabase client: claim via rpc, record updates by job id. */
function fakeClient(queue: JobRow[]) {
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const client = {
    rpc: async () => ({ data: queue.splice(0, queue.length), error: null }),
    from: () => ({ update: (patch: Record<string, unknown>) => ({ eq: async (_column: string, id: string) => { updates.push({ id, patch }); return { error: null }; } }) }),
  } as unknown as DbClient;
  return { client, updates };
}

const silentLogger = { child: () => ({ debug() {}, info() {}, warn() {}, error() {} }), log() {} } as unknown as NonNullable<Parameters<typeof processJobs>[0]["logger"]>;

describe("job processor", () => {
  it("gives a job type its declared budget, and hands it back untouched when the batch has less than that left", async () => {
    const deadlines: number[] = [];
    const slow = () => new JobRegistry().register("test.job", z.object({ value: z.number() }), async (_payload, context) => { deadlines.push(context.deadline - Date.now()); return { status: "completed" }; }, { budgetMs: 42_000 });

    const roomy = fakeClient([job({ id: "slow" })]);
    expect(await processJobs({ client: roomy.client, registry: slow(), workerId: "test", timeBudgetMs: 45_000, logger: silentLogger })).toMatchObject({ claimed: 1, completed: 1 });
    expect(deadlines[0]).toBeGreaterThan(41_000);
    expect(deadlines[0]).toBeLessThanOrEqual(42_000);

    const tight = fakeClient([job({ id: "slow" })]);
    expect(await processJobs({ client: tight.client, registry: slow(), workerId: "test", timeBudgetMs: 20_000, logger: silentLogger })).toMatchObject({ claimed: 1, completed: 0, continued: 0, failed: 0 });
    expect(deadlines).toHaveLength(1);
    expect(tight.updates).toEqual([{ id: "slow", patch: expect.objectContaining({ status: "queued", attempts: 0 }) }]);
  });

  it("completes, continues, and dead-letters according to handler outcomes", async () => {
    const { client, updates } = fakeClient([job({ id: "done" }), job({ id: "more" }), job({ id: "boom", attempts: 3 }), job({ id: "fatal" })]);
    const registry = new JobRegistry().register("test.job", z.object({ value: z.number() }), async (_payload, context) => {
      if (context.job.id === "more") return { status: "continue", delaySeconds: 5 };
      if (context.job.id === "boom") throw new Error("transient");
      if (context.job.id === "fatal") throw new NonRetryableJobError("bad config");
      return { status: "completed" };
    });

    const summary = await processJobs({ client, registry, workerId: "test", logger: silentLogger });

    expect(summary).toMatchObject({ claimed: 4, completed: 1, continued: 1, failed: 0, deadLettered: 2 });
    expect(updates.find((update) => update.id === "done")?.patch).toMatchObject({ status: "completed" });
    expect(updates.find((update) => update.id === "more")?.patch).toMatchObject({ status: "queued", attempts: 0 });
    expect(updates.find((update) => update.id === "boom")?.patch).toMatchObject({ status: "dead_letter", last_error: "transient" });
    expect(updates.find((update) => update.id === "fatal")?.patch).toMatchObject({ status: "dead_letter", last_error: "bad config" });
  });

  it("schedules a retry with backoff for transient failures below the attempt limit", async () => {
    const { client, updates } = fakeClient([job({ id: "retry", attempts: 1 })]);
    const registry = new JobRegistry().register("test.job", z.object({ value: z.number() }), async () => { throw new Error("provider unavailable"); });
    const summary = await processJobs({ client, registry, workerId: "test", logger: silentLogger });
    expect(summary).toMatchObject({ failed: 1, deadLettered: 0 });
    const patch = updates.find((update) => update.id === "retry")?.patch as { status: string; run_after: string };
    expect(patch.status).toBe("failed");
    expect(new Date(patch.run_after).getTime()).toBeGreaterThan(Date.now() + 20_000);
  });

  it("dead-letters unknown job types and invalid payloads without running a handler", async () => {
    const { client, updates } = fakeClient([job({ id: "unknown", type: "nope" }), job({ id: "invalid", payload: { value: "not a number" } })]);
    let ran = 0;
    const registry = new JobRegistry().register("test.job", z.object({ value: z.number() }), async () => { ran += 1; });
    const summary = await processJobs({ client, registry, workerId: "test", logger: silentLogger });
    expect(ran).toBe(0);
    expect(summary.deadLettered).toBe(2);
    expect(updates.map((update) => (update.patch as { status: string }).status)).toEqual(["dead_letter", "dead_letter"]);
  });

  it("uses exponential backoff capped at fifteen minutes and honours provider retryability", () => {
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(2)).toBe(60);
    expect(retryDelaySeconds(10)).toBe(900);
    expect(isRetryable(new Error("x"))).toBe(true);
    expect(isRetryable(new NonRetryableJobError("x"))).toBe(false);
    expect(isRetryable(Object.assign(new Error("quota"), { retryable: true }))).toBe(true);
    expect(isRetryable(Object.assign(new Error("auth"), { retryable: false }))).toBe(false);
  });
});
