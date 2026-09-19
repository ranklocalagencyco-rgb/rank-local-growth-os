import { PERFORMANCE_THRESHOLDS } from "@/audit/score/rules";
import type { WebsitePerformanceObservation } from "@/db/types";

// Performance metric display for the audit report. A Good / Needs improvement / Poor label exists only where the scoring engine has
// an explicit threshold pair (PERFORMANCE_THRESHOLDS: LCP, CLS, TBT, INP), applied exactly as the score's banded rules apply it.
// The Lighthouse performance score, FCP, Speed Index and TTI are shown as measured values with no label: no threshold is defined
// for them, and the report never invents one.

export type MetricBand = "good" | "needs_improvement" | "poor";
export const BAND_LABELS: Record<MetricBand, string> = { good: "Good", needs_improvement: "Needs improvement", poor: "Poor" };

type ThresholdKey = keyof typeof PERFORMANCE_THRESHOLDS;

/** At or under the first threshold = good, at or under the second = needs improvement, above = poor (same comparison as the score). */
export function bandOf(value: number, key: ThresholdKey): MetricBand {
  const [good, needsImprovement] = PERFORMANCE_THRESHOLDS[key];
  return value <= good ? "good" : value <= needsImprovement ? "needs_improvement" : "poor";
}

export function formatMs(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

export function formatCls(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

export type ReportMetric = { key: string; label: string; value: string; band: MetricBand | null; bandLabel: string | null; thresholdNote: string | null };

function metric(key: string, label: string, raw: number | null, format: (value: number) => string, threshold: ThresholdKey | null): ReportMetric | null {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return null;
  const band = threshold ? bandOf(raw, threshold) : null;
  const pair = threshold ? PERFORMANCE_THRESHOLDS[threshold] : null;
  return { key, label, value: format(raw), band, bandLabel: band ? BAND_LABELS[band] : null, thresholdNote: pair ? `Good ≤ ${format(pair[0])} · Poor > ${format(pair[1])}` : null };
}

/** Lab metrics of one observation, in reading order. Metrics the provider did not return are omitted rather than shown as zero. */
export function labMetrics(observation: WebsitePerformanceObservation): ReportMetric[] {
  return [
    metric("fcp", "First Contentful Paint", observation.fcp_ms, formatMs, null),
    metric("lcp", "Largest Contentful Paint", observation.lcp_ms, formatMs, "lcpMs"),
    metric("cls", "Cumulative Layout Shift", observation.cls, formatCls, "cls"),
    metric("tbt", "Total Blocking Time", observation.tbt_ms, formatMs, "tbtMs"),
    metric("speed_index", "Speed Index", observation.speed_index_ms, formatMs, null),
    metric("tti", "Time to Interactive", observation.tti_ms, formatMs, null),
  ].filter((entry): entry is ReportMetric => entry !== null);
}

/** Field (real-user, p75) metrics, only when the provider returned field data for the observation. */
export function fieldMetrics(observation: WebsitePerformanceObservation): ReportMetric[] {
  if (!observation.field_data_available) return [];
  return [
    metric("field_lcp", "Largest Contentful Paint (p75)", observation.field_lcp_ms, formatMs, "lcpMs"),
    metric("field_inp", "Interaction to Next Paint (p75)", observation.field_inp_ms, formatMs, "inpMs"),
    metric("field_cls", "Cumulative Layout Shift (p75)", observation.field_cls, formatCls, "cls"),
  ].filter((entry): entry is ReportMetric => entry !== null);
}
