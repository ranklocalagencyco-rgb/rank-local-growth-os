import { getRuntimeConfig } from "@/config/env";
import { getServerSecrets } from "@/config/server-env";
import type { PerformanceProvider } from "@/performance/provider";
import { PageSpeedPerformanceProvider } from "@/performance/providers/pagespeed";

// Performance provider selection. PERFORMANCE_PROVIDER picks the adapter (pagespeed by default, none to skip).
// PageSpeed Insights works without credentials, so nothing here is ever required to boot or to run a job.

export type PerformanceProviderReadiness = {
  provider: "pagespeed" | "none";
  enabled: boolean;
  /** Optional variables that are unset, by name only. Their absence never blocks a run. */
  recommended: string[];
};

/** Reports the selected provider and which optional variables are unset, without exposing any secret values. */
export function getPerformanceProviderReadiness(): PerformanceProviderReadiness {
  const provider = getRuntimeConfig().performanceProvider;
  if (provider === "none") return { provider, enabled: false, recommended: [] };
  return { provider, enabled: true, recommended: getServerSecrets().pageSpeedApiKey ? [] : ["PAGESPEED_API_KEY"] };
}

/** Null when performance collection is switched off. Constructed only when a job needs it. */
export function getPerformanceProvider(): PerformanceProvider | null {
  const provider = getRuntimeConfig().performanceProvider;
  if (provider === "none") return null;
  return new PageSpeedPerformanceProvider({ apiKey: getServerSecrets().pageSpeedApiKey });
}
