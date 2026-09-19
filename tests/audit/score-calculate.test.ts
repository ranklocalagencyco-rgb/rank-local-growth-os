import { describe, expect, it } from "vitest";

import { calculateAuditScore, scoreStatusOf, type AuditScoreInput, type AuditScoreResult } from "@/audit/score/calculate";
import { AUDIT_SCORE_VERSION, CATEGORY_MIN_COVERAGE, CATEGORY_ORDER, CATEGORY_WEIGHTS, COMPLETE_MIN_COVERAGE, PROVISIONAL_MIN_COVERAGE, RULE_POINTS } from "@/audit/score/rules";
import { categoryScoreRows, overallScoreLabel, scoreStatusLabel } from "@/domain/audit";
import type { WebsiteAuditScore } from "@/db/types";
import { clientRenderedShell, observation, page, scoreInput, shellPerformance, strongPerformance, strongTradesSite, weakPerformance, weakSite } from "./score-fixtures";

// audit-score/v1 arithmetic and policy: exact totals, denominator normalization, evidence sufficiency, old-evidence compatibility.

const cents = (value: number) => Math.round(value * 100);

/** Recomputes every total from the persisted breakdown alone, the way a reviewer (or a later job) would. */
function reconcile(result: AuditScoreResult) {
  let overallCents = 0;
  let weightCents = 0;
  let coverageCents = 0;
  for (const key of CATEGORY_ORDER) {
    const category = result.breakdown.categories[key];
    const rules = Object.values(category.rules);
    const evaluated = rules.filter((rule) => rule.status !== "not_evaluated");
    expect(cents(category.nominalMax)).toBe(rules.reduce((total, rule) => total + cents(rule.max), 0));
    expect(cents(category.evaluatedMax)).toBe(evaluated.reduce((total, rule) => total + cents(rule.max), 0));
    expect(cents(category.earned)).toBe(evaluated.reduce((total, rule) => total + cents(rule.points), 0));
    for (const rule of rules) {
      expect(rule.points).toBeGreaterThanOrEqual(0);
      expect(rule.points).toBeLessThanOrEqual(rule.max);
      if (rule.status === "not_evaluated") expect(rule.points).toBe(0);
      expect(Object.keys(rule.evidence).length).toBeGreaterThan(0);
    }
    const scored = category.evaluatedMax > 0 && category.evaluatedMax / category.nominalMax >= CATEGORY_MIN_COVERAGE;
    expect(category.score === null).toBe(!scored);
    expect(result.categoryScores[key]).toBe(category.score);
    if (category.score !== null) {
      expect(cents(category.score)).toBe(Math.round((cents(category.weight) * cents(category.earned)) / cents(category.evaluatedMax)));
      overallCents += cents(category.score);
      weightCents += cents(category.weight);
      coverageCents += cents(category.evaluatedMax);
    }
  }
  expect(cents(result.evaluatedWeight)).toBe(weightCents);
  expect(cents(result.evidenceCoverage)).toBe(coverageCents);
  if (result.overallScore !== null) expect(cents(result.overallScore)).toBe(Math.round((overallCents * 10_000) / weightCents));
  return { overallCents, weightCents };
}

describe("audit-score/v1 rule table", () => {
  it("has rule maxima that sum to each category weight, and weights that sum to 100", () => {
    for (const key of CATEGORY_ORDER) expect(Object.values(RULE_POINTS[key]).reduce((total: number, max: number) => total + max, 0)).toBe(CATEGORY_WEIGHTS[key]);
    expect(Object.values(CATEGORY_WEIGHTS).reduce((total, weight) => total + weight, 0)).toBe(100);
    expect(CATEGORY_WEIGHTS).toEqual({ technical: 25, local_seo: 25, content_structure: 20, performance: 20, crawl: 10 });
    expect([CATEGORY_MIN_COVERAGE, PROVISIONAL_MIN_COVERAGE, COMPLETE_MIN_COVERAGE]).toEqual([0.5, 0.4, 0.7]);
  });
});

describe("exact totals", () => {
  it("reconciles rule points → category scores → overall for every fixture, from the breakdown alone", () => {
    for (const input of [scoreInput(strongTradesSite(), strongPerformance(true)), scoreInput(strongTradesSite(), strongPerformance(false)), scoreInput(weakSite(), weakPerformance(), { https: false }), scoreInput(clientRenderedShell(), shellPerformance()), scoreInput(clientRenderedShell(), []), scoreInput(strongTradesSite(), [])]) reconcile(calculateAuditScore(input));
  });

  it("a fully evaluated audit is scored out of exactly 100 nominal points and the overall equals the sum of the category scores", () => {
    const result = calculateAuditScore(scoreInput(strongTradesSite(), strongPerformance(true)));
    const { overallCents, weightCents } = reconcile(result);
    expect(weightCents).toBe(10_000);
    expect(result.evidenceCoverage).toBe(100);
    expect(cents(result.overallScore!)).toBe(overallCents);
    expect(CATEGORY_ORDER.every((key) => result.breakdown.categories[key].evaluatedMax === CATEGORY_WEIGHTS[key])).toBe(true);
  });

  it("is deterministic: the same stored evidence always yields the same result", () => {
    const input = scoreInput(weakSite(), weakPerformance(), { https: false });
    expect(calculateAuditScore(input)).toEqual(calculateAuditScore(JSON.parse(JSON.stringify(input))));
  });
});

describe("missing-evidence denominator normalization", () => {
  it("marks performance not evaluated when the provider failed, and rescales the overall over the remaining weight", () => {
    const failed = [observation("mobile", { status: "failed", error_code: "quota", performance_score: null, lcp_ms: null, cls: null, tbt_ms: null }), observation("desktop", { status: "failed", error_code: "quota", performance_score: null })];
    const result = calculateAuditScore(scoreInput(strongTradesSite(), failed));
    expect(result.categoryScores.performance).toBeNull();
    expect(result.breakdown.categories.performance.rules.lighthouse_performance_mobile).toMatchObject({ status: "not_evaluated", points: 0, evidence: { reason: "mobile_observation_failed" } });
    // Still normalised over the 80 points that were measured, but a withheld category means the result is never complete.
    expect(result).toMatchObject({ status: "provisional", overallScore: 100, evaluatedWeight: 80, evidenceCoverage: 80 });
  });

  it("scores the same without any observation rows (provider switched off)", () => {
    const result = calculateAuditScore(scoreInput(strongTradesSite(), []));
    expect(result.breakdown.categories.performance.rules.lcp_mobile_lab.evidence).toEqual({ reason: "mobile_observation_not_collected" });
    expect(result).toMatchObject({ overallScore: 100, evaluatedWeight: 80 });
  });

  it("keeps mobile-only evidence when desktop failed", () => {
    const result = calculateAuditScore(scoreInput(strongTradesSite(), [observation("mobile", { performance_score: 50 }), observation("desktop", { status: "failed", error_code: "timeout", performance_score: null })]));
    expect(result.breakdown.categories.performance).toMatchObject({ evaluatedMax: 13, earned: 10, score: 15.38 });
  });

  it("does not punish absent page types when the crawl stopped at the page cap, but does when the site was fully crawled", () => {
    const pages = [page("/", {}, { links: [] }), page("/about", { page_role: "about" })];
    const capped = calculateAuditScore(scoreInput(pages, [], { frontierRemaining: 40 }));
    const exhausted = calculateAuditScore(scoreInput(pages, [], { frontierRemaining: 0 }));
    for (const [category, code] of [["local_seo", "location_pages"], ["content_structure", "service_pages"], ["content_structure", "contact_page"]] as const) {
      expect(capped.breakdown.categories[category].rules[code]).toMatchObject({ status: "not_evaluated", evidence: { reason: "crawl_capped", crawlCapInferred: false } });
      expect(exhausted.breakdown.categories[category].rules[code]).toMatchObject({ status: "fail", points: 0 });
    }
    expect(capped.breakdown.inputs).toMatchObject({ crawlCapped: true, crawlCapInferred: false });
  });

  it("infers the cap for runs finalised before crawlScope existed, and says so", () => {
    const fifteen = [page("/", {}, { links: [] }), ...Array.from({ length: 14 }, (_unused, index) => page(`/p${index}`))];
    const legacyCapped = calculateAuditScore(scoreInput(fifteen, [], { frontierRemaining: null }));
    expect(legacyCapped.breakdown.inputs).toMatchObject({ crawlCapped: true, crawlCapInferred: true });
    expect(legacyCapped.breakdown.categories.local_seo.rules.location_pages.status).toBe("not_evaluated");
    const legacySmall = calculateAuditScore(scoreInput([page("/", {}, { links: [] })], [], { frontierRemaining: null }));
    expect(legacySmall.breakdown.inputs).toMatchObject({ crawlCapped: false, crawlCapInferred: true });
  });

  it("counts a town page under a hub segment as a location page, and a bare index page as not one", () => {
    const town = calculateAuditScore(scoreInput([page("/", {}, { links: [] }), page("/areas-we-cover/uxbridge", { page_role: "location" })], []));
    const indexOnly = calculateAuditScore(scoreInput([page("/", {}, { links: [] }), page("/areas-we-cover", { page_role: "location" })], []));
    expect(town.breakdown.categories.local_seo.rules.location_pages).toMatchObject({ status: "pass", evidence: { locationPages: 1, locationIndexPages: 0 } });
    expect(indexOnly.breakdown.categories.local_seo.rules.location_pages).toMatchObject({ status: "fail", evidence: { locationPages: 0, locationIndexPages: 1 } });
  });
});

describe("evidence sufficiency", () => {
  it("is complete only when coverage is at least 70% and every category has a score", () => {
    for (const input of [scoreInput(strongTradesSite(), strongPerformance(true)), scoreInput(weakSite(), weakPerformance(), { https: false })]) {
      const result = calculateAuditScore(input);
      expect(result.evidenceCoverage).toBeGreaterThanOrEqual(70);
      expect(CATEGORY_ORDER.every((key) => result.categoryScores[key] !== null)).toBe(true);
      expect(result.status).toBe("complete");
    }
  });

  it("stays complete without CrUX field data when the Performance category still has enough lab evidence", () => {
    const result = calculateAuditScore(scoreInput(strongTradesSite(), strongPerformance(false)));
    expect(result.breakdown.categories.performance.rules.field_lcp).toMatchObject({ status: "not_evaluated", evidence: { reason: "field_data_unavailable" } });
    // 16 of 20 performance points measured (Lighthouse + lab): scored, so no category is null and the status is unaffected.
    expect(result.breakdown.categories.performance).toMatchObject({ evaluatedMax: 16, coverage: 0.8, score: 19.36, suppressed: null });
    expect(result).toMatchObject({ status: "complete", overallScore: 99.36, evaluatedWeight: 100, evidenceCoverage: 96 });
  });

  it("is provisional when PageSpeed failed outright, even though coverage is above 70%", () => {
    const failed = [observation("mobile", { status: "failed", error_code: "timeout", performance_score: null, lcp_ms: null, cls: null, tbt_ms: null }), observation("desktop", { status: "failed", error_code: "timeout", performance_score: null })];
    // The same holds when no observation was ever collected (PERFORMANCE_PROVIDER=none).
    for (const observations of [failed, []]) {
      const result = calculateAuditScore(scoreInput(strongTradesSite(), observations));
      expect(result.categoryScores).toEqual({ technical: 25, local_seo: 25, content_structure: 20, performance: null, crawl: 10 });
      expect(result).toMatchObject({ status: "provisional", overallScore: 100, evaluatedWeight: 80, evidenceCoverage: 80 });
      expect(overallScoreLabel({ overall_score: result.overallScore, score_status: result.status })).toBe("100 / 100 (provisional)");
      reconcile(result);
    }
  });

  it("keeps the 50% per-category threshold: exactly half is scored, less is withheld and that alone prevents complete", () => {
    // Mobile Lighthouse score not returned: desktop 3 + LCP 3 + CLS 2 + TBT 2 = 10 of 20 performance points, exactly 50%.
    const half = calculateAuditScore(scoreInput(strongTradesSite(), [observation("mobile", { performance_score: null }), observation("desktop", { performance_score: 90 })]));
    expect(half.breakdown.categories.performance).toMatchObject({ evaluatedMax: 10, earned: 9.7, coverage: 0.5, score: 19.4, suppressed: null });
    expect(half).toMatchObject({ status: "complete", overallScore: 99.4, evidenceCoverage: 90 });
    // TBT missing as well: 8 of 20 = 40%, below the category minimum.
    const below = calculateAuditScore(scoreInput(strongTradesSite(), [observation("mobile", { performance_score: null, tbt_ms: null }), observation("desktop", { performance_score: 90 })]));
    expect(below.breakdown.categories.performance).toMatchObject({ evaluatedMax: 8, coverage: 0.4, score: null, suppressed: "insufficient_category_evidence" });
    expect(below).toMatchObject({ status: "provisional", overallScore: 100, evaluatedWeight: 80, evidenceCoverage: 80 });
  });

  it("never shows an overall score for a thinly measured site, however well the measured part did", () => {
    // Client-rendered shell with performance unavailable: only crawl + head-level technical evidence, all of it passing.
    const shell = [page("/", { h1_count: 0, word_count: 3, json_ld_count: 0, has_structured_data: false, schema_types: [] }, { renderingMode: "client_rendered_likely", nap: null }), page("/app", { h1_count: 0, word_count: 3, json_ld_count: 0, has_structured_data: false, schema_types: [] }, { renderingMode: "client_rendered_likely", nap: null })];
    const result = calculateAuditScore(scoreInput(shell, []));
    expect(result.categoryScores).toEqual({ technical: 25, local_seo: null, content_structure: null, performance: null, crawl: 10 });
    // Normalised naively this would read 100/100. With 31% of the evidence it must not read as a number at all.
    expect(result.evidenceCoverage).toBe(31);
    expect(result).toMatchObject({ status: "insufficient_evidence", overallScore: null, evaluatedWeight: 35 });
    expect(overallScoreLabel({ overall_score: result.overallScore, score_status: result.status })).toBe("Not scored");
    reconcile(result);
  });

  it("marks a 40–69.99% score provisional and labels it as internal only", () => {
    const result = calculateAuditScore(scoreInput(clientRenderedShell(), shellPerformance()));
    expect(result.evidenceCoverage).toBe(45);
    expect(result.status).toBe("provisional");
    expect(overallScoreLabel({ overall_score: result.overallScore, score_status: result.status })).toBe("66.15 / 100 (provisional)");
    expect(scoreStatusLabel("provisional")).toMatchObject({ headline: "Provisional · internal only", tone: "warn" });
    expect(scoreStatusLabel("complete").tone).toBe("good");
    expect(overallScoreLabel({ overall_score: 99.49, score_status: "complete" })).toBe("99.49 / 100");
  });

  it("withholds a category below 50% coverage and keeps its rule results visible", () => {
    const result = calculateAuditScore(scoreInput(clientRenderedShell(), shellPerformance()));
    const content = result.breakdown.categories.content_structure;
    expect(content).toMatchObject({ coverage: 0.3, score: null, suppressed: "insufficient_category_evidence" });
    expect(content.rules.unique_titles).toMatchObject({ status: "pass", points: 3 });
    // Its six evaluated points are not counted as coverage either: withheld evidence cannot prop up the overall status.
    expect(result.evidenceCoverage).toBe(45);
    const rows = categoryScoreRows({ technical_score: 17.5, local_seo_score: null, content_structure_score: null, performance_score: 8.88, crawl_score: 10 } as WebsiteAuditScore);
    expect(rows.map((row) => row.value)).toEqual(["17.5 / 25", "Not evaluated", "Not evaluated", "8.88 / 20", "10 / 10"]);
  });

  it("withholds performance measured on desktop only, and marks a v2-evidence run provisional", () => {
    // Desktop only = 3 of 20 performance points: below the category minimum, so withheld.
    expect(calculateAuditScore(scoreInput(strongTradesSite(), [observation("desktop")])).categoryScores.performance).toBeNull();
    // v2-era evidence: technical keeps 23 of 25, local keeps 5 of 25 (withheld), content keeps 8 of 20 (withheld) → crawl 10 + technical 23 + performance 16 = 49%.
    const v2Pages = strongTradesSite().map((row) => ({ ...row, evidence_json: { renderingMode: "server_rendered", hasLocalBusinessSchema: row.page_role === "homepage" } }));
    const v2 = calculateAuditScore(scoreInput(v2Pages, strongPerformance(false)));
    expect(v2.status).toBe("provisional");
    expect(v2.evidenceCoverage).toBe(49);
  });
});

describe("score_status boundaries", () => {
  // Coverage in integer hundredths of a percentage point. Rule maxima are whole points, so calculateAuditScore() itself can only
  // produce whole-percent coverage; the fractional boundaries are pinned on the decision function it delegates to.
  it("39.99% coverage is insufficient_evidence", () => {
    expect(scoreStatusOf(3999, true)).toBe("insufficient_evidence");
    expect(scoreStatusOf(3999, false)).toBe("insufficient_evidence");
  });

  it("40.00% coverage is provisional", () => {
    expect(scoreStatusOf(4000, true)).toBe("provisional");
    expect(scoreStatusOf(4000, false)).toBe("provisional");
  });

  it("69.99% coverage is provisional, even with every category scored", () => {
    expect(scoreStatusOf(6999, true)).toBe("provisional");
    expect(scoreStatusOf(6999, false)).toBe("provisional");
  });

  it("70.00% coverage with all five category scores non-null is complete", () => {
    expect(scoreStatusOf(7000, true)).toBe("complete");
  });

  it("70.00% coverage with one category null is provisional", () => {
    expect(scoreStatusOf(7000, false)).toBe("provisional");
    expect(scoreStatusOf(10_000, false)).toBe("provisional");
  });

  // The same boundaries end to end, through calculateAuditScore(). Synthetic inputs: a summary fact that was never recorded makes its
  // rule not_evaluated, which removes whole points from coverage without touching the formula.
  const withoutFacts = (input: AuditScoreInput, keys: string[]): AuditScoreInput => ({ ...input, run: { ...input.run, site_summary_json: Object.fromEntries(Object.entries(input.run.site_summary_json ?? {}).filter(([key]) => !keys.includes(key))) } });
  const scoredCategories = (result: AuditScoreResult) => CATEGORY_ORDER.filter((key) => result.categoryScores[key] !== null);
  // Mobile Lighthouse score not returned + desktop: 10 of 20 performance points.
  const halfPerformance = [observation("mobile", { performance_score: null }), observation("desktop", { performance_score: 90 })];

  it("end to end: 39% is insufficient_evidence with no overall score, 40% is provisional", () => {
    // Client-rendered single page: technical 20 + crawl 9 evaluated, local and content withheld.
    const at39 = calculateAuditScore(scoreInput(clientRenderedShell(), halfPerformance));
    expect(at39.breakdown.categories.performance.evaluatedMax).toBe(10);
    expect(at39).toMatchObject({ evidenceCoverage: 39, status: "insufficient_evidence", overallScore: null });
    // Mobile only, CLS not returned: 6 + 3 + 2 = 11 performance points.
    const at40 = calculateAuditScore(scoreInput(clientRenderedShell(), [observation("mobile", { performance_score: 45, cls: null })]));
    expect(at40.breakdown.categories.performance.evaluatedMax).toBe(11);
    expect(at40).toMatchObject({ evidenceCoverage: 40, status: "provisional" });
    expect(at40.overallScore).not.toBeNull();
    reconcile(at39);
    reconcile(at40);
  });

  it("end to end: 69% with all five categories scored is provisional, 70% with all five scored is complete", () => {
    // Strong site, 10/20 performance, schema + NAP summaries not recorded (local 13/25), HTTPS, sitemap and broken-link facts not recorded.
    const dropped = ["schema", "nap", "homepageHttps", "sitemapReachable", "brokenInternalLinks"];
    const at70 = calculateAuditScore(withoutFacts(scoreInput(strongTradesSite(), halfPerformance), dropped));
    expect(scoredCategories(at70)).toEqual(CATEGORY_ORDER);
    expect(CATEGORY_ORDER.map((key) => at70.breakdown.categories[key].evaluatedMax)).toEqual([19, 13, 18, 10, 10]);
    expect(at70).toMatchObject({ evidenceCoverage: 70, evaluatedWeight: 100, status: "complete" });
    const at69 = calculateAuditScore(withoutFacts(scoreInput(strongTradesSite(), halfPerformance), [...dropped, "robotsTxtReachable"]));
    expect(scoredCategories(at69)).toEqual(CATEGORY_ORDER);
    expect(at69).toMatchObject({ evidenceCoverage: 69, evaluatedWeight: 100, status: "provisional" });
    expect(at69.overallScore).not.toBeNull();
    reconcile(at70);
    reconcile(at69);
  });

  it("end to end: 70% with one category null is provisional", () => {
    // Strong site, no performance observation (performance null, 80%), then ten more points of facts not recorded.
    const result = calculateAuditScore(withoutFacts(scoreInput(strongTradesSite(), []), ["homepageHttps", "sitemapReachable", "robotsTxtReachable", "brokenInternalLinks", "internalRedirects"]));
    expect(result.categoryScores.performance).toBeNull();
    expect(scoredCategories(result)).toEqual(["technical", "local_seo", "content_structure", "crawl"]);
    expect(result).toMatchObject({ evidenceCoverage: 70, evaluatedWeight: 80, status: "provisional" });
    reconcile(result);
  });
});

describe("old audit compatibility", () => {
  it("scores a v2-evidence run without errors: v3-only rules are not evaluated, never failed", () => {
    const v2Pages = weakSite().map((row) => ({ ...row, evidence_json: { renderingMode: "server_rendered" } }));
    const result = calculateAuditScore(scoreInput(v2Pages, []));
    expect(result.breakdown.inputs.evidenceVersion).toBe(0);
    const v3Only = [["technical", "title_length"], ["technical", "meta_description_length"], ["local_seo", "localbusiness_name"], ["local_seo", "nap_phone"], ["local_seo", "nap_address"], ["local_seo", "location_pages"], ["local_seo", "service_area_evidence"], ["content_structure", "homepage_links_key_pages"], ["content_structure", "unique_titles"], ["content_structure", "unique_meta_descriptions"], ["content_structure", "non_thin_pages"], ["content_structure", "no_internal_redirects"]] as const;
    for (const [category, code] of v3Only) expect(result.breakdown.categories[category].rules[code]).toMatchObject({ status: "not_evaluated", evidence: { reason: "requires_evidence_v3" } });
    // v1/v2 facts are still scored.
    expect(result.breakdown.categories.technical.rules.canonical_coverage.status).toBe("fail");
    expect(result.breakdown.categories.local_seo.rules.localbusiness_schema.status).toBe("fail");
    reconcile(result);
  });

  it("scores a v3 run and an empty summary (pre-v1 shape) without throwing", () => {
    expect(calculateAuditScore(scoreInput(strongTradesSite(), [])).breakdown.inputs.evidenceVersion).toBe(3);
    const empty = calculateAuditScore({ run: { crawler_version: "audit-crawler/v1", rules_version: "audit-rules/v1", pages_attempted: 0, site_summary_json: {} }, pages: [], observations: [] });
    expect(empty).toMatchObject({ status: "insufficient_evidence", overallScore: null, evidenceCoverage: 0, scoringVersion: AUDIT_SCORE_VERSION });
  });
});
