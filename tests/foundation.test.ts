import { describe, expect, it } from "vitest";

import { parseRuntimeConfig } from "@/config/env";
import { NoopModelRouter } from "@/ai/model-router";
import { InMemoryOutbox } from "@/events/outbox";
import { InMemoryJobRunner } from "@/jobs/runner";
import { requireWorkspaceId } from "@/domain/workspaces";

const workspaceId = "11111111-1111-4111-8111-111111111111";

 describe("foundation contracts", () => {
  it("defaults sending to disabled without provider configuration", () => {
    const config = parseRuntimeConfig({ NODE_ENV: "test" });
    expect(config.sendMode).toBe("disabled");
    expect(config.supabaseUrl).toBeUndefined();
  });

  it("rejects access to another workspace", () => {
    expect(() => requireWorkspaceId("99999999-9999-4999-8999-999999999999", { workspaceId, userId: "user", role: "owner" })).toThrow("Workspace access denied");
  });

  it("deduplicates jobs and dead-letters after bounded retries", async () => {
    const runner = new InMemoryJobRunner();
    const first = runner.enqueue({ type: "audit", workspaceId, idempotencyKey: "audit:1", payload: {}, maxAttempts: 2 });
    const duplicate = runner.enqueue({ type: "audit", workspaceId, idempotencyKey: "audit:1", payload: {}, maxAttempts: 2 });
    expect(duplicate.id).toBe(first.id);

    await runner.run(first.id, async () => { throw new Error("provider unavailable"); });
    await runner.run(first.id, async () => { throw new Error("provider unavailable"); });
    expect(runner.get(first.id)?.status).toBe("dead_letter");
  });

  it("publishes each outbox event once", async () => {
    const outbox = new InMemoryOutbox();
    outbox.append({ workspaceId, aggregateType: "campaign", aggregateId: workspaceId, eventType: "campaign.created", payload: {}, idempotencyKey: "campaign:1" });
    outbox.append({ workspaceId, aggregateType: "campaign", aggregateId: workspaceId, eventType: "campaign.created", payload: {}, idempotencyKey: "campaign:1" });
    const received: string[] = [];
    expect(await outbox.publish(async (event) => { received.push(event.eventType); })).toBe(1);
    expect(await outbox.publish(async (event) => { received.push(event.eventType); })).toBe(0);
    expect(received).toEqual(["campaign.created"]);
  });

  it("boots through a provider-neutral model router", async () => {
    const response = await new NoopModelRouter().complete<{ summary: string }>({ workflow: "research", input: { prospectId: "p1" }, schemaName: "Research" });
    expect(response.provider).toBe("none");
    expect(response.model).toBe("disabled");
    expect(response.output).toEqual({});
  });
});
