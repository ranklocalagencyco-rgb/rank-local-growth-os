import { z } from "zod";

const runtimeConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  appEnv: z.enum(["local", "staging", "production"]).default("local"),
  sendMode: z.enum(["disabled", "sandbox", "live"]).default("disabled"),
  supabaseUrl: z.string().url().optional(),
  supabasePublishableKey: z.string().min(1).optional(),
  supabaseServiceRoleKey: z.string().min(1).optional(),
  sentryDsn: z.string().url().optional(),
  localWorkspaceId: z.string().uuid().default("11111111-1111-4111-8111-111111111111"),
  localOwnerUserId: z.string().uuid().default("22222222-2222-4222-8222-222222222222"),
  appUrl: z.string().url().default("http://localhost:3000"),
  discoveryProvider: z.enum(["google_places"]).default("google_places"),
  discoveryCandidateTtlHours: z.coerce.number().int().positive().max(24 * 30).default(24),
  discoveryMaxPagesPerQuery: z.coerce.number().int().positive().max(3).default(2),
  discoveryDefaultCandidateCap: z.coerce.number().int().positive().max(1000).default(60),
});

function optionalEnvironmentValue(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export function parseRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return runtimeConfigSchema.parse({
    nodeEnv: environment.NODE_ENV,
    appEnv: environment.APP_ENV,
    sendMode: environment.SEND_MODE,
    supabaseUrl: optionalEnvironmentValue(environment.NEXT_PUBLIC_SUPABASE_URL),
    supabasePublishableKey: optionalEnvironmentValue(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    supabaseServiceRoleKey: optionalEnvironmentValue(environment.SUPABASE_SERVICE_ROLE_KEY),
    sentryDsn: optionalEnvironmentValue(environment.SENTRY_DSN),
    localWorkspaceId: environment.LOCAL_WORKSPACE_ID,
    localOwnerUserId: environment.LOCAL_OWNER_USER_ID,
    appUrl: optionalEnvironmentValue(environment.APP_URL),
    discoveryProvider: optionalEnvironmentValue(environment.DISCOVERY_PROVIDER),
    discoveryCandidateTtlHours: optionalEnvironmentValue(environment.DISCOVERY_CANDIDATE_TTL_HOURS),
    discoveryMaxPagesPerQuery: optionalEnvironmentValue(environment.DISCOVERY_MAX_PAGES_PER_QUERY),
    discoveryDefaultCandidateCap: optionalEnvironmentValue(environment.DISCOVERY_DEFAULT_CANDIDATE_CAP),
  });
}

export function getRuntimeConfig(): RuntimeConfig {
  return parseRuntimeConfig();
}
