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
  /** dataforseo (default): Google Maps SERP via DataForSEO. google_places: optional fallback using the Places API (New). */
  discoveryProvider: z.enum(["dataforseo", "google_places"]).default("dataforseo"),
  /**
   * DataForSEO execution mode. standard (default): cheapest, queued task + later retrieval, for automated
   * background discovery. priority: queued with faster turnaround. live: synchronous answer, for manual/on-demand runs.
   */
  dataForSeoMode: z.enum(["standard", "priority", "live"]).default("standard"),
  /** Maps results requested per search unit; DataForSEO bills each 100 results as one page. */
  dataForSeoMapsDepth: z.coerce.number().int().min(20).max(700).default(100),
  /** Optional DataForSEO location_code override; otherwise derived from the campaign country. */
  dataForSeoLocationCode: z.coerce.number().int().positive().optional(),
  discoveryCandidateTtlHours: z.coerce.number().int().positive().max(24 * 30).default(24),
  discoveryMaxPagesPerQuery: z.coerce.number().int().positive().max(3).default(2),
  discoveryDefaultCandidateCap: z.coerce.number().int().positive().max(1000).default(60),
  /** Hard cap on billable provider requests in one discovery run; campaigns may lower it via settings_json.max_requests_per_run. */
  discoveryMaxRequestsPerRun: z.coerce.number().int().positive().max(1000).default(50),
  /** How long a queued (standard/priority) provider task may stay pending before the run is failed. */
  discoveryTaskTimeoutMinutes: z.coerce.number().int().positive().max(24 * 60).default(120),
  /** two_stage: cheap search + per-candidate enrichment (default). inline: contact fields fetched during search, no enrichment calls. */
  discoveryEnrichmentMode: z.enum(["two_stage", "inline"]).default("two_stage"),
  /** Website audit crawl limits. A single audit never crawls a whole site. */
  auditMaxPages: z.coerce.number().int().min(1).max(50).default(15),
  auditRequestTimeoutMs: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  auditMaxResponseBytes: z.coerce.number().int().min(10_000).max(10_000_000).default(2_000_000),
  auditMaxRedirects: z.coerce.number().int().min(0).max(10).default(5),
  /** Performance evidence provider. pagespeed (default): Google PageSpeed Insights v5, usable without an API key. none: skip performance, score without it. */
  performanceProvider: z.enum(["pagespeed", "none"]).default("pagespeed"),
  /** Comma-separated strategies measured per audit, homepage only. One provider request per strategy on the happy path. */
  performanceStrategies: z
    .string()
    .default("mobile,desktop")
    .transform((value) => [...new Set(value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean))])
    .pipe(z.array(z.enum(["mobile", "desktop"])).min(1).max(2)),
  /** Hard cap on provider requests for one audit run, retries included. */
  performanceMaxRequestsPerRun: z.coerce.number().int().min(1).max(10).default(4),
  /** Timeout of one provider request. Bounded so one request always fits a job batch (src/performance/jobs.ts). */
  performanceRequestTimeoutMs: z.coerce.number().int().min(5_000).max(38_000).default(35_000),
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
    dataForSeoMode: optionalEnvironmentValue(environment.DATAFORSEO_MODE),
    dataForSeoMapsDepth: optionalEnvironmentValue(environment.DATAFORSEO_MAPS_DEPTH),
    dataForSeoLocationCode: optionalEnvironmentValue(environment.DATAFORSEO_LOCATION_CODE),
    discoveryCandidateTtlHours: optionalEnvironmentValue(environment.DISCOVERY_CANDIDATE_TTL_HOURS),
    discoveryMaxPagesPerQuery: optionalEnvironmentValue(environment.DISCOVERY_MAX_PAGES_PER_QUERY),
    discoveryDefaultCandidateCap: optionalEnvironmentValue(environment.DISCOVERY_DEFAULT_CANDIDATE_CAP),
    discoveryMaxRequestsPerRun: optionalEnvironmentValue(environment.DISCOVERY_MAX_REQUESTS_PER_RUN),
    discoveryTaskTimeoutMinutes: optionalEnvironmentValue(environment.DISCOVERY_TASK_TIMEOUT_MINUTES),
    discoveryEnrichmentMode: optionalEnvironmentValue(environment.DISCOVERY_ENRICHMENT_MODE),
    auditMaxPages: optionalEnvironmentValue(environment.AUDIT_MAX_PAGES),
    auditRequestTimeoutMs: optionalEnvironmentValue(environment.AUDIT_REQUEST_TIMEOUT_MS),
    auditMaxResponseBytes: optionalEnvironmentValue(environment.AUDIT_MAX_RESPONSE_BYTES),
    auditMaxRedirects: optionalEnvironmentValue(environment.AUDIT_MAX_REDIRECTS),
    performanceProvider: optionalEnvironmentValue(environment.PERFORMANCE_PROVIDER),
    performanceStrategies: optionalEnvironmentValue(environment.PERFORMANCE_STRATEGIES),
    performanceMaxRequestsPerRun: optionalEnvironmentValue(environment.PERFORMANCE_MAX_REQUESTS_PER_RUN),
    performanceRequestTimeoutMs: optionalEnvironmentValue(environment.PERFORMANCE_REQUEST_TIMEOUT_MS),
  });
}

export function getRuntimeConfig(): RuntimeConfig {
  return parseRuntimeConfig();
}
