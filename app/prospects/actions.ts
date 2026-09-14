"use server";

import { createProspect } from "@/data/crm-writes";
import { getWorkspaceContext } from "@/domain/workspaces";

export async function createProspectAction(formData: FormData): Promise<void> {
  await createProspect(getWorkspaceContext().workspaceId, formData);
}