// audit-score/v2: documented weights, rule maxima, thresholds and evidence-sufficiency constants (RL-070, RL-071).
// Catalogue and rationale: docs/AUDIT_SCORE.md. Changing anything here requires a new AUDIT_SCORE_VERSION; stored scores are
// never recalculated, so a published number always matches the formula named on its row.
// Deterministic only: no LLM, no finding titles or prose, no subjective judgements (ai/rules/no-llm-in-crawler.md).

// v2 (RL-067) changes no weight, maximum, threshold or sufficiency constant. It adds two evidence-handling rules: a blocked run's
// crawl-derived rules are not evaluated, and challenge documents leave `pages_fetch_success`. Any run without challenge evidence
// scores exactly as under v1 (tests/audit/score-golden.test.ts). Stored audit-score/v1 rows are never rewritten or recalculated.
export const AUDIT_SCORE_VERSION = "audit-score/v2";

export type ScoreCategoryKey = "technical" | "local_seo" | "content_structure" | "performance" | "crawl";

/** Category weights, out of 100. */
export const CATEGORY_WEIGHTS: Record<ScoreCategoryKey, number> = {
  technical: 25,
  local_seo: 25,
  content_structure: 20,
  performance: 20,
  crawl: 10,
};

export const CATEGORY_ORDER: ScoreCategoryKey[] = ["technical", "local_seo", "content_structure", "performance", "crawl"];

/** Rule maxima in points. Within each category they sum to the category weight (asserted by tests). */
export const RULE_POINTS = {
  crawl: {
    homepage_reachable: 2,
    homepage_indexable: 4,
    robots_allows_crawling: 2,
    pages_indexable: 1,
    pages_fetch_success: 1,
  },
  technical: {
    https: 4,
    sitemap: 2,
    robots_txt: 1,
    title_coverage: 4,
    title_length: 1,
    meta_description_coverage: 3,
    meta_description_length: 1,
    canonical_coverage: 3,
    viewport_coverage: 2,
    h1_coverage: 3,
    structured_data: 1,
  },
  local_seo: {
    localbusiness_schema: 5,
    localbusiness_name: 1,
    localbusiness_telephone: 1,
    localbusiness_address: 2,
    nap_phone: 4,
    nap_address: 4,
    location_pages: 5,
    service_area_evidence: 3,
  },
  content_structure: {
    service_pages: 4,
    contact_page: 2,
    homepage_links_key_pages: 3,
    unique_titles: 3,
    unique_meta_descriptions: 2,
    non_thin_pages: 3,
    no_broken_internal_links: 2,
    no_internal_redirects: 1,
  },
  performance: {
    lighthouse_performance_mobile: 6,
    lighthouse_performance_desktop: 3,
    lcp_mobile_lab: 3,
    cls_mobile_lab: 2,
    tbt_mobile_lab: 2,
    field_lcp: 2,
    field_inp: 1,
    field_cls: 1,
  },
} as const satisfies Record<ScoreCategoryKey, Record<string, number>>;

/** [good, needs-improvement] upper bounds. At or under the first = full points, at or under the second = half, above = none. */
export const PERFORMANCE_THRESHOLDS = {
  lcpMs: [2500, 4000],
  cls: [0.1, 0.25],
  tbtMs: [200, 600],
  inpMs: [200, 500],
} as const;

// ---- Evidence sufficiency: missing evidence never counts as failure, and never inflates a thinly measured site either ----
/** A category is scored only when at least this share of its nominal points was evaluated; otherwise it is null and contributes nothing. */
export const CATEGORY_MIN_COVERAGE = 0.5;
/** Overall evidence coverage at or above this share, and every category scored (none null): score_status = complete. */
export const COMPLETE_MIN_COVERAGE = 0.7;
/** At or above this share but short of complete (coverage under COMPLETE, or any category null): provisional, internal only. Below it: insufficient_evidence and no overall score. */
export const PROVISIONAL_MIN_COVERAGE = 0.4;

/** Runs finalised before `site_summary_json.crawlScope` existed: the crawl is assumed capped at this many attempted pages (the documented AUDIT_MAX_PAGES default). */
export const LEGACY_ASSUMED_PAGE_CAP = 15;
