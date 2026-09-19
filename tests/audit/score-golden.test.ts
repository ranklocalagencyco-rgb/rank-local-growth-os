import { describe, expect, it } from "vitest";

import { calculateAuditScore, type AuditScoreResult } from "@/audit/score/calculate";
import { clientRenderedShell, observation, scoreInput, shellPerformance, strongPerformance, strongTradesSite, weakPerformance, weakSite } from "./score-fixtures";

// Golden fixtures for audit-score/v1. Expected points were derived by hand from the rule table in docs/AUDIT_SCORE.md; a change
// here means the formula changed and needs a new scoring version, not an updated expectation.

const points = (result: AuditScoreResult, category: keyof AuditScoreResult["breakdown"]["categories"]) => Object.fromEntries(Object.entries(result.breakdown.categories[category].rules).map(([code, rule]) => [code, rule.status === "not_evaluated" ? "n/e" : rule.points]));

describe("audit-score/v1 golden fixtures", () => {
  it("1. strong conventional trades website with field data: every rule passes except the linear Lighthouse scores", () => {
    const result = calculateAuditScore(scoreInput(strongTradesSite(), strongPerformance(true)));
    expect(points(result, "crawl")).toEqual({ homepage_reachable: 2, homepage_indexable: 4, robots_allows_crawling: 2, pages_indexable: 1, pages_fetch_success: 1 });
    expect(points(result, "technical")).toEqual({ https: 4, sitemap: 2, robots_txt: 1, title_coverage: 4, title_length: 1, meta_description_coverage: 3, meta_description_length: 1, canonical_coverage: 3, viewport_coverage: 2, h1_coverage: 3, structured_data: 1 });
    expect(points(result, "local_seo")).toEqual({ localbusiness_schema: 5, localbusiness_name: 1, localbusiness_telephone: 1, localbusiness_address: 2, nap_phone: 4, nap_address: 4, location_pages: 5, service_area_evidence: 3 });
    expect(points(result, "content_structure")).toEqual({ service_pages: 4, contact_page: 2, homepage_links_key_pages: 3, unique_titles: 3, unique_meta_descriptions: 2, non_thin_pages: 3, no_broken_internal_links: 2, no_internal_redirects: 1 });
    // 6 × 0.92 = 5.52 and 3 × 0.99 = 2.97; all banded lab and field metrics are in the "good" band.
    expect(points(result, "performance")).toEqual({ lighthouse_performance_mobile: 5.52, lighthouse_performance_desktop: 2.97, lcp_mobile_lab: 3, cls_mobile_lab: 2, tbt_mobile_lab: 2, field_lcp: 2, field_inp: 1, field_cls: 1 });
    expect(result.categoryScores).toEqual({ technical: 25, local_seo: 25, content_structure: 20, performance: 19.49, crawl: 10 });
    expect(result).toMatchObject({ scoringVersion: "audit-score/v1", status: "complete", overallScore: 99.49, evaluatedWeight: 100, evidenceCoverage: 100 });
  });

  it("2. technically weak website: measured failures score zero and stay in the denominator", () => {
    const result = calculateAuditScore(scoreInput(weakSite(), weakPerformance(), { https: false, robotsTxtReachable: false, sitemapReachable: false }));
    expect(points(result, "crawl")).toEqual({ homepage_reachable: 2, homepage_indexable: 4, robots_allows_crawling: 2, pages_indexable: 1, pages_fetch_success: 1 });
    // title_length 2 of 3 titled pages = 0.67; meta coverage 1/3 = 1; h1_coverage 1/3 = 1.
    expect(points(result, "technical")).toEqual({ https: 0, sitemap: 0, robots_txt: 0, title_coverage: 4, title_length: 0.67, meta_description_coverage: 1, meta_description_length: 0, canonical_coverage: 0, viewport_coverage: 0, h1_coverage: 1, structured_data: 0 });
    // The crawl exhausted its frontier, so "no location pages" is a measured fact, not missing evidence.
    expect(points(result, "local_seo")).toEqual({ localbusiness_schema: 0, localbusiness_name: 0, localbusiness_telephone: 0, localbusiness_address: 0, nap_phone: 0, nap_address: 0, location_pages: 0, service_area_evidence: 0 });
    expect(points(result, "content_structure")).toEqual({ service_pages: 0, contact_page: 0, homepage_links_key_pages: "n/e", unique_titles: 1, unique_meta_descriptions: 2, non_thin_pages: 2, no_broken_internal_links: 0, no_internal_redirects: 1 });
    expect(points(result, "performance")).toEqual({ lighthouse_performance_mobile: 1.68, lighthouse_performance_desktop: 1.65, lcp_mobile_lab: 0, cls_mobile_lab: 0, tbt_mobile_lab: 0, field_lcp: "n/e", field_inp: "n/e", field_cls: "n/e" });
    // content 20 × 6/17 = 7.06; performance 20 × 3.33/16 = 4.16.
    expect(result.categoryScores).toEqual({ technical: 6.67, local_seo: 0, content_structure: 7.06, performance: 4.16, crawl: 10 });
    expect(result).toMatchObject({ status: "complete", overallScore: 27.89, evaluatedWeight: 100, evidenceCoverage: 93 });
  });

  it("3. client-rendered shell: content-dependent rules are not evaluated, thin categories are withheld and the score is provisional", () => {
    const result = calculateAuditScore(scoreInput(clientRenderedShell(), shellPerformance()));
    expect(points(result, "crawl")).toEqual({ homepage_reachable: 2, homepage_indexable: 4, robots_allows_crawling: 2, pages_indexable: "n/e", pages_fetch_success: 1 });
    expect(points(result, "technical")).toEqual({ https: 4, sitemap: 2, robots_txt: 1, title_coverage: 4, title_length: 1, meta_description_coverage: 0, meta_description_length: "n/e", canonical_coverage: 0, viewport_coverage: 2, h1_coverage: "n/e", structured_data: "n/e" });
    expect(Object.values(points(result, "local_seo")).every((value) => value === "n/e")).toBe(true);
    expect(points(result, "content_structure")).toEqual({ service_pages: "n/e", contact_page: "n/e", homepage_links_key_pages: "n/e", unique_titles: 3, unique_meta_descriptions: "n/e", non_thin_pages: "n/e", no_broken_internal_links: 2, no_internal_redirects: 1 });
    expect(result.breakdown.categories.content_structure).toMatchObject({ evaluatedMax: 6, coverage: 0.3, score: null, suppressed: "insufficient_category_evidence" });
    expect(result.breakdown.categories.local_seo).toMatchObject({ evaluatedMax: 0, score: null, suppressed: "insufficient_category_evidence" });
    // technical 25 × 14/20 = 17.5; performance 20 × 7.1/16 = 8.88; crawl 10 × 9/9 = 10.
    expect(result.categoryScores).toEqual({ technical: 17.5, local_seo: null, content_structure: null, performance: 8.88, crawl: 10 });
    // Coverage = 20 + 16 + 9 contributing points; overall = 100 × 36.38 / 55.
    expect(result).toMatchObject({ status: "provisional", overallScore: 66.15, evaluatedWeight: 55, evidenceCoverage: 45 });
  });

  it("4. site with no PageSpeed field data: field rules leave the denominator instead of scoring zero", () => {
    const withField = calculateAuditScore(scoreInput(strongTradesSite(), strongPerformance(true)));
    const withoutField = calculateAuditScore(scoreInput(strongTradesSite(), strongPerformance(false)));
    expect(points(withoutField, "performance")).toEqual({ lighthouse_performance_mobile: 5.52, lighthouse_performance_desktop: 2.97, lcp_mobile_lab: 3, cls_mobile_lab: 2, tbt_mobile_lab: 2, field_lcp: "n/e", field_inp: "n/e", field_cls: "n/e" });
    expect(withoutField.breakdown.categories.performance).toMatchObject({ evaluatedMax: 16, earned: 15.49, score: 19.36 });
    expect(withoutField).toMatchObject({ status: "complete", overallScore: 99.36, evidenceCoverage: 96 });
    // Scoring the absent field data as zero would have cost four points; the normalised score is within rounding of the fully measured one.
    expect(withField.overallScore! - withoutField.overallScore!).toBeLessThan(0.2);
    expect(withoutField.breakdown.categories.performance.rules.field_lcp.evidence).toMatchObject({ reason: "field_data_unavailable" });
  });

  it("5. strong site whose PageSpeed requests all failed: Performance is withheld, so the score is provisional despite 80% coverage", () => {
    const failed = [observation("mobile", { status: "failed", error_code: "timeout", performance_score: null, lcp_ms: null, cls: null, tbt_ms: null }), observation("desktop", { status: "failed", error_code: "timeout", performance_score: null })];
    const result = calculateAuditScore(scoreInput(strongTradesSite(), failed));
    expect(Object.values(points(result, "performance")).every((value) => value === "n/e")).toBe(true);
    expect(result.breakdown.categories.performance).toMatchObject({ evaluatedMax: 0, score: null, suppressed: "insufficient_category_evidence" });
    expect(result.categoryScores).toEqual({ technical: 25, local_seo: 25, content_structure: 20, performance: null, crawl: 10 });
    // overall = 100 × 80 / 80, normalised over the scored weight; never complete with a null category.
    expect(result).toMatchObject({ status: "provisional", overallScore: 100, evaluatedWeight: 80, evidenceCoverage: 80 });
  });
});
