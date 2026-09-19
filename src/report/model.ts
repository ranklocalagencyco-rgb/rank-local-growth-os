import { readChallengeEvidence } from "@/audit/challenge-detection";
import { AUDIT_CRAWLER_VERSION } from "@/audit/extract";
import { AUDIT_RULES_VERSION, CHALLENGE_FINDING_CODES, type SiteSummary } from "@/audit/findings";
import type { CategoryBreakdown, RuleResult, ScoreBreakdown } from "@/audit/score/calculate";
import { AUDIT_SCORE_VERSION, CATEGORY_ORDER, CATEGORY_WEIGHTS, RULE_POINTS, type ScoreCategoryKey } from "@/audit/score/rules";
import { isChallengePage, isHtmlSuccess } from "@/audit/site-evidence";
import type { AuditFindingSeverity, AuditPageRole, Prospect, WebsiteAuditFinding, WebsiteAuditPage, WebsiteAuditRun, WebsiteAuditScore, WebsitePerformanceObservation } from "@/db/types";
import { CATEGORY_LABELS, CHALLENGE_KIND_TEXT, FINDING_EVIDENCE_LABELS, RULE_EVIDENCE_LABELS, SEVERITY_LABELS, SEVERITY_ORDER, STATE_TEXT, clientFindingText, evidenceLabel, notEvaluatedReasonText, ruleText } from "@/report/labels";
import { fieldMetrics, labMetrics, type ReportMetric } from "@/report/metrics";

// Pure view model of the client-facing website audit report (docs/AUDIT_REPORT.md). Input: stored rows only. Output: plain data the
// components render without any further logic. Nothing is recalculated: scores, statuses, coverage and rule results are read from the
// immutable score row; findings from the findings rows; site facts from site_summary_json. All wording comes from src/report/labels.ts.
// No I/O, no LLM, no randomness, no clock: the same rows always produce the same report.

export type ReportPageRow = Pick<WebsiteAuditPage, "id" | "path" | "requested_url" | "page_role" | "fetch_ok" | "http_status" | "content_type" | "evidence_json">;
export type ReportProspect = Pick<Prospect, "id" | "display_name" | "canonical_domain" | "website_url">;

export type AuditReportData = {
  run: WebsiteAuditRun;
  prospect: ReportProspect | null;
  pages: ReportPageRow[];
  findings: WebsiteAuditFinding[];
  observations: WebsitePerformanceObservation[];
  /** Newest stored score of this run, any scoring version. Null until audit.score has run. */
  score: WebsiteAuditScore | null;
};

/** One value drives every section, so a blocked or thinly measured audit can never render like a complete one. */
export type ReportState = "complete" | "provisional" | "insufficient" | "unscored" | "blocked";
export type ReportTone = "good" | "warn" | "neutral";
export type EvidenceItem = { label: string; value: string };

export type ReportCategory = { key: ScoreCategoryKey; label: string; max: number; score: number | null; evaluated: boolean; scoreLabel: string; /** 0-1 share of the maximum, null when not evaluated (no bar is drawn). */ ratio: number | null; summary: string };
export type ReportFinding = { code: string; title: string; explanation: string; severity: AuditFindingSeverity; severityLabel: string; category: ScoreCategoryKey; categoryLabel: string; scope: "site" | "page"; affectedCount: number; affectedPaths: string[]; morePaths: number; evidence: EvidenceItem[] };
export type ReportStrength = { code: string; text: string; category: ScoreCategoryKey; categoryLabel: string };
export type LocalSeoItem = { key: string; label: string; state: "found" | "missing" | "not_evaluated"; stateLabel: string; detail: string | null };
export type ReportStrategy = { strategy: "mobile" | "desktop"; label: string; status: "measured" | "failed" | "pending" | "not_collected"; score: number | null; metrics: ReportMetric[]; note: string | null };
export type ReportBreakdownRule = { code: string; label: string; status: RuleResult["status"]; statusLabel: string; pointsLabel: string; evidence: EvidenceItem[] };
export type ReportBreakdownCategory = { key: ScoreCategoryKey; label: string; scoreLabel: string; evaluatedLabel: string; rules: ReportBreakdownRule[] };

export type AuditReportModel = {
  state: ReportState;
  header: { businessName: string; domain: string; websiteUrl: string; auditDateLabel: string; overallLabel: string; overallValue: number | null; statusLabel: string; tone: ReportTone; coverageLabel: string; versions: { crawler: string; rules: string; scoring: string | null }; runId: string; prospectId: string };
  coverage: { percent: number | null; sentence: string; details: string[] };
  historicalNotice: { text: string; versions: string[] } | null;
  blocked: { headline: string; text: string; detail: string; kindLabel: string; url: string; pageTitle: string | null; httpStatusLabel: string; signals: string[]; detectedAtLabel: string } | null;
  categories: ReportCategory[];
  /** False on a blocked run: the website was never read, so there is nothing to list and nothing is "missing". */
  contentEvaluated: boolean;
  keyFindings: ReportFinding[];
  findingGroups: { key: ScoreCategoryKey; label: string; findings: ReportFinding[] }[];
  findingCount: number;
  crawlNotes: string[];
  strengths: ReportStrength[];
  localSeo: { items: LocalSeoItem[]; localities: string[] };
  structure: { roles: { role: AuditPageRole; label: string; count: number }[]; pagesEvaluated: number; pagesAttempted: number; pagesNotLoaded: number; pageCap: number | null; sitemapLabel: string; scopeSentence: string };
  performance: { strategies: ReportStrategy[]; providerLabel: string | null; field: { metrics: ReportMetric[]; scopeLabel: string | null; sentence: string | null } };
  breakdown: ReportBreakdownCategory[];
};

/** A report can be rendered once the crawl is over: completed (with or without a score yet) or blocked. */
export function isReportAvailable(run: Pick<WebsiteAuditRun, "status"> | null | undefined): boolean {
  return run?.status === "completed" || run?.status === "blocked";
}

const ROLE_ORDER: AuditPageRole[] = ["homepage", "service", "location", "contact", "about", "testimonials", "gallery", "blog", "other"];
const ROLE_LABELS: Record<AuditPageRole, string> = { homepage: "Homepage", service: "Service pages", location: "Location pages", contact: "Contact", about: "About", testimonials: "Testimonials / reviews", gallery: "Gallery", blog: "Blog", other: "Other pages" };
const STATUS_LABELS: Record<RuleResult["status"], string> = { pass: "Pass", partial: "Partial", fail: "Fail", not_evaluated: "Not evaluated" };
/** Per-page values: meaningless once a finding entry stands for several pages. */
const PER_PAGE_EVIDENCE_KEYS = new Set(["titleLength", "metaDescriptionLength", "wordCount", "h1Count", "h1EmptyCount", "httpStatus", "discoveredFrom", "groupSize", "metaRobots"]);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (value: number) => String(value).padStart(2, "0");

/** Fixed UTC formatting, independent of the server's locale and time zone. */
export function formatReportDate(iso: string | null | undefined, withTime = false): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return "Not recorded";
  const day = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  return withTime ? `${day}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC` : day;
}

/** "audit-crawler/v3" → 3. Null when the stored string does not follow the `name/vN` convention. */
export function versionGeneration(version: string | null | undefined): number | null {
  const match = /\/v(\d+)$/.exec(version ?? "");
  return match ? Number(match[1]) : null;
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`;
const formatPoints = (value: number) => String(Math.round(value * 100) / 100);

/** An email address, a phone-length run of digits or a UK postcode. Such a value is never printed, whichever evidence key holds it. */
const CONTACT_DETAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}|(?:\+?\d[\s().-]*){9,}|\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

function evidenceValue(key: string, value: unknown): string | null {
  if (key === "reason") return notEvaluatedReasonText(value);
  if (typeof value === "string") return value.length > 0 && value.length <= 120 && !CONTACT_DETAIL.test(value) ? value : null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    const items = value.filter((entry): entry is string | number => typeof entry === "string" || typeof entry === "number");
    if (items.length === 0 || items.length !== value.length) return value.length === 0 ? "None" : null;
    if (items.some((entry) => typeof entry === "string" && CONTACT_DETAIL.test(entry))) return null;
    return items.length > 6 ? `${items.slice(0, 6).join(", ")} and ${items.length - 6} more` : items.join(", ");
  }
  return null;
}

function ruleEvidence(rule: RuleResult): EvidenceItem[] {
  return Object.entries(rule.evidence ?? {})
    .filter(([key]) => key !== "observationId")
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, value]) => {
      const text = evidenceValue(key, value);
      return text === null ? [] : [{ label: evidenceLabel(key, RULE_EVIDENCE_LABELS), value: text }];
    });
}

/** Rules in the documented order of RULE_POINTS (Postgres jsonb does not keep key order), then any code this build does not know. */
function orderedRules(key: ScoreCategoryKey, category: CategoryBreakdown): [string, RuleResult][] {
  const known = Object.keys(RULE_POINTS[key] ?? {});
  const entries = Object.entries(category.rules ?? {});
  return [...known.flatMap((code) => (category.rules?.[code] ? [[code, category.rules[code]] as [string, RuleResult]] : [])), ...entries.filter(([code]) => !known.includes(code)).sort(([a], [b]) => a.localeCompare(b))];
}

function readBreakdown(score: WebsiteAuditScore | null): ScoreBreakdown | null {
  const value = score?.breakdown_json as Partial<ScoreBreakdown> | undefined;
  return value && typeof value === "object" && value.categories && typeof value.categories === "object" ? (value as ScoreBreakdown) : null;
}

const CATEGORY_COLUMNS: Record<ScoreCategoryKey, "technical_score" | "local_seo_score" | "content_structure_score" | "performance_score" | "crawl_score"> = { technical: "technical_score", local_seo: "local_seo_score", content_structure: "content_structure_score", performance: "performance_score", crawl: "crawl_score" };

function categoryReason(category: CategoryBreakdown | undefined, blocked: boolean, key: ScoreCategoryKey): string {
  if (blocked && key !== "performance") return notEvaluatedReasonText("crawl_blocked");
  const counts = new Map<string, number>();
  for (const rule of Object.values(category?.rules ?? {})) {
    const reason = rule.status === "not_evaluated" && typeof rule.evidence?.reason === "string" ? rule.evidence.reason : null;
    if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  return notEvaluatedReasonText(top ?? "insufficient_category_evidence");
}

function buildCategories(score: WebsiteAuditScore | null, breakdown: ScoreBreakdown | null, blocked: boolean): ReportCategory[] {
  if (!score) return [];
  return CATEGORY_ORDER.map((key) => {
    const max = CATEGORY_WEIGHTS[key];
    const value = score[CATEGORY_COLUMNS[key]];
    const category = breakdown?.categories[key];
    if (value === null || value === undefined) return { key, label: CATEGORY_LABELS[key], max, score: null, evaluated: false, scoreLabel: "Not evaluated", ratio: null, summary: `Not evaluated: ${categoryReason(category, blocked, key)}.` };
    // Largest measured loss first; ties resolve to the documented rule order. Rules that were not evaluated are never a "gap".
    let gap: { code: string; lost: number } | null = null;
    for (const [code, rule] of category ? orderedRules(key, category) : []) {
      if (rule.status !== "fail" && rule.status !== "partial") continue;
      const lost = rule.max - rule.points;
      if (lost > 0 && (!gap || lost > gap.lost)) gap = { code, lost };
    }
    return { key, label: CATEGORY_LABELS[key], max, score: value, evaluated: true, scoreLabel: `${formatPoints(value)} / ${max}`, ratio: Math.max(0, Math.min(1, value / max)), summary: gap ? `Key gap: ${ruleText(gap.code).gap}.` : STATE_TEXT.allPassed };
  });
}

function findingEvidence(row: WebsiteAuditFinding, shared: boolean): EvidenceItem[] {
  const json = (row.evidence_json ?? {}) as Record<string, unknown>;
  return Object.keys(FINDING_EVIDENCE_LABELS).flatMap((key) => {
    if (!(key in json) || (shared && PER_PAGE_EVIDENCE_KEYS.has(key))) return [];
    const text = evidenceValue(key, json[key]);
    return text === null ? [] : [{ label: FINDING_EVIDENCE_LABELS[key], value: text }];
  });
}

function buildFindings(rows: WebsiteAuditFinding[]): ReportFinding[] {
  const operational = new Set<string>(CHALLENGE_FINDING_CODES);
  const groups = new Map<string, WebsiteAuditFinding[]>();
  for (const row of rows) {
    if (operational.has(row.code)) continue;
    groups.set(row.code, [...(groups.get(row.code) ?? []), row]);
  }
  const findings = [...groups.entries()].map(([code, members]): ReportFinding => {
    const text = clientFindingText(code);
    const severity = SEVERITY_ORDER.find((level) => members.some((member) => member.severity === level)) ?? "info";
    const scope = members.some((member) => member.scope === "site") ? "site" : "page";
    const paths = scope === "site" ? [] : [...new Set(members.map((member) => { const json = (member.evidence_json ?? {}) as { path?: unknown; url?: unknown }; return typeof json.path === "string" && json.path ? json.path : typeof json.url === "string" ? json.url : null; }).filter((path): path is string => Boolean(path)))].sort();
    return { code, title: text.title, explanation: text.explanation, severity, severityLabel: SEVERITY_LABELS[severity], category: text.category, categoryLabel: CATEGORY_LABELS[text.category], scope, affectedCount: scope === "site" ? 0 : members.length, affectedPaths: paths.slice(0, 5), morePaths: Math.max(0, paths.length - 5), evidence: findingEvidence(members[0], members.length > 1) };
  });
  // Severity, then site-wide before page-level, then how many pages, then the code: a total order, so the list never reshuffles.
  return findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || (a.scope === b.scope ? 0 : a.scope === "site" ? -1 : 1) || b.affectedCount - a.affectedCount || a.code.localeCompare(b.code));
}

function buildStrengths(breakdown: ScoreBreakdown | null): ReportStrength[] {
  if (!breakdown) return [];
  const strengths: (ReportStrength & { max: number; order: number })[] = [];
  let order = 0;
  for (const key of CATEGORY_ORDER) {
    const category = breakdown.categories[key];
    // A withheld category proves nothing either way: its few evaluated rules are not presented as strengths.
    if (!category || category.score === null) continue;
    for (const [code, rule] of orderedRules(key, category)) if (rule.status === "pass") strengths.push({ code, text: ruleText(code).pass, category: key, categoryLabel: CATEGORY_LABELS[key], max: rule.max, order: order++ });
  }
  return strengths.sort((a, b) => b.max - a.max || a.order - b.order).map(({ code, text, category, categoryLabel }) => ({ code, text, category, categoryLabel }));
}

/**
 * Privacy: contact details are reported as detected / not detected / not evaluated plus counts. The report never prints a raw phone
 * number, email address, street address or postcode, even though they were read from the business's own public website.
 */
function buildLocalSeo(summary: Partial<SiteSummary>, breakdown: ScoreBreakdown | null, contentEvaluated: boolean): AuditReportModel["localSeo"] {
  const rules = breakdown?.categories.local_seo?.rules ?? {};
  const item = (key: string, label: string, ruleCode: string, observed: boolean | null, found: string | null, missing: string | null): LocalSeoItem => {
    const rule = rules[ruleCode];
    if (!contentEvaluated) return { key, label, state: "not_evaluated", stateLabel: "Not evaluated", detail: `${notEvaluatedReasonText("crawl_blocked")}.` };
    if (rule?.status === "not_evaluated") return { key, label, state: "not_evaluated", stateLabel: "Not evaluated", detail: `${notEvaluatedReasonText(rule.evidence?.reason)}.` };
    // With a score row the rule decides; without one (score pending) the stored site summary does, and absent evidence is "not evaluated".
    const isFound = rule ? rule.status !== "fail" : observed;
    if (isFound === null) return { key, label, state: "not_evaluated", stateLabel: "Not evaluated", detail: "This evidence was not recorded for this audit." };
    return isFound ? { key, label, state: "found", stateLabel: "Found", detail: found } : { key, label, state: "missing", stateLabel: "Not found", detail: missing };
  };
  const schema = summary.schema;
  const nap = summary.nap;
  const townPages = (summary.locationPages ?? []).filter((page) => !page.hub);
  const indexPages = (summary.locationPages ?? []).filter((page) => page.hub);
  const typesSeen = (summary.schemaTypesSeen ?? []).slice(0, 8);
  const combos = summary.serviceLocationCombos?.length ?? 0;
  const items: LocalSeoItem[] = [
    item("localbusiness_schema", "LocalBusiness structured data", "localbusiness_schema", schema ? schema.localBusinessPages > 0 : null,
      schema ? `${schema.localBusinessTypes.join(", ") || "LocalBusiness"} on ${plural(schema.localBusinessPages, "page")}${schema.localBusinessMissingFields.length ? `; missing fields: ${schema.localBusinessMissingFields.join(", ")}` : "; name, telephone and address present"}.` : null,
      typesSeen.length ? `Structured-data types seen instead: ${typesSeen.join(", ")}.` : "No structured-data types were seen on the evaluated pages."),
    item("nap_phone", "Phone number", "nap_phone", nap ? nap.phones.length > 0 || Boolean(schema?.hasTelephone) : null,
      nap ? `${plural(nap.phones.length, "phone number")} detected, on ${nap.pagesWithPhone} of ${plural(nap.pagesEvaluated, "page")}.` : null,
      nap ? `No phone number on ${plural(nap.pagesEvaluated, "evaluated page")}.` : null),
    item("nap_address", "Postal address", "nap_address", nap ? nap.addressCandidates.length > 0 || Boolean(schema?.hasAddress) : null,
      nap ? `${plural(nap.addressCandidates.length, "address", "addresses")} and ${plural(nap.postcodes.length, "postcode")} detected, on ${nap.pagesWithAddressCandidate} of ${plural(nap.pagesEvaluated, "page")}.` : null,
      nap ? `No address text, address element or structured-data address on ${plural(nap.pagesEvaluated, "evaluated page")}.` : null),
    item("location_pages", "Location pages", "location_pages", summary.locationPages ? townPages.length > 0 : null,
      `${plural(townPages.length, "location page")}${indexPages.length ? ` and ${plural(indexPages.length, "area index page")}` : ""}.`,
      indexPages.length ? `Only ${plural(indexPages.length, "area index page")}; no page for a single location.` : "No page for a single location among the evaluated pages."),
    item("service_area_evidence", "Service-area evidence", "service_area_evidence", schema || nap ? (schema?.areaServed.length ?? 0) > 0 || (nap?.localities.length ?? 0) > 0 || combos > 0 || townPages.length > 0 : null,
      `${plural(nap?.localities.length ?? 0, "locality", "localities")} named on the website; ${plural(combos, "service-and-location combination")}; areaServed in structured data: ${schema?.areaServed.length ? schema.areaServed.slice(0, 6).join(", ") : "none"}.`,
      "No named localities, location pages or areaServed structured data."),
  ];
  return { items, localities: contentEvaluated ? (nap?.localities ?? []).map((locality) => locality.value).slice(0, 30) : [] };
}

function buildStructure(run: WebsiteAuditRun, summary: Partial<SiteSummary>, pages: ReportPageRow[], blocked: boolean): AuditReportModel["structure"] {
  const evaluated = pages.filter(isHtmlSuccess);
  const roles = ROLE_ORDER.map((role) => ({ role, label: ROLE_LABELS[role], count: evaluated.filter((page) => page.page_role === role).length }));
  const scope = summary.crawlScope;
  const challenged = pages.filter(isChallengePage).length;
  const scopeSentence = blocked
    ? "The audit stopped at the homepage, so the website's pages were not evaluated."
    : !scope
      ? "Crawl scope was not recorded for this audit."
      : scope.frontierRemaining > 0
        ? `The crawl stopped at its ${scope.pageCap}-page limit with ${plural(scope.frontierRemaining, "discovered page")} not evaluated. This report does not cover the whole website.`
        : `Every page the crawler discovered was evaluated (limit: ${scope.pageCap} pages).`;
  const sitemapLabel = blocked ? "Not evaluated" : typeof summary.sitemapReachable !== "boolean" ? "Not recorded" : summary.sitemapReachable ? `Found, ${plural(summary.sitemapUrlsSameSite ?? 0, "URL")} listed` : "Not found";
  return { roles, pagesEvaluated: evaluated.length, pagesAttempted: run.pages_attempted, pagesNotLoaded: Math.max(0, pages.length - evaluated.length - challenged), pageCap: scope?.pageCap ?? null, sitemapLabel, scopeSentence };
}

function buildPerformance(observations: WebsitePerformanceObservation[]): AuditReportModel["performance"] {
  const homepage = observations.filter((observation) => observation.page_role === "homepage");
  const strategies = (["mobile", "desktop"] as const).map((strategy): ReportStrategy => {
    const label = strategy === "mobile" ? "Mobile" : "Desktop";
    const rows = homepage.filter((observation) => observation.strategy === strategy);
    const measured = rows.find((observation) => observation.status === "succeeded");
    if (measured) return { strategy, label, status: "measured", score: measured.performance_score, metrics: labMetrics(measured), note: null };
    const failed = rows.find((observation) => observation.status === "failed");
    if (failed) return { strategy, label, status: "failed", score: null, metrics: [], note: `Not measured: the performance provider could not analyse this page (${failed.error_code ?? "unknown error"}).` };
    if (rows.length > 0) return { strategy, label, status: "pending", score: null, metrics: [], note: "Measurement has not finished yet." };
    return { strategy, label, status: "not_collected", score: null, metrics: [], note: "Not measured for this audit." };
  });
  const succeeded = homepage.filter((observation) => observation.status === "succeeded");
  // The score reads mobile field data; show that observation when it has any, otherwise whichever measurement returned field data.
  const withField = succeeded.find((observation) => observation.strategy === "mobile" && observation.field_data_available) ?? succeeded.find((observation) => observation.field_data_available) ?? null;
  const provider = succeeded[0] ?? homepage[0] ?? null;
  return {
    strategies,
    providerLabel: provider ? `${provider.provider === "pagespeed" ? "Google PageSpeed Insights" : provider.provider}${provider.provider_version ? ` (Lighthouse ${provider.provider_version})` : ""}${succeeded[0]?.observed_at ? `, measured ${formatReportDate(succeeded[0].observed_at, true)}` : ""}` : null,
    field: { metrics: withField ? fieldMetrics(withField) : [], scopeLabel: withField ? (withField.field_scope === "origin" ? "Whole-site (origin) data" : "Data for this URL") : null, sentence: withField ? null : succeeded.length > 0 ? STATE_TEXT.fieldUnavailable : null },
  };
}

function buildBreakdown(breakdown: ScoreBreakdown | null): ReportBreakdownCategory[] {
  if (!breakdown) return [];
  return CATEGORY_ORDER.flatMap((key) => {
    const category = breakdown.categories[key];
    if (!category) return [];
    return [{
      key,
      label: CATEGORY_LABELS[key],
      scoreLabel: category.score === null ? "Not evaluated" : `${formatPoints(category.score)} / ${category.weight}`,
      evaluatedLabel: `${formatPoints(category.evaluatedMax)} of ${formatPoints(category.nominalMax)} points evaluated`,
      rules: orderedRules(key, category).map(([code, rule]) => ({ code, label: ruleText(code).label, status: rule.status, statusLabel: STATUS_LABELS[rule.status] ?? String(rule.status), pointsLabel: rule.status === "not_evaluated" ? `– / ${formatPoints(rule.max)}` : `${formatPoints(rule.points)} / ${formatPoints(rule.max)}`, evidence: ruleEvidence(rule) })),
    }];
  });
}

function historicalNotice(run: WebsiteAuditRun, score: WebsiteAuditScore | null): AuditReportModel["historicalNotice"] {
  // Derived from the stored version fields alone. No run is special-cased, and an older run is never relabelled or rescored.
  const pairs: [string, string | null, string][] = [["Crawler", run.crawler_version, AUDIT_CRAWLER_VERSION], ["Rules", run.rules_version, AUDIT_RULES_VERSION], ["Scoring", score?.scoring_version ?? null, AUDIT_SCORE_VERSION]];
  const older = pairs.filter(([, stored, current]) => { const a = versionGeneration(stored); const b = versionGeneration(current); return a !== null && b !== null && a < b; });
  return older.length === 0 ? null : { text: STATE_TEXT.historical, versions: older.map(([name, stored, current]) => `${name}: ${stored} (current: ${current})`) };
}

export function buildAuditReport(data: AuditReportData): AuditReportModel {
  const { run, score } = data;
  const summary = (run.site_summary_json ?? {}) as Partial<SiteSummary>;
  const breakdown = readBreakdown(score);
  const isBlocked = run.status === "blocked";
  const state: ReportState = isBlocked ? "blocked" : !score ? "unscored" : score.score_status === "complete" ? "complete" : score.score_status === "provisional" ? "provisional" : "insufficient";
  const categories = buildCategories(score, breakdown, isBlocked);

  // A number is shown only when the stored status allows it, and a provisional number always carries the word.
  const overallValue = (state === "complete" || state === "provisional") && score?.overall_score !== null && score?.overall_score !== undefined ? score.overall_score : null;
  const overallLabel = state === "unscored" ? "Score pending" : overallValue === null ? "Not scored" : `${formatPoints(overallValue)} / 100${state === "provisional" ? " (provisional)" : ""}`;
  const statusLabel = { complete: "Complete", provisional: "Provisional", insufficient: "Insufficient evidence", unscored: "Score pending", blocked: STATE_TEXT.blockedHeadline }[state];
  const percent = score ? score.evidence_coverage : null;
  const withheld = categories.filter((category) => !category.evaluated);
  const notEvaluatedRules = breakdown ? CATEGORY_ORDER.reduce((total, key) => total + Object.values(breakdown.categories[key]?.rules ?? {}).filter((rule) => rule.status === "not_evaluated").length, 0) : 0;
  const coverageDetails = [
    ...withheld.map((category) => `${category.label}: ${category.summary.replace(/^Not evaluated: /, "").replace(/\.$/, "")}.`),
    ...(notEvaluatedRules > 0 && withheld.length === 0 ? [`${plural(notEvaluatedRules, "check")} could not be evaluated and ${notEvaluatedRules === 1 ? "is" : "are"} excluded from the score; see the score breakdown.`] : []),
  ];

  const challenge = isBlocked ? readChallengeEvidence(summary.challenge) : null;
  const findings = isBlocked ? [] : buildFindings(data.findings);
  const excluded = (summary.challengePages ?? []).map((page) => page.path);
  const suspected = data.findings.filter((finding) => finding.code === "challenge_page_suspected").length;
  const crawlNotes = isBlocked ? [] : [
    ...(excluded.length > 0 ? [`${plural(excluded.length, "page")} answered with a browser-verification page and ${excluded.length === 1 ? "was" : "were"} not evaluated: ${excluded.slice(0, 5).join(", ")}${excluded.length > 5 ? ` and ${excluded.length - 5} more` : ""}.`] : []),
    ...(suspected > 0 ? [`${plural(suspected, "page")} showed some signs of a browser-verification page and ${suspected === 1 ? "was" : "were"} evaluated normally.`] : []),
    ...(summary.renderedContentEvaluated === false ? [`${notEvaluatedReasonText("client_rendered_content_not_evaluated")}, so content-based checks were not evaluated.`] : []),
  ];

  return {
    state,
    header: {
      businessName: data.prospect?.display_name ?? run.canonical_domain,
      domain: run.canonical_domain,
      websiteUrl: run.website_url,
      auditDateLabel: formatReportDate(run.completed_at ?? run.blocked_at ?? run.started_at ?? run.created_at),
      overallLabel,
      overallValue,
      statusLabel,
      tone: state === "complete" ? "good" : state === "unscored" ? "neutral" : "warn",
      coverageLabel: percent === null ? "Not calculated" : `${formatPoints(percent)}%`,
      versions: { crawler: run.crawler_version, rules: run.rules_version, scoring: score?.scoring_version ?? null },
      runId: run.id,
      prospectId: run.prospect_id,
    },
    coverage: { percent, sentence: state === "blocked" ? STATE_TEXT.insufficient : STATE_TEXT[state], details: coverageDetails },
    historicalNotice: historicalNotice(run, score),
    blocked: isBlocked ? {
      headline: STATE_TEXT.blockedHeadline,
      text: STATE_TEXT.blocked,
      detail: STATE_TEXT.blockedDetail,
      kindLabel: challenge?.kind ? CHALLENGE_KIND_TEXT[challenge.kind] ?? "Challenge page" : "Challenge page",
      url: challenge?.url || run.website_url,
      pageTitle: challenge?.title ?? null,
      httpStatusLabel: challenge?.httpStatus ? `HTTP ${challenge.httpStatus}` : "HTTP status not recorded",
      signals: challenge?.signals ?? [],
      detectedAtLabel: formatReportDate(challenge?.detectedAt || run.blocked_at, true),
    } : null,
    categories,
    contentEvaluated: !isBlocked,
    keyFindings: findings.slice(0, 6),
    findingGroups: CATEGORY_ORDER.map((key) => ({ key, label: CATEGORY_LABELS[key], findings: findings.filter((finding) => finding.category === key) })).filter((group) => group.findings.length > 0),
    findingCount: findings.length,
    crawlNotes,
    strengths: buildStrengths(breakdown),
    localSeo: buildLocalSeo(summary, breakdown, !isBlocked),
    structure: buildStructure(run, summary, data.pages, isBlocked),
    performance: buildPerformance(data.observations),
    breakdown: buildBreakdown(breakdown),
  };
}
