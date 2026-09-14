"use server";

import { createCampaign } from "@/data/crm-writes";
import { getWorkspaceContext } from "@/domain/workspaces";

export async function createCampaignAction(formData: FormData): Promise<void> {
  await createCampaign(getWorkspaceContext().workspaceId, formData);
}