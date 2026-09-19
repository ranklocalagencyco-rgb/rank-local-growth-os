import { isAnalysableUrl, PerformanceProviderError, type PerformanceFieldMetrics, type PerformanceMeasurement, type PerformanceProvider, type PerformanceRequest, type PerformanceResult } from "@/performance/provider";

// Google PageSpeed Insights API v5 adapter (RL-058). One GET per call, to a fixed Google host; Google fetches the page, we do not.
// Outbound controls for a fixed vendor host (ai/skills/ssrf-safe-http): GET only, AbortController timeout, streamed byte cap,
// explicit User-Agent, no cookies. DNS pinning / redirect confinement do not apply because we never fetch the analysed URL ourselves;
// that URL is validated (http(s), no credentials) before it is sent on.
// The API key is optional and only ever placed in the query string; it is scrubbed from every error message.
// Only normalized metrics leave this module; the Lighthouse JSON is never stored or logged. A `fields` mask trims the response, but
// the `lighthouseResult.audits` map has to be requested whole: Google's partial-response syntax cannot select inside a map, so any
// selector such as `audits(first-contentful-paint/numericValue)` is rejected with 400 INVALID_ARGUMENT (seen live, 2026-09-19).
// Observed size with the whole map: about 0.2-0.6 MB per response, well under PAGESPEED_MAX_RESPONSE_BYTES.

export const PAGESPEED_BASE_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
export const PAGESPEED_USER_AGENT = "RankLocalGrowthOS-Performance/1.0";
export const PAGESPEED_MAX_RESPONSE_BYTES = 10_000_000;
export const PAGESPEED_CATEGORIES = ["PERFORMANCE", "ACCESSIBILITY", "BEST_PRACTICES", "SEO"] as const;

/** The six lab audits read out of the `audits` map by normalizePageSpeedResponse(); everything else in the map is discarded. */
export const PAGESPEED_LAB_AUDITS = ["first-contentful-paint", "largest-contentful-paint", "cumulative-layout-shift", "total-blocking-time", "speed-index", "interactive"] as const;

/**
 * Partial-response mask: provenance, category scores, field metrics and the whole `audits` map (see the header: map members cannot be
 * selected individually). `categories` is a fixed object, so its per-category `score` selectors are valid.
 */
export const PAGESPEED_FIELDS = [
  "id",
  "analysisUTCTimestamp",
  "loadingExperience(metrics,overall_category,origin_fallback)",
  "originLoadingExperience(metrics,overall_category)",
  "lighthouseResult(requestedUrl,finalUrl,finalDisplayedUrl,lighthouseVersion,fetchTime,runtimeError,runWarnings,categories(performance/score,accessibility/score,best-practices/score,seo/score),audits)",
].join(",");

export type PageSpeedAdapterOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => Date;
  maxResponseBytes?: number;
};

type FieldMetric = { percentile?: unknown };
type LoadingExperience = { metrics?: Record<string, FieldMetric>; overall_category?: unknown; origin_fallback?: unknown };
export type PageSpeedResponse = {
  id?: unknown;
  analysisUTCTimestamp?: unknown;
  loadingExperience?: LoadingExperience;
  originLoadingExperience?: LoadingExperience;
  lighthouseResult?: {
    requestedUrl?: unknown;
    finalUrl?: unknown;
    finalDisplayedUrl?: unknown;
    lighthouseVersion?: unknown;
    fetchTime?: unknown;
    runtimeError?: { code?: unknown; message?: unknown };
    runWarnings?: unknown;
    categories?: Record<string, { score?: unknown } | undefined>;
    audits?: Record<string, { numericValue?: unknown } | undefined>;
  };
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function score100(value: unknown): number | null {
  const score = finite(value);
  return score === null || score > 1 ? null : Math.round(score * 100);
}

function ms(value: unknown): number | null {
  const number = finite(value);
  return number === null ? null : Math.round(number);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function fieldMetricsOf(experience: LoadingExperience | undefined, scope: "url" | "origin"): PerformanceFieldMetrics | null {
  const metrics = experience?.metrics;
  if (!metrics || typeof metrics !== "object") return null;
  const lcpMs = ms(metrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile);
  const inpMs = ms(metrics.INTERACTION_TO_NEXT_PAINT?.percentile);
  const clsPercentile = finite(metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile);
  // The API reports the CLS percentile multiplied by 100.
  const cls = clsPercentile === null ? null : round3(clsPercentile / 100);
  if (lcpMs === null && inpMs === null && cls === null) return null;
  return { scope, lcpMs, inpMs, cls, overallCategory: text(experience?.overall_category) };
}

/** Pure mapping from a PageSpeed response to the provider-neutral measurement. Throws when the run itself reported an error. */
export function normalizePageSpeedResponse(body: PageSpeedResponse, request: Pick<PerformanceRequest, "url" | "strategy">, fallbackObservedAt: string): PerformanceMeasurement {
  const lighthouse = body.lighthouseResult;
  if (!lighthouse || typeof lighthouse !== "object") throw new PerformanceProviderError("PageSpeed Insights returned no Lighthouse result.", "unknown", true);
  const runtimeCode = text(lighthouse.runtimeError?.code);
  if (runtimeCode && runtimeCode !== "NO_ERROR") throw new PerformanceProviderError(`PageSpeed Insights could not analyse the page (${runtimeCode.slice(0, 60)}).`, "target_unanalyzable", false);

  const audits = lighthouse.audits ?? {};
  const categories = lighthouse.categories ?? {};
  const clsValue = finite(audits["cumulative-layout-shift"]?.numericValue);
  const field = fieldMetricsOf(body.loadingExperience, body.loadingExperience?.origin_fallback === true ? "origin" : "url") ?? fieldMetricsOf(body.originLoadingExperience, "origin");
  const warnings = Array.isArray(lighthouse.runWarnings) ? lighthouse.runWarnings.filter((warning): warning is string => typeof warning === "string").slice(0, 5).map((warning) => warning.slice(0, 300)) : [];

  return {
    provider: "pagespeed",
    providerVersion: text(lighthouse.lighthouseVersion),
    strategy: request.strategy,
    requestedUrl: request.url,
    finalUrl: text(lighthouse.finalDisplayedUrl) ?? text(lighthouse.finalUrl) ?? text(body.id),
    observedAt: text(body.analysisUTCTimestamp) ?? text(lighthouse.fetchTime) ?? fallbackObservedAt,
    scores: {
      performance: score100(categories.performance?.score),
      accessibility: score100(categories.accessibility?.score),
      bestPractices: score100(categories["best-practices"]?.score),
      seo: score100(categories.seo?.score),
    },
    lab: {
      fcpMs: ms(audits["first-contentful-paint"]?.numericValue),
      lcpMs: ms(audits["largest-contentful-paint"]?.numericValue),
      cls: clsValue === null ? null : round3(clsValue),
      tbtMs: ms(audits["total-blocking-time"]?.numericValue),
      speedIndexMs: ms(audits["speed-index"]?.numericValue),
      ttiMs: ms(audits.interactive?.numericValue),
    },
    field,
    warnings,
  };
}

export function buildPageSpeedUrl(baseUrl: string, request: Pick<PerformanceRequest, "url" | "strategy">, apiKey?: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("url", request.url);
  url.searchParams.set("strategy", request.strategy === "mobile" ? "MOBILE" : "DESKTOP");
  for (const category of PAGESPEED_CATEGORIES) url.searchParams.append("category", category);
  url.searchParams.set("fields", PAGESPEED_FIELDS);
  if (apiKey) url.searchParams.set("key", apiKey);
  return url.toString();
}

export class PageSpeedPerformanceProvider implements PerformanceProvider {
  readonly name = "pagespeed" as const;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly now: () => Date;
  private readonly maxResponseBytes: number;

  constructor(options: PageSpeedAdapterOptions = {}) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? PAGESPEED_BASE_URL;
    this.now = options.now ?? (() => new Date());
    this.maxResponseBytes = options.maxResponseBytes ?? PAGESPEED_MAX_RESPONSE_BYTES;
  }

  async measure(request: PerformanceRequest): Promise<PerformanceResult> {
    if (!isAnalysableUrl(request.url)) throw new PerformanceProviderError("The URL is not a plain http(s) URL and was not sent for analysis.", "invalid_request", false);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(buildPageSpeedUrl(this.baseUrl, request, this.apiKey), { method: "GET", headers: { accept: "application/json", "user-agent": PAGESPEED_USER_AGENT }, credentials: "omit", redirect: "error", signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) throw new PerformanceProviderError(`PageSpeed Insights did not answer within ${request.timeoutMs} ms.`, "timeout", true);
        throw new PerformanceProviderError(this.scrub(`PageSpeed Insights request failed: ${error instanceof Error ? error.message : "network error"}`), "unavailable", true);
      }

      const raw = await this.readBounded(response, controller);
      if (!response.ok) throw this.classifyFailure(response.status, raw);

      let body: PageSpeedResponse;
      try {
        body = JSON.parse(raw) as PageSpeedResponse;
      } catch {
        throw new PerformanceProviderError("PageSpeed Insights returned a response that is not JSON.", "unknown", true);
      }
      return { measurement: normalizePageSpeedResponse(body, request, this.now().toISOString()), requestCount: 1, costUsd: null };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Streams the body and stops at the byte cap so an unexpected payload can never exhaust memory. */
  private async readBounded(response: Response, controller: AbortController): Promise<string> {
    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > this.maxResponseBytes) {
      controller.abort();
      throw new PerformanceProviderError("PageSpeed Insights response exceeded the size cap.", "response_too_large", false);
    }
    if (!response.body) return "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let textBody = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > this.maxResponseBytes) {
          await reader.cancel();
          throw new PerformanceProviderError("PageSpeed Insights response exceeded the size cap.", "response_too_large", false);
        }
        textBody += decoder.decode(value, { stream: true });
      }
    } catch (error) {
      if (error instanceof PerformanceProviderError) throw error;
      if (controller.signal.aborted) throw new PerformanceProviderError("PageSpeed Insights did not finish answering before the timeout.", "timeout", true);
      throw new PerformanceProviderError("PageSpeed Insights response could not be read.", "unavailable", true);
    }
    return textBody + decoder.decode();
  }

  private classifyFailure(status: number, raw: string): PerformanceProviderError {
    let providerMessage = "";
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: unknown } };
      if (typeof parsed.error?.message === "string") providerMessage = this.scrub(parsed.error.message).slice(0, 200);
    } catch {
      // Non-JSON error bodies carry nothing worth keeping.
    }
    const suffix = providerMessage ? ` Provider message: ${providerMessage}` : "";
    // Lighthouse failures on the target page arrive as 4xx/5xx with this marker; retrying burns quota for the same answer.
    if (/lighthouse returned error/i.test(providerMessage)) return new PerformanceProviderError(`PageSpeed Insights could not analyse the page.${suffix}`, "target_unanalyzable", false);
    if (status === 429) return new PerformanceProviderError(`PageSpeed Insights rate limit reached.${this.apiKey ? "" : " No PAGESPEED_API_KEY is configured; a key is recommended for automated use."}${suffix}`, "quota", true);
    if (status === 401 || status === 403) return new PerformanceProviderError(`PageSpeed Insights rejected the request (HTTP ${status}); check PAGESPEED_API_KEY and that the API is enabled.${suffix}`, "auth", false);
    if (status === 400) return new PerformanceProviderError(`PageSpeed Insights rejected the request as invalid.${suffix}`, "invalid_request", false);
    if (status >= 500) return new PerformanceProviderError(`PageSpeed Insights is unavailable (HTTP ${status}).${suffix}`, "unavailable", true);
    return new PerformanceProviderError(`PageSpeed Insights returned HTTP ${status}.${suffix}`, "unknown", false);
  }

  private scrub(message: string): string {
    const withoutKeyParam = message.replace(/([?&]key=)[^&\s"']+/gi, "$1[redacted]");
    return this.apiKey ? withoutKeyParam.split(this.apiKey).join("[redacted]") : withoutKeyParam;
  }
}
