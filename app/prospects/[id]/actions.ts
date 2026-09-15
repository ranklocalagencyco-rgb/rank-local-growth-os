"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { AuditRequestError, requestWebsiteAudit } from "@/audit/run";
import { getSupabaseAdminClient } from "@/db/client";
import { getWorkspaceContext } from "@/domain/workspaces";

function prospectIdFrom(formData: FormData): string {
  const value = formData.get("prospectId");
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Invalid prospect id");
  return value;
}

function back(prospectId: string, params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  revalidatePath(`/prospects/${prospectId}`);
  redirect(`/prospects/${prospectId}${query ? `?${query}` : ""}`);
}

/** Queues a bounded website audit for the prospect. The crawl runs in the background job worker, never in the request. */
export async function runWebsiteAuditAction(formData: FormData): Promise<void> {
  const prospectId = prospectIdFrom(formData);
  const client = getSupabaseAdminClient();
  if (!client) back(prospectId, { error: "Supabase service role configuration is required to run audits." });

  const context = getWorkspaceContext();
  try {
    await requestWebsiteAudit(client, { workspaceId: context.workspaceId, prospectId, userId: context.userId });
  } catch (error) {
    if (error instanceof AuditRequestError) back(prospectId, { error: error.message });
    back(prospectId, { error: "Unable to queue the website audit. Check the server logs and that migration 006 has been applied." });
  }
  back(prospectId, { notice: "Website audit queued." });
}
