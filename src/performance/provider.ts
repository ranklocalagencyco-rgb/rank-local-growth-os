// Performance-provider contract (RL-058). Provider-neutral: no vendor field names leak past an adapter.
// Separate from business discovery (src/discovery/provider.ts), from our crawler (src/audit) and from the model router.
// Deterministic measurements only; nothing in this directory may import an LLM SDK (ai/rules/no-llm-in-crawler.md).

export type PerformanceProviderName = "pagespeed";
export type PerformanceStrategy = "mobile" | "desktop";

export type PerformanceRequest = {
  /** Absolute http(s) URL of the page to analyse. V1 passes the audited homepage only. */
  url: string;
  strategy: PerformanceStrategy;
  /** Upper bound for this one call; the adapter aborts and reports a retryable failure when it elapses. */
  timeoutMs: number;
};

/** Lab metrics from one synthetic run. Null = the provider did not return the metric. */
export type PerformanceLabMetrics = {
  fcpMs: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  speedIndexMs: number | null;
  ttiMs: number | null;
};

/** Real-user (field) p75 values. Null = no field data for this URL or origin. */
export type PerformanceFieldMetrics = {
  scope: "url" | "origin";
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  /** The provider's own overall assessment, stored as returned. Never derived by us. */
  overallCategory: string | null;
};

export type PerformanceMeasurement = {
  provider: PerformanceProviderName;
  /** Version of the measuring engine when the provider reports one (e.g. the Lighthouse version). */
  providerVersion: string | null;
  strategy: PerformanceStrategy;
  requestedUrl: string;
  finalUrl: string | null;
  /** When the provider ran the analysis (ISO 8601). */
  observedAt: string;
  /** Category scores, integers 0-100. */
  scores: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null };
  lab: PerformanceLabMetrics;
  field: PerformanceFieldMetrics | null;
  warnings: string[];
};

export type PerformanceResult = {
  measurement: PerformanceMeasurement;
  /** Provider requests made by this call. */
  requestCount: number;
  /** Provider-reported charge in USD when the provider exposes one; PageSpeed Insights does not. */
  costUsd?: number | null;
};

export interface PerformanceProvider {
  readonly name: PerformanceProviderName;
  /** One bounded analysis of one URL with one strategy. Never iterates pages or strategies on its own. */
  measure(request: PerformanceRequest): Promise<PerformanceResult>;
}

export type PerformanceProviderErrorCode =
  | "auth"
  | "quota"
  | "invalid_request"
  /** The provider ran but could not analyse the target page (e.g. the document failed to load). Retrying rarely helps. */
  | "target_unanalyzable"
  | "timeout"
  | "unavailable"
  | "response_too_large"
  | "unknown";

/** `retryable` is read by the job processor (src/jobs/processor.ts isRetryable). Messages never contain credentials. */
export class PerformanceProviderError extends Error {
  readonly code: PerformanceProviderErrorCode;
  readonly retryable: boolean;

  constructor(message: string, code: PerformanceProviderErrorCode, retryable: boolean) {
    super(message);
    this.name = "PerformanceProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** The analysed URL travels to a third party: only plain public-looking http(s) URLs without credentials are passed on. */
export function isAnalysableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "" && url.hostname.includes(".");
  } catch {
    return false;
  }
}
