import { renderingModeOf, type SiteSummary } from "@/audit/findings";
import { AUDIT_SCORE_VERSION, CATEGORY_MIN_COVERAGE, CATEGORY_ORDER, CATEGORY_WEIGHTS, COMPLETE_MIN_COVERAGE, LEGACY_ASSUMED_PAGE_CAP, PERFORMANCE_THRESHOLDS, PROVISIONAL_MIN_COVERAGE, RULE_POINTS, type ScoreCategoryKey } from "@/audit/score/rules";
import { LOCAL_BUSINESS_TYPE } from "@/audit/schema-types";
import { buildLinkGraph, evidenceVersionOf, homepageLinksTo, isChallengePage, isHtmlSuccess, readEvidenceV3 } from "@/audit/site-evidence";
import { META_DESCRIPTION_MAX_CHARS, META_DESCRIPTION_MIN_CHARS, THIN_PAGE_MIN_WORDS, TITLE_MAX_CHARS, TITLE_MIN_CHARS } from "@/audit/thresholds";
import { isLocationHubPath } from "@/audit/url";
import type { AuditScoreStatus, WebsiteAuditPage, WebsiteAuditRun, WebsitePerformanceObservation } from "@/db/types";

// Pure, deterministic audit score (audit-score/v2; identical to v1 for every run without challenge evidence, see docs/AUDIT_SCORE.md §6). Input: stored rows only (run summary, page rows, performance observations).
// Output: a breakdown in which every point is tied to a measured value. Never reads finding titles, severities or prose.
// All arithmetic is in integer hundredths of a point ("centi") so category totals reconcile exactly with the overall score.
// A rule the system could not measure is `not_evaluated` and leaves the denominator; it is never scored as a failure.
// v2 (RL-067): on a blocked run (`site_summary_json.crawlBlocked`) every crawl-derived rule is `not_evaluated (crawl_blocked)`,
// a secondary page that was a challenge document is left out of `pages_fetch_success`, and while such a page exists the absence of
// a page type is not a measured fact. Performance is evaluated as before.

export type RuleStatus = "pass" | "partial" | "fail" | "not_evaluated";

export type RuleResult = {
  status: RuleStatus;
  points: number;
  max: number;
  /** Measured values the points derive from, or the reason the rule was not evaluated. Never prose. */
  evidence: Record<string, unknown>;
};

export type CategoryBreakdown = {
  weight: number;
  /** Sum of rule maxima, equal to the weight. */
  nominalMax: number;
  /** Sum of maxima of the rules that were evaluated. */
  evaluatedMax: number;
  /** Sum of rule points. */
  earned: number;
  /** evaluatedMax / nominalMax, 0-1 rounded to 4 places. */
  coverage: number;
  /** weight × earned / evaluatedMax, or null when the category has too little evidence to be scored. */
  score: number | null;
  suppressed: "insufficient_category_evidence" | null;
  rules: Record<string, RuleResult>;
};

export type ScoreBreakdown = {
  scoringVersion: string;
  constants: { categoryMinCoverage: number; completeMinCoverage: number; provisionalMinCoverage: number };
  inputs: { crawlerVersion: string; rulesVersion: string; evidenceVersion: number; pagesStored: number; htmlPagesScored: number; renderedContentEvaluated: boolean; crawlCapped: boolean; crawlCapInferred: boolean; /** v2 */ crawlBlocked: boolean; /** v2 */ challengePagesExcluded: number; observationIds: string[] };
  categories: Record<ScoreCategoryKey, CategoryBreakdown>;
};

export type AuditScoreResult = {
  scoringVersion: string;
  status: AuditScoreStatus;
  overallScore: number | null;
  categoryScores: Record<ScoreCategoryKey, number | null>;
  evaluatedWeight: number;
  evidenceCoverage: number;
  breakdown: ScoreBreakdown;
};

export type AuditScoreInput = {
  run: Pick<WebsiteAuditRun, "crawler_version" | "rules_version" | "pages_attempted" | "site_summary_json">;
  pages: WebsiteAuditPage[];
  observations: WebsitePerformanceObservation[];
};

type Centi = number;
type RuleCenti = { status: RuleStatus; centi: Centi; maxCenti: Centi; evidence: Record<string, unknown> };

const toCenti = (points: number): Centi => Math.round(points * 100);
const fromCenti = (centi: Centi): number => centi / 100;

function notEvaluated(max: number, reason: string, extra: Record<string, unknown> = {}): RuleCenti {
  return { status: "not_evaluated", centi: 0, maxCenti: toCenti(max), evidence: { reason, ...extra } };
}

function statusOf(centi: Centi, maxCenti: Centi): RuleStatus {
  if (centi >= maxCenti) return "pass";
  return centi <= 0 ? "fail" : "partial";
}

function binary(max: number, passed: boolean, evidence: Record<string, unknown>): RuleCenti {
  const maxCenti = toCenti(max);
  return { status: passed ? "pass" : "fail", centi: passed ? maxCenti : 0, maxCenti, evidence };
}

/** Proportional rule: points = max × passing / eligible. Not evaluated when nothing was eligible. */
function ratio(max: number, passing: number, eligible: number, evidence: Record<string, unknown> = {}): RuleCenti {
  if (eligible <= 0) return notEvaluated(max, "no_eligible_pages");
  const maxCenti = toCenti(max);
  const centi = Math.round((maxCenti * passing) / eligible);
  return { status: statusOf(centi, maxCenti), centi, maxCenti, evidence: { passing, eligible, ...evidence } };
}

/** Banded rule: at or under `good` = full points, at or under `needsImprovement` = half, above = none. */
function banded(max: number, value: number, thresholds: readonly [number, number], evidence: Record<string, unknown>): RuleCenti {
  const maxCenti = toCenti(max);
  const centi = value <= thresholds[0] ? maxCenti : value <= thresholds[1] ? Math.round(maxCenti / 2) : 0;
  return { status: statusOf(centi, maxCenti), centi, maxCenti, evidence: { ...evidence, thresholds: [...thresholds] } };
}

function linear(max: number, score: number, evidence: Record<string, unknown>): RuleCenti {
  const maxCenti = toCenti(max);
  const centi = Math.round((maxCenti * Math.min(Math.max(score, 0), 100)) / 100);
  return { status: statusOf(centi, maxCenti), centi, maxCenti, evidence };
}

/**
 * A location index page (`/areas-we-cover`, `/locations`), judged on the last path segment only. `isLocationHubPath` matches the hub
 * segment anywhere in the path, which would also discard `/areas/uxbridge`; for scoring, a town page under a hub is a location page.
 */
function isLocationIndexPage(path: string | null): boolean {
  const leaf = (path ?? "").split("/").filter(Boolean).at(-1);
  return leaf !== undefined && isLocationHubPath(`/${leaf}`);
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * score_status from overall evidence coverage and whether every category was scored. `coverageCenti` is coverage in integer hundredths
 * of a percentage point (70% = 7000), so a boundary value such as exactly 70% or 39.99% is never lost to floating point.
 * Complete needs both enough coverage and a score for every category: a withheld category (say, PageSpeed failed outright) means the
 * overall number is rescaled over the remaining weight, which is never publishable. A category that is scored on partial evidence
 * (lab metrics without CrUX field data) does not hold the status back.
 */
export function scoreStatusOf(coverageCenti: number, everyCategoryScored: boolean): AuditScoreStatus {
  if (coverageCenti < Math.round(PROVISIONAL_MIN_COVERAGE * 10_000)) return "insufficient_evidence";
  return coverageCenti >= Math.round(COMPLETE_MIN_COVERAGE * 10_000) && everyCategoryScored ? "complete" : "provisional";
}

export function calculateAuditScore(input: AuditScoreInput): AuditScoreResult {
  const summary = (input.run.site_summary_json ?? {}) as Partial<SiteSummary>;
  const pages = input.pages;
  // Blocked run: the homepage response was a challenge document, so nothing in the summary or the page rows describes the website.
  const crawlBlocked = summary.crawlBlocked === true;
  const challengePagesExcluded = pages.filter(isChallengePage).length;
  // Challenge documents are not fetch failures of the website and not successes either: they leave both sides of the ratio.
  const attemptedPages = pages.filter((page) => !isChallengePage(page));
  const html = pages.filter(isHtmlSuccess);
  const homepage = html.find((page) => page.page_role === "homepage") ?? null;
  const evidenceVersion = typeof summary.evidenceVersion === "number" ? summary.evidenceVersion : 0;
  const v3 = evidenceVersion >= 3 && html.some((page) => evidenceVersionOf(page) >= 3);
  const v3Pages = html.filter((page) => evidenceVersionOf(page) >= 3);
  // Same definition as the findings engine: an app-shell homepage means content-dependent facts were never observable.
  const siteContentEvaluated = summary.renderedContentEvaluated !== false && (homepage ? renderingModeOf(homepage) !== "client_rendered_likely" : true);
  const contentPages = html.filter((page) => renderingModeOf(page) !== "client_rendered_likely");

  const scope = summary.crawlScope;
  const crawlCapInferred = !scope;
  const crawlCapped = scope ? scope.frontierRemaining > 0 : input.run.pages_attempted >= LEGACY_ASSUMED_PAGE_CAP;

  /** Absence of a page type is only a measured fact when the crawl ran out of URLs before it ran out of page budget. */
  const presence = (max: number, present: boolean, evidence: Record<string, unknown>): RuleCenti => {
    if (present) return binary(max, true, evidence);
    // v2: a page that answered with a challenge document may be the missing page type, so its absence was not measured.
    if (challengePagesExcluded > 0) return notEvaluated(max, "challenge_pages_not_evaluated", { ...evidence, challengePagesExcluded });
    if (crawlCapped) return notEvaluated(max, "crawl_capped", { ...evidence, pagesAttempted: input.run.pages_attempted, crawlCapInferred });
    return binary(max, false, evidence);
  };

  // ---- Crawl / indexability ----
  const P_CRAWL = RULE_POINTS.crawl;
  const otherHtml = html.filter((page) => page !== homepage);
  const crawl: Record<string, RuleCenti> = {
    homepage_reachable: typeof summary.homepageStatus === "number" ? binary(P_CRAWL.homepage_reachable, summary.homepageStatus >= 200 && summary.homepageStatus < 300, { homepageStatus: summary.homepageStatus }) : notEvaluated(P_CRAWL.homepage_reachable, "homepage_status_not_recorded"),
    homepage_indexable: homepage ? binary(P_CRAWL.homepage_indexable, !homepage.noindex, { noindex: homepage.noindex, metaRobots: homepage.meta_robots }) : notEvaluated(P_CRAWL.homepage_indexable, "homepage_row_missing"),
    robots_allows_crawling: typeof summary.robotsDisallowAll === "boolean" ? binary(P_CRAWL.robots_allows_crawling, !summary.robotsDisallowAll, { robotsDisallowAll: summary.robotsDisallowAll, robotsTxtReachable: summary.robotsTxtReachable ?? null }) : notEvaluated(P_CRAWL.robots_allows_crawling, "robots_not_recorded"),
    pages_indexable: ratio(P_CRAWL.pages_indexable, otherHtml.filter((page) => !page.noindex).length, otherHtml.length),
    pages_fetch_success: ratio(P_CRAWL.pages_fetch_success, attemptedPages.filter((page) => page.fetch_ok && (page.http_status === null || page.http_status < 500)).length, attemptedPages.length),
  };

  // ---- Technical SEO ----
  const P_TECH = RULE_POINTS.technical;
  const titled = v3Pages.filter((page) => Boolean(page.title));
  const described = v3Pages.filter((page) => Boolean(page.meta_description));
  const titleLengthOf = (page: WebsiteAuditPage) => readEvidenceV3(page)?.titleLength ?? page.title?.length ?? 0;
  const metaLengthOf = (page: WebsiteAuditPage) => readEvidenceV3(page)?.metaDescriptionLength ?? page.meta_description?.length ?? 0;
  const technical: Record<string, RuleCenti> = {
    https: typeof summary.homepageHttps === "boolean" ? binary(P_TECH.https, summary.homepageHttps, { homepageFinalUrl: summary.homepageFinalUrl ?? null }) : notEvaluated(P_TECH.https, "https_not_recorded"),
    sitemap: typeof summary.sitemapReachable === "boolean" ? binary(P_TECH.sitemap, summary.sitemapReachable, { sitemapReachable: summary.sitemapReachable, sitemapUrlsSameSite: summary.sitemapUrlsSameSite ?? null }) : notEvaluated(P_TECH.sitemap, "sitemap_not_recorded"),
    robots_txt: typeof summary.robotsTxtReachable === "boolean" ? binary(P_TECH.robots_txt, summary.robotsTxtReachable, { robotsTxtReachable: summary.robotsTxtReachable }) : notEvaluated(P_TECH.robots_txt, "robots_not_recorded"),
    title_coverage: ratio(P_TECH.title_coverage, html.filter((page) => Boolean(page.title)).length, html.length),
    title_length: v3 ? ratio(P_TECH.title_length, titled.filter((page) => titleLengthOf(page) >= TITLE_MIN_CHARS && titleLengthOf(page) <= TITLE_MAX_CHARS).length, titled.length, { minChars: TITLE_MIN_CHARS, maxChars: TITLE_MAX_CHARS }) : notEvaluated(P_TECH.title_length, "requires_evidence_v3"),
    meta_description_coverage: ratio(P_TECH.meta_description_coverage, html.filter((page) => Boolean(page.meta_description)).length, html.length),
    meta_description_length: v3 ? ratio(P_TECH.meta_description_length, described.filter((page) => metaLengthOf(page) >= META_DESCRIPTION_MIN_CHARS && metaLengthOf(page) <= META_DESCRIPTION_MAX_CHARS).length, described.length, { minChars: META_DESCRIPTION_MIN_CHARS, maxChars: META_DESCRIPTION_MAX_CHARS }) : notEvaluated(P_TECH.meta_description_length, "requires_evidence_v3"),
    canonical_coverage: ratio(P_TECH.canonical_coverage, html.filter((page) => Boolean(page.canonical_url)).length, html.length),
    viewport_coverage: ratio(P_TECH.viewport_coverage, html.filter((page) => page.has_viewport).length, html.length),
    h1_coverage: contentPages.length > 0 ? ratio(P_TECH.h1_coverage, contentPages.filter((page) => page.h1_count === 1 && (readEvidenceV3(page)?.h1EmptyCount ?? 0) === 0).length, contentPages.length) : notEvaluated(P_TECH.h1_coverage, html.length > 0 ? "client_rendered_content_not_evaluated" : "no_eligible_pages"),
    structured_data: contentPages.length > 0 ? ratio(P_TECH.structured_data, contentPages.filter((page) => page.json_ld_count > 0 || page.has_structured_data).length, contentPages.length) : notEvaluated(P_TECH.structured_data, html.length > 0 ? "client_rendered_content_not_evaluated" : "no_eligible_pages"),
  };

  // ---- Local SEO (every rule reads rendered content) ----
  const P_LOCAL = RULE_POINTS.local_seo;
  const localRule = (max: number, needsV3: boolean, evaluate: () => RuleCenti): RuleCenti => {
    if (!siteContentEvaluated) return notEvaluated(max, "client_rendered_content_not_evaluated");
    if (html.length === 0) return notEvaluated(max, "no_eligible_pages");
    if (needsV3 && !v3) return notEvaluated(max, "requires_evidence_v3");
    return evaluate();
  };
  const schema = summary.schema;
  const nap = summary.nap;
  const hasLocalBusiness = html.some((page) => page.schema_types.some((type) => LOCAL_BUSINESS_TYPE.test(type)));
  const locationRows = html.filter((page) => page.page_role === "location");
  const townPages = locationRows.filter((page) => !isLocationIndexPage(page.path));
  const schemaField = (max: number, key: "hasName" | "hasTelephone" | "hasAddress") => localRule(max, true, () => (schema ? binary(max, hasLocalBusiness && schema[key], { localBusinessPages: schema.localBusinessPages, [key]: schema[key] }) : notEvaluated(max, "schema_summary_not_recorded")));
  const localSeo: Record<string, RuleCenti> = {
    localbusiness_schema: localRule(P_LOCAL.localbusiness_schema, false, () => binary(P_LOCAL.localbusiness_schema, hasLocalBusiness, { pagesWithLocalBusinessSchema: summary.pagesWithLocalBusinessSchema ?? null, localBusinessTypes: schema?.localBusinessTypes ?? [] })),
    localbusiness_name: schemaField(P_LOCAL.localbusiness_name, "hasName"),
    localbusiness_telephone: schemaField(P_LOCAL.localbusiness_telephone, "hasTelephone"),
    localbusiness_address: schemaField(P_LOCAL.localbusiness_address, "hasAddress"),
    nap_phone: localRule(P_LOCAL.nap_phone, true, () => (nap && nap.pagesEvaluated > 0 ? binary(P_LOCAL.nap_phone, nap.phones.length > 0 || Boolean(schema?.hasTelephone), { phonesFound: nap.phones.length, pagesWithPhone: nap.pagesWithPhone, schemaTelephone: Boolean(schema?.hasTelephone), pagesEvaluated: nap.pagesEvaluated }) : notEvaluated(P_LOCAL.nap_phone, "nap_not_evaluated"))),
    nap_address: localRule(P_LOCAL.nap_address, true, () => (nap && nap.pagesEvaluated > 0 ? binary(P_LOCAL.nap_address, nap.addressCandidates.length > 0 || Boolean(schema?.hasAddress) || nap.postcodes.some((postcode) => postcode.sources.includes("schema")), { addressCandidates: nap.addressCandidates.length, schemaAddress: Boolean(schema?.hasAddress), postcodesFound: nap.postcodes.length, pagesEvaluated: nap.pagesEvaluated }) : notEvaluated(P_LOCAL.nap_address, "nap_not_evaluated"))),
    location_pages: localRule(P_LOCAL.location_pages, true, () => presence(P_LOCAL.location_pages, townPages.length > 0, { locationPages: townPages.length, locationIndexPages: locationRows.length - townPages.length })),
    service_area_evidence: localRule(P_LOCAL.service_area_evidence, true, () => {
      const areaServed = schema?.areaServed.length ?? 0;
      const localities = nap?.localities.length ?? 0;
      const combos = summary.serviceLocationCombos?.length ?? 0;
      return binary(P_LOCAL.service_area_evidence, areaServed > 0 || localities > 0 || combos > 0 || townPages.length > 0, { schemaAreaServed: areaServed, localitiesObserved: localities, serviceLocationCombos: combos, locationPages: townPages.length });
    }),
  };

  // ---- Content / structure ----
  const P_CONTENT = RULE_POINTS.content_structure;
  const contentRule = (max: number, evaluate: () => RuleCenti): RuleCenti => (!siteContentEvaluated ? notEvaluated(max, "client_rendered_content_not_evaluated") : html.length === 0 ? notEvaluated(max, "no_eligible_pages") : evaluate());
  const pathOf = (page: WebsiteAuditPage) => page.path ?? page.requested_url;
  const uniqueness = (max: number, groups: { paths: string[] }[] | undefined, has: (page: WebsiteAuditPage) => boolean): RuleCenti => {
    if (!v3 || !groups) return notEvaluated(max, "requires_evidence_v3");
    const duplicated = new Set(groups.flatMap((group) => group.paths));
    const eligible = v3Pages.filter(has);
    return ratio(max, eligible.filter((page) => !duplicated.has(pathOf(page))).length, eligible.length, { duplicateGroups: groups.length });
  };
  const graph = buildLinkGraph(pages);
  const keyPages = v3Pages.filter((page) => page.page_role === "service" || (page.page_role === "location" && !isLocationIndexPage(page.path)));
  const thinEligible = v3Pages.filter((page) => renderingModeOf(page) !== "client_rendered_likely" && page.page_role !== "contact" && page.page_role !== "gallery");
  const linkedRedirects = summary.internalRedirects?.filter((redirect) => redirect.linkedFrom.length > 0);
  const contentStructure: Record<string, RuleCenti> = {
    service_pages: contentRule(P_CONTENT.service_pages, () => presence(P_CONTENT.service_pages, html.some((page) => page.page_role === "service"), { servicePages: html.filter((page) => page.page_role === "service").length })),
    contact_page: contentRule(P_CONTENT.contact_page, () => presence(P_CONTENT.contact_page, html.some((page) => page.page_role === "contact"), { contactPages: html.filter((page) => page.page_role === "contact").length })),
    homepage_links_key_pages: contentRule(P_CONTENT.homepage_links_key_pages, () => {
      if (!v3) return notEvaluated(P_CONTENT.homepage_links_key_pages, "requires_evidence_v3");
      if (!graph.homepageKeys || graph.homepageKeys.size === 0) return notEvaluated(P_CONTENT.homepage_links_key_pages, "homepage_links_not_recorded");
      if (graph.truncated) return notEvaluated(P_CONTENT.homepage_links_key_pages, "stored_links_truncated");
      return ratio(P_CONTENT.homepage_links_key_pages, keyPages.filter((page) => homepageLinksTo(graph, page) !== false).length, keyPages.length, { homepageLinkCount: graph.homepageLinkCount });
    }),
    unique_titles: uniqueness(P_CONTENT.unique_titles, summary.duplicateTitleGroups, (page) => Boolean(page.title)),
    unique_meta_descriptions: uniqueness(P_CONTENT.unique_meta_descriptions, summary.duplicateMetaGroups, (page) => Boolean(page.meta_description)),
    non_thin_pages: contentRule(P_CONTENT.non_thin_pages, () => (v3 ? ratio(P_CONTENT.non_thin_pages, thinEligible.filter((page) => page.word_count >= THIN_PAGE_MIN_WORDS).length, thinEligible.length, { minWords: THIN_PAGE_MIN_WORDS }) : notEvaluated(P_CONTENT.non_thin_pages, "requires_evidence_v3"))),
    no_broken_internal_links: typeof summary.brokenInternalLinks === "number" ? binary(P_CONTENT.no_broken_internal_links, summary.brokenInternalLinks === 0, { brokenInternalLinks: summary.brokenInternalLinks }) : notEvaluated(P_CONTENT.no_broken_internal_links, "broken_links_not_recorded"),
    no_internal_redirects: v3 && linkedRedirects ? binary(P_CONTENT.no_internal_redirects, linkedRedirects.length === 0, { linkedInternalRedirects: linkedRedirects.length }) : notEvaluated(P_CONTENT.no_internal_redirects, "requires_evidence_v3"),
  };

  // ---- Performance (stored provider observations; a failed or absent observation is not evaluated, never a zero) ----
  const P_PERF = RULE_POINTS.performance;
  const succeeded = (strategy: "mobile" | "desktop") => input.observations.find((observation) => observation.strategy === strategy && observation.status === "succeeded" && observation.page_role === "homepage") ?? null;
  const mobile = succeeded("mobile");
  const desktop = succeeded("desktop");
  const missingReason = (strategy: "mobile" | "desktop") => (input.observations.some((observation) => observation.strategy === strategy && observation.status === "failed") ? `${strategy}_observation_failed` : `${strategy}_observation_not_collected`);
  const lab = (max: number, value: number | null, key: string, thresholds: readonly [number, number]): RuleCenti => {
    if (!mobile) return notEvaluated(max, missingReason("mobile"));
    return value === null ? notEvaluated(max, "metric_not_returned", { observationId: mobile.id }) : banded(max, value, thresholds, { [key]: value, observationId: mobile.id });
  };
  const field = (max: number, value: number | null, key: string, thresholds: readonly [number, number]): RuleCenti => {
    if (!mobile) return notEvaluated(max, missingReason("mobile"));
    if (!mobile.field_data_available || value === null) return notEvaluated(max, "field_data_unavailable", { observationId: mobile.id });
    return banded(max, value, thresholds, { [key]: value, fieldScope: mobile.field_scope, observationId: mobile.id });
  };
  const lighthouse = (max: number, observation: WebsitePerformanceObservation | null, strategy: "mobile" | "desktop"): RuleCenti => {
    if (!observation) return notEvaluated(max, missingReason(strategy));
    return observation.performance_score === null ? notEvaluated(max, "metric_not_returned", { observationId: observation.id }) : linear(max, observation.performance_score, { performanceScore: observation.performance_score, observationId: observation.id });
  };
  const performance: Record<string, RuleCenti> = {
    lighthouse_performance_mobile: lighthouse(P_PERF.lighthouse_performance_mobile, mobile, "mobile"),
    lighthouse_performance_desktop: lighthouse(P_PERF.lighthouse_performance_desktop, desktop, "desktop"),
    lcp_mobile_lab: lab(P_PERF.lcp_mobile_lab, numberOf(mobile?.lcp_ms), "lcpMs", PERFORMANCE_THRESHOLDS.lcpMs),
    cls_mobile_lab: lab(P_PERF.cls_mobile_lab, numberOf(mobile?.cls), "cls", PERFORMANCE_THRESHOLDS.cls),
    tbt_mobile_lab: lab(P_PERF.tbt_mobile_lab, numberOf(mobile?.tbt_ms), "tbtMs", PERFORMANCE_THRESHOLDS.tbtMs),
    field_lcp: field(P_PERF.field_lcp, numberOf(mobile?.field_lcp_ms), "fieldLcpMs", PERFORMANCE_THRESHOLDS.lcpMs),
    field_inp: field(P_PERF.field_inp, numberOf(mobile?.field_inp_ms), "fieldInpMs", PERFORMANCE_THRESHOLDS.inpMs),
    field_cls: field(P_PERF.field_cls, numberOf(mobile?.field_cls), "fieldCls", PERFORMANCE_THRESHOLDS.cls),
  };

  /** Missing crawl evidence stays missing: every rule keeps its maximum and leaves the denominator. No zero, no penalty. */
  const crawlDerived = (rules: Record<string, RuleCenti>): Record<string, RuleCenti> => (crawlBlocked ? Object.fromEntries(Object.entries(rules).map(([code, rule]) => [code, notEvaluated(fromCenti(rule.maxCenti), "crawl_blocked")])) : rules);
  const ruleSets: Record<ScoreCategoryKey, Record<string, RuleCenti>> = { technical: crawlDerived(technical), local_seo: crawlDerived(localSeo), content_structure: crawlDerived(contentStructure), performance, crawl: crawlDerived(crawl) };

  // ---- Totals ----
  const categories = {} as Record<ScoreCategoryKey, CategoryBreakdown>;
  const categoryScores = {} as Record<ScoreCategoryKey, number | null>;
  let overallEarnedCenti = 0;
  let evaluatedWeightCenti = 0;
  let contributingEvaluatedCenti = 0;
  for (const key of CATEGORY_ORDER) {
    const rules = ruleSets[key];
    const weightCenti = toCenti(CATEGORY_WEIGHTS[key]);
    let nominalCenti = 0;
    let evaluatedCenti = 0;
    let earnedCenti = 0;
    const out: Record<string, RuleResult> = {};
    for (const [code, rule] of Object.entries(rules)) {
      nominalCenti += rule.maxCenti;
      if (rule.status !== "not_evaluated") {
        evaluatedCenti += rule.maxCenti;
        earnedCenti += rule.centi;
      }
      out[code] = { status: rule.status, points: fromCenti(rule.centi), max: fromCenti(rule.maxCenti), evidence: rule.evidence };
    }
    const coverage = nominalCenti > 0 ? evaluatedCenti / nominalCenti : 0;
    const scored = evaluatedCenti > 0 && evaluatedCenti >= Math.round(nominalCenti * CATEGORY_MIN_COVERAGE);
    const scoreCenti = scored ? Math.round((weightCenti * earnedCenti) / evaluatedCenti) : null;
    if (scoreCenti !== null) {
      overallEarnedCenti += scoreCenti;
      evaluatedWeightCenti += weightCenti;
      contributingEvaluatedCenti += evaluatedCenti;
    }
    categories[key] = { weight: CATEGORY_WEIGHTS[key], nominalMax: fromCenti(nominalCenti), evaluatedMax: fromCenti(evaluatedCenti), earned: fromCenti(earnedCenti), coverage: Math.round(coverage * 10_000) / 10_000, score: scoreCenti === null ? null : fromCenti(scoreCenti), suppressed: scored ? null : "insufficient_category_evidence", rules: out };
    categoryScores[key] = categories[key].score;
  }

  // Coverage counts only evidence that actually contributes to the overall number. Nominal points total 100, so centi / 100 is a percentage.
  const evidenceCoverage = fromCenti(contributingEvaluatedCenti);
  const status = scoreStatusOf(contributingEvaluatedCenti, CATEGORY_ORDER.every((key) => categoryScores[key] !== null));
  const overallCenti = status === "insufficient_evidence" || evaluatedWeightCenti === 0 ? null : Math.round((overallEarnedCenti * 10_000) / evaluatedWeightCenti);

  return {
    scoringVersion: AUDIT_SCORE_VERSION,
    status,
    overallScore: overallCenti === null ? null : fromCenti(overallCenti),
    categoryScores,
    evaluatedWeight: fromCenti(evaluatedWeightCenti),
    evidenceCoverage,
    breakdown: {
      scoringVersion: AUDIT_SCORE_VERSION,
      constants: { categoryMinCoverage: CATEGORY_MIN_COVERAGE, completeMinCoverage: COMPLETE_MIN_COVERAGE, provisionalMinCoverage: PROVISIONAL_MIN_COVERAGE },
      inputs: { crawlerVersion: input.run.crawler_version, rulesVersion: input.run.rules_version, evidenceVersion, pagesStored: pages.length, htmlPagesScored: html.length, renderedContentEvaluated: siteContentEvaluated, crawlCapped, crawlCapInferred, crawlBlocked, challengePagesExcluded, observationIds: input.observations.filter((observation) => observation.status === "succeeded").map((observation) => observation.id).sort() },
      categories,
    },
  };
}
