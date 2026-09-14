import { z } from "zod";

const runtimeConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  appEnv: z.enum(["local", "staging", "production"]).default("local"),
  sendMode: z.enum(["disabled", "sandbox", "live"]).default("disabled"),
  supabaseUrl: z.string().url().optional(),
  supabaseServiceRoleKey: z.string().min(1).optional(),
  sentryDsn: z.string().url().optional(),
  localWorkspaceId: z.string().uuid().default("00000000-0000-0000-0000-000000000001"),
  localOwnerUserId: z.string().uuid().default("00000000-0000-0000-0000-000000000002"),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export function parseRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return runtimeConfigSchema.parse({
    nodeEnv: environment.NODE_ENV,
    appEnv: environment.APP_ENV,
    sendMode: environment.SEND_MODE,
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
    supabaseServiceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    sentryDsn: environment.SENTRY_DSN,
    localWorkspaceId: environment.LOCAL_WORKSPACE_ID,
    localOwnerUserId: environment.LOCAL_OWNER_USER_ID,
  });
}

export function getRuntimeConfig(): RuntimeConfig {
  return parseRuntimeConfig();
}
