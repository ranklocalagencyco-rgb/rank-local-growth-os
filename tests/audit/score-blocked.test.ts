import { describe, expect, it } from "vitest";

import { calculateAuditScore, type AuditScoreInput, type AuditScoreResult } from "@/audit/score/calculate";
import { AUDIT_SCORE_VERSION, CATEGORY_ORDER, CATEGORY_WEIGHTS } from "@/audit/score/rules";
import type { WebsiteAuditPage, WebsitePerformanceObservation } from "@/db/types";
import { clientRenderedShell, observation, page, scoreInput, shellPerformance, strongPerformance, strongTradesSite, weakPerformance, weakSite } from "./score-fixtures";

// audit-score/v2 (RL-067): blocked runs, challenge documents on secondary pages, and proof that ordinary sites score exactly as under v1.

const challenge = { detected: true, kind: "bot_challenge", confidence: "high", rule: "title_tiny_document", markerFamily: null, signals: ["title:one_moment_please", "structure:tiny_document"], detectorVersion: "challenge-detector/v1", url: "https://example-roofing.co.uk/", httpStatus: 200, title: "One moment, please...", wordCount: 8, internalLinkCount: 0, h1Count: 0, detectedAt: "2026-09-19T10:00:00.000Z" };

/** A challenge row exactly as the crawler stores it: HTTP facts and provenance, content columns at their defaults. */
const challengeRow = (path: string): WebsiteAuditPage => page(path, { title: null, meta_description: null, h1_count: 0, h1_text: [], h2_count: 0, canonical_url: null, has_viewport: false, word_count: 0, internal_link_count: 0, tel_link_count: 0, cta_count: 0, json_ld_count: 0, schema_types: [], has_structured_data: false }, { renderingMode: "unknown", nap: null, challenge: { ...challenge, url: `https://example-roofing.co.uk${path}` } });

function blockedInput(observations: WebsitePerformanceObservation[]): AuditScoreInput {
  return { run: { crawler_version: "audit-crawler/v4", rules_version: "audit-rules/v4", pages_attempted: 1, site_summary_json: { homepageUrl: "https://example-roofing.co.uk", homepageFinalUrl: "https://example-roofing.co.uk/", homepageStatus: 200, homepageRedirectChain: [], crawlBlocked: true, challenge } }, pages: [challengeRow("/")], observations };
}

const crawlDerived = ["technical", "local_seo", "content_structure", "crawl"] as const;
const statuses = (result: AuditScoreResult, category: (typeof CATEGORY_ORDER)[number]) => Object.values(result.breakdown.categories[category].rules).map((rule) => rule.status);

describe("audit-score/v2: blocked homepage", () => {
  it("with successful PageSpeed: performance evidence only, insufficient_evidence, no overall score", () => {
    const result = calculateAuditScore(blockedInput(strongPerformance(false)));
    expect(result.scoringVersion).toBe("audit-score/v2");
    expect(AUDIT_SCORE_VERSION).toBe("audit-score/v2");
    expect(result).toMatchObject({ status: "insufficient_evidence", overallScore: null, evidenceCoverage: 16, evaluatedWeight: 20 });
    expect(result.categoryScores).toEqual({ technical: null, local_seo: null, content_structure: null, performance: 19.36, crawl: null });
    expect(result.breakdown.inputs).toMatchObject({ crawlBlocked: true, challengePagesExcluded: 1, pagesStored: 1, htmlPagesScored: 0 });
  });

  it("reaches at most 20% coverage even with field data, so it can never be provisional or complete", () => {
    const result = calculateAuditScore(blockedInput(strongPerformance(true)));
    expect(result).toMatchObject({ status: "insufficient_evidence", overallScore: null, evidenceCoverage: 20 });
    expect(result.categoryScores.performance).toBe(19.49);
  });

  it("never infers a failure from the challenge document: every crawl-derived rule is not_evaluated (crawl_blocked), none scores zero", () => {
    const result = calculateAuditScore(blockedInput(strongPerformance(false)));
    for (const key of crawlDerived) {
      const category = result.breakdown.categories[key];
      expect(statuses(result, key).every((status) => status === "not_evaluated")).toBe(true);
      expect(Object.values(category.rules).every((rule) => rule.points === 0 && rule.evidence.reason === "crawl_blocked")).toBe(true);
      // Maxima are untouched: weights did not change, the evidence is simply missing.
      expect(category).toMatchObject({ weight: CATEGORY_WEIGHTS[key], nominalMax: CATEGORY_WEIGHTS[key], evaluatedMax: 0, earned: 0, score: null, suppressed: "insufficient_category_evidence" });
    }
    expect(Object.values(result.categoryScores).filter((score) => score === 0)).toEqual([]);
    // Site-level facts are not trusted either: the same layer that challenged the homepage answers robots.txt and the sitemap.
    expect(result.breakdown.categories.technical.rules.https.status).toBe("not_evaluated");
    expect(result.breakdown.categories.crawl.rules.homepage_reachable.status).toBe("not_evaluated");
  });

  it("performance rules are evaluated exactly as on a normal run", () => {
    const blocked = calculateAuditScore(blockedInput(weakPerformance()));
    const normal = calculateAuditScore(scoreInput(weakSite(), weakPerformance(), { https: false, robotsTxtReachable: false, sitemapReachable: false }));
    expect(blocked.breakdown.categories.performance).toEqual(normal.breakdown.categories.performance);
  });

  it("with PageSpeed unavailable: nothing is evaluated and nothing is scored", () => {
    const result = calculateAuditScore(blockedInput([observation("mobile", { status: "failed", performance_score: null }), observation("desktop", { status: "failed", performance_score: null })]));
    expect(result).toMatchObject({ status: "insufficient_evidence", overallScore: null, evidenceCoverage: 0, evaluatedWeight: 0 });
    expect(Object.values(result.categoryScores).every((score) => score === null)).toBe(true);
  });
});

describe("audit-score/v2: challenge document on a secondary page", () => {
  it("is excluded from every page denominator, so a strong site scores exactly as it does without that row", () => {
    const baseline = calculateAuditScore(scoreInput(strongTradesSite(), strongPerformance(true)));
    const withChallenge = calculateAuditScore(scoreInput([...strongTradesSite(), challengeRow("/blocked-page")], strongPerformance(true)));
    expect(withChallenge.categoryScores).toEqual(baseline.categoryScores);
    expect(withChallenge).toMatchObject({ status: baseline.status, overallScore: baseline.overallScore, evidenceCoverage: baseline.evidenceCoverage });
    const fetchSuccess = (result: AuditScoreResult) => result.breakdown.categories.crawl.rules.pages_fetch_success.evidence;
    expect(fetchSuccess(withChallenge)).toEqual(fetchSuccess(baseline));
    for (const rule of ["title_coverage", "canonical_coverage", "viewport_coverage", "h1_coverage"]) expect(withChallenge.breakdown.categories.technical.rules[rule]).toEqual(baseline.breakdown.categories.technical.rules[rule]);
    expect(withChallenge.breakdown.inputs).toMatchObject({ crawlBlocked: false, challengePagesExcluded: 1, htmlPagesScored: baseline.breakdown.inputs.htmlPagesScored });
    expect(withChallenge.breakdown.inputs.pagesStored).toBe(baseline.breakdown.inputs.pagesStored + 1);
  });

  it("does not make the whole run blocked and does not turn an unmeasured page type into a failure", () => {
    const baseline = calculateAuditScore(scoreInput(weakSite(), weakPerformance(), { https: false, robotsTxtReachable: false, sitemapReachable: false }));
    const withChallenge = calculateAuditScore(scoreInput([...weakSite(), challengeRow("/contact")], weakPerformance(), { https: false, robotsTxtReachable: false, sitemapReachable: false }));
    expect(baseline.breakdown.categories.content_structure.rules.contact_page.status).toBe("fail");
    expect(withChallenge.breakdown.categories.content_structure.rules.contact_page).toMatchObject({ status: "not_evaluated", evidence: { reason: "challenge_pages_not_evaluated", challengePagesExcluded: 1 } });
    expect(withChallenge.breakdown.categories.local_seo.rules.location_pages.status).toBe("not_evaluated");
    expect(withChallenge.status).not.toBe("insufficient_evidence");
    expect(withChallenge.breakdown.inputs.crawlBlocked).toBe(false);
  });
});

describe("audit-score/v2 equals audit-score/v1 for ordinary sites", () => {
  // The numbers are the published audit-score/v1 results of these fixtures (tests/audit/score-golden.test.ts at commit b6fb01a).
  const v1: [string, () => AuditScoreInput, Pick<AuditScoreResult, "status" | "overallScore" | "evaluatedWeight" | "evidenceCoverage" | "categoryScores">][] = [
    ["strong trades site with field data", () => scoreInput(strongTradesSite(), strongPerformance(true)), { status: "complete", overallScore: 99.49, evaluatedWeight: 100, evidenceCoverage: 100, categoryScores: { technical: 25, local_seo: 25, content_structure: 20, performance: 19.49, crawl: 10 } }],
    ["strong trades site without field data", () => scoreInput(strongTradesSite(), strongPerformance(false)), { status: "complete", overallScore: 99.36, evaluatedWeight: 100, evidenceCoverage: 96, categoryScores: { technical: 25, local_seo: 25, content_structure: 20, performance: 19.36, crawl: 10 } }],
    ["technically weak site", () => scoreInput(weakSite(), weakPerformance(), { https: false, robotsTxtReachable: false, sitemapReachable: false }), { status: "complete", overallScore: 27.89, evaluatedWeight: 100, evidenceCoverage: 93, categoryScores: { technical: 6.67, local_seo: 0, content_structure: 7.06, performance: 4.16, crawl: 10 } }],
    ["client-rendered shell", () => scoreInput(clientRenderedShell(), shellPerformance()), { status: "provisional", overallScore: 66.15, evaluatedWeight: 55, evidenceCoverage: 45, categoryScores: { technical: 17.5, local_seo: null, content_structure: null, performance: 8.88, crawl: 10 } }],
  ];

  it.each(v1)("%s keeps its v1 category and overall values", (_name, input, expected) => {
    const result = calculateAuditScore(input());
    expect(result.scoringVersion).toBe("audit-score/v2");
    expect({ status: result.status, overallScore: result.overallScore, evaluatedWeight: result.evaluatedWeight, evidenceCoverage: result.evidenceCoverage, categoryScores: result.categoryScores }).toEqual(expected);
    expect(result.breakdown.inputs).toMatchObject({ crawlBlocked: false, challengePagesExcluded: 0 });
    expect(JSON.stringify(result.breakdown.categories)).not.toContain("crawl_blocked");
    expect(JSON.stringify(result.breakdown.categories)).not.toContain("challenge_pages_not_evaluated");
  });
});
