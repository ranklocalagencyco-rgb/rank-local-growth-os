import { getCurrentSession } from "@/auth/session";

export type WorkspaceContext = {
  workspaceId: string;
  userId: string;
  role: "owner";
};

export function getWorkspaceContext(): WorkspaceContext {
  const session = getCurrentSession();

  return {
    workspaceId: session.workspaceId,
    userId: session.userId,
    role: session.role,
  };
}

export function requireWorkspaceId(expectedWorkspaceId: string, context = getWorkspaceContext()): string {
  if (expectedWorkspaceId !== context.workspaceId) {
    throw new Error("Workspace access denied");
  }

  return context.workspaceId;
}
