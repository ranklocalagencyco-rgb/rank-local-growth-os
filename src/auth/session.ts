import { getRuntimeConfig } from "@/config/env";

export type CurrentSession = {
  userId: string;
  workspaceId: string;
  role: "owner";
};

export function getCurrentSession(): CurrentSession {
  const config = getRuntimeConfig();

  return {
    userId: config.localOwnerUserId,
    workspaceId: config.localWorkspaceId,
    role: "owner",
  };
}
