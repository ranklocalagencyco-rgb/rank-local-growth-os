import { describe, expect, it } from "vitest";

import { buildAuditReport, formatReportDate, isReportAvailable, versionGeneration } from "@/report/model";
import { clientRenderedShell, observation, shellPerformance, strongPerformance, strongTradesSite, weakPerformance, weakSite } from "../audit/score-fixtures";
import { tradeSiteV2Run } from "./fixtures/trade-site-v2-run";
import { blockedReportData, finding, reportData } from "./report-fixtures";

// Pure report model (src/report/model.ts): every value on the client report is read from stored rows, never recalculated or generated.

describe("report from the real audit-score/v2 run (sanitized)", () => {
  const model = buildAuditReport(tradeSiteV2Run);

  it("shows the stored overall score, status, coverage and versions", () => {
    expect(model.state).toBe("complete");
    expect(model.header).toMatchObject({ businessName: "Example Roofing", domain: "example-roofing.co.uk", overallLabel: "83.88 / 100", overallValue: 83.88, statusLabel: "Complete", tone: "good", coverageLabel: "96%", auditDateLabel: "19 September 2026", versions: { crawler: "audit-crawler/v4", rules: "audit-rules/v4", scoring: "audit-score/v2" } });
    expect(model.coverage).toMatchObject({ percent: 96, sentence: "Every category was scored and enough of the audit was measured for the overall score to stand on its own." });
    expect(model.coverage.details).toEqual(["3 checks could not be evaluated and are excluded from the score; see the score breakdown."]);
    expect(model.historicalNotice).toBeNull();
    expect(model.blocked).toBeNull();
  });

  it("shows the five stored category scores with a summary taken from the largest measured loss", () => {
    expect(model.categories.map((category) => [category.label, category.scoreLabel, category.summary])).toEqual([
      ["Technical SEO", "24.93 / 25", "Key gap: Not every meta description is within the configured length range."],
      ["Local SEO", "16 / 25", "Key gap: LocalBusiness structured data was not detected."],
      ["Content & Structure", "20 / 20", "All evaluated checks passed."],
      ["Performance", "12.95 / 20", "Key gap: Mobile Largest Contentful Paint is above the Good threshold."],
      ["Crawl & Indexability", "10 / 10", "All evaluated checks passed."],
    ]);
    expect(model.categories.every((category) => category.evaluated && category.ratio !== null)).toBe(true);
  });

  it("lists the stored findings in client wording, without the free text captured from the site", () => {
    expect(model.findingCount).toBe(2);
    expect(model.keyFindings.map((entry) => [entry.code, entry.title, entry.severityLabel, entry.scope, entry.categoryLabel])).toEqual([
      ["no_localbusiness_schema", "LocalBusiness structured data was not detected", "Medium", "site", "Local SEO"],
      ["meta_description_too_long", "One or more meta descriptions exceed the configured length range", "Note", "page", "Technical SEO"],
    ]);
    const meta = model.keyFindings[1];
    expect(meta).toMatchObject({ affectedCount: 1, affectedPaths: ["/three-layer-flat-roofs"] });
    expect(meta.evidence).toEqual([{ label: "Meta description length (characters)", value: "161" }, { label: "Configured limit", value: "160" }, { label: "HTTP status", value: "200" }]);
    expect(JSON.stringify(model.keyFindings)).not.toContain("three layer flat roof solutions");
    expect(model.crawlNotes).toEqual([]);
  });

  it("reports performance per strategy with ratings only where the scoring engine has thresholds", () => {
    const [mobile, desktop] = model.performance.strategies;
    expect(mobile).toMatchObject({ label: "Mobile", status: "measured", score: 66 });
    expect(desktop).toMatchObject({ label: "Desktop", status: "measured", score: 80 });
    const rated = (strategy: typeof mobile) => Object.fromEntries(strategy.metrics.map((metric) => [metric.key, [metric.value, metric.bandLabel]]));
    expect(rated(mobile)).toMatchObject({ lcp: ["10.4 s", "Poor"], cls: ["0.002", "Good"], tbt: ["99 ms", "Good"] });
    expect(rated(desktop)).toMatchObject({ lcp: ["2.2 s", "Good"], cls: ["0.003", "Good"], tbt: ["61 ms", "Good"] });
    for (const strategy of [mobile, desktop]) for (const key of ["fcp", "speed_index", "tti"]) expect(strategy.metrics.find((metric) => metric.key === key)?.bandLabel ?? null).toBeNull();
    expect(model.performance.field).toEqual({ metrics: [], scopeLabel: null, sentence: "Real-user (CrUX) data was not available for this URL. These field-data checks were not evaluated." });
  });

  it("counts page roles from the evaluated pages and states the crawl scope", () => {
    expect(Object.fromEntries(model.structure.roles.map((role) => [role.role, role.count]))).toEqual({ homepage: 1, service: 6, location: 5, contact: 1, about: 0, testimonials: 1, gallery: 1, blog: 0, other: 0 });
    expect(model.structure).toMatchObject({ pagesEvaluated: 15, pagesAttempted: 15, pagesNotLoaded: 0, pageCap: 15, sitemapLabel: "Found, 15 URLs listed", scopeSentence: "Every page the crawler discovered was evaluated (limit: 15 pages)." });
  });

  it("states Local SEO evidence from the matching score rules", () => {
    expect(model.localSeo.items.map((item) => [item.key, item.stateLabel])).toEqual([["localbusiness_schema", "Not found"], ["nap_phone", "Found"], ["nap_address", "Found"], ["location_pages", "Found"], ["service_area_evidence", "Found"]]);
    expect(model.localSeo.items[0].detail).toContain("Organization");
    expect(model.localSeo.items[1].detail).toBe("3 phone numbers detected, on 15 of 15 pages.");
    expect(model.localSeo.items[2].detail).toBe("2 addresses and 1 postcode detected, on 15 of 15 pages.");
    expect(model.localSeo.items[3].detail).toBe("4 location pages and 1 area index page.");
    expect(model.localSeo.localities).toEqual(["Uxbridge", "Hillingdon", "Ruislip", "Gerrards Cross", "Buckinghamshire"]);
  });

  it("derives strengths only from rules that passed in full", () => {
    const stored = (tradeSiteV2Run.score!.breakdown_json as { categories: Record<string, { rules: Record<string, { status: string }> }> }).categories;
    const passing = Object.values(stored).flatMap((category) => Object.entries(category.rules).filter(([, rule]) => rule.status === "pass").map(([code]) => code));
    expect(model.strengths.map((strength) => strength.code).sort()).toEqual(passing.sort());
    const codes = model.strengths.map((strength) => strength.code);
    expect(codes).toEqual(expect.arrayContaining(["https", "sitemap", "robots_txt", "service_pages", "contact_page", "location_pages", "nap_phone", "nap_address"]));
    for (const notPassing of ["localbusiness_schema", "meta_description_length", "lcp_mobile_lab", "lighthouse_performance_mobile", "field_lcp"]) expect(codes).not.toContain(notPassing);
  });

  it("exposes every rule in the breakdown, in the documented order, with points and measured evidence", () => {
    expect(model.breakdown.map((category) => [category.label, category.scoreLabel, category.rules.length])).toEqual([["Technical SEO", "24.93 / 25", 11], ["Local SEO", "16 / 25", 8], ["Content & Structure", "20 / 20", 8], ["Performance", "12.95 / 20", 8], ["Crawl & Indexability", "10 / 10", 5]]);
    expect(model.breakdown[0].rules[0]).toMatchObject({ code: "https", label: "HTTPS", statusLabel: "Pass", pointsLabel: "4 / 4" });
    const lcp = model.breakdown[3].rules.find((rule) => rule.code === "lcp_mobile_lab")!;
    expect(lcp).toMatchObject({ statusLabel: "Fail", pointsLabel: "0 / 3" });
    expect(lcp.evidence).toEqual(expect.arrayContaining([{ label: "LCP (ms)", value: "10404" }]));
    expect(model.breakdown[3].rules.find((rule) => rule.code === "field_lcp")).toMatchObject({ statusLabel: "Not evaluated", pointsLabel: "– / 2", evidence: [{ label: "Reason", value: "Real-user (CrUX) data was not available for this URL" }] });
  });

  it("is deterministic", () => {
    expect(buildAuditReport(tradeSiteV2Run)).toEqual(model);
  });

  it("privacy: states contact details as detected / not detected with counts, never the raw phone, email, address or postcode", () => {
    const nap = (tradeSiteV2Run.run.site_summary_json as { nap: { phones: { raw: string; digits: string }[]; emails: { value: string }[]; postcodes: { value: string }[]; addressCandidates: { text: string }[] } }).nap;
    const raw = [...nap.phones.flatMap((phone) => [phone.raw, phone.digits]), ...nap.emails.map((email) => email.value), ...nap.postcodes.map((postcode) => postcode.value), ...nap.addressCandidates.map((address) => address.text)];
    expect(raw.length).toBeGreaterThanOrEqual(8);
    const serialized = JSON.stringify(model);
    for (const value of raw) expect(serialized, value).not.toContain(value);
    expect(serialized).not.toMatch(/[^\s"@]+@[^\s"@]+\.[a-z]{2,}/i);
    expect(model.localSeo.items.filter((item) => item.key.startsWith("nap_")).map((item) => item.stateLabel)).toEqual(["Found", "Found"]);
  });

  it("privacy: a contact detail inside any evidence value is dropped, whichever key carries it", () => {
    const data = reportData(strongTradesSite(), strongPerformance(true), {}, { findings: [finding("page_noindex", "medium", "page", { path: "/x", metaRobots: "noindex", discoveredFrom: "mailto:office@example-roofing.co.uk" }), finding("localbusiness_schema_incomplete", "low", "site", { missingFields: ["telephone", "01632 960111"], pagesCrawled: 9 })] });
    const entries = buildAuditReport(data).keyFindings;
    expect(entries.find((entry) => entry.code === "page_noindex")?.evidence).toEqual([{ label: "Robots meta tag", value: "noindex" }]);
    expect(entries.find((entry) => entry.code === "localbusiness_schema_incomplete")?.evidence).toEqual([{ label: "Pages evaluated", value: "9" }]);
  });
});

describe("score states", () => {
  it("complete: a strong site with field data", () => {
    const model = buildAuditReport(reportData(strongTradesSite(), strongPerformance(true)));
    expect(model).toMatchObject({ state: "complete", header: { overallLabel: "99.49 / 100", statusLabel: "Complete", coverageLabel: "100%" } });
    expect(model.coverage.details).toEqual([]);
    expect(model.performance.field.metrics.map((metric) => [metric.key, metric.bandLabel])).toEqual([["field_lcp", "Good"], ["field_inp", "Good"], ["field_cls", "Good"]]);
    expect(model.performance.field.sentence).toBeNull();
  });

  it("provisional: the number always carries the word, and withheld categories are 'Not evaluated', never zero", () => {
    const model = buildAuditReport(reportData(clientRenderedShell(), shellPerformance()));
    expect(model).toMatchObject({ state: "provisional", header: { overallLabel: "66.15 / 100 (provisional)", statusLabel: "Provisional", tone: "warn", coverageLabel: "45%" }, coverage: { sentence: "Some audit evidence was unavailable, so this score is provisional." } });
    const local = model.categories.find((category) => category.key === "local_seo")!;
    expect(local).toMatchObject({ evaluated: false, score: null, ratio: null, scoreLabel: "Not evaluated", summary: "Not evaluated: The page content is rendered by JavaScript, which this crawler does not execute." });
    expect(model.coverage.details).toEqual(expect.arrayContaining([expect.stringContaining("Local SEO:"), expect.stringContaining("Content & Structure:")]));
    expect(model.localSeo.items.every((item) => item.state === "not_evaluated")).toBe(true);
    // A withheld category contributes no strengths.
    expect(model.strengths.some((strength) => strength.category === "local_seo" || strength.category === "content_structure")).toBe(false);
    expect(model.crawlNotes).toEqual(["The page content is rendered by JavaScript, which this crawler does not execute, so content-based checks were not evaluated."]);
  });

  it("provisional 100: a perfect number on partial evidence is never shown bare or as complete", () => {
    const data = reportData(strongTradesSite(), strongPerformance(true), {}, { score: { score_status: "provisional", overall_score: 100, performance_score: null, evidence_coverage: 80 } });
    const model = buildAuditReport(data);
    expect(model.header.overallLabel).toBe("100 / 100 (provisional)");
    expect(model.header).toMatchObject({ statusLabel: "Provisional", tone: "warn", coverageLabel: "80%" });
    expect(model.categories.find((category) => category.key === "performance")).toMatchObject({ evaluated: false, scoreLabel: "Not evaluated" });
  });

  it("insufficient evidence: no overall number at all", () => {
    const data = reportData(strongTradesSite(), strongPerformance(true), {}, { score: { score_status: "insufficient_evidence", overall_score: null, evidence_coverage: 35 } });
    const model = buildAuditReport(data);
    expect(model).toMatchObject({ state: "insufficient", header: { overallLabel: "Not scored", overallValue: null, statusLabel: "Insufficient evidence", coverageLabel: "35%" }, coverage: { sentence: "There was not enough reliable evidence to produce an overall score." } });
  });

  it("unscored: a completed audit whose score has not been written yet renders without categories", () => {
    const model = buildAuditReport(reportData(strongTradesSite(), [], {}, { score: null }));
    expect(model).toMatchObject({ state: "unscored", header: { overallLabel: "Score pending", coverageLabel: "Not calculated", versions: { scoring: null } }, categories: [], strengths: [], breakdown: [] });
    // Site evidence is still stated from the stored summary.
    expect(model.localSeo.items.find((item) => item.key === "nap_phone")?.state).toBe("found");
  });
});

describe("blocked audit", () => {
  const model = buildAuditReport(blockedReportData(strongPerformance(false)));

  it("does not look like a completed audit", () => {
    expect(model).toMatchObject({ state: "blocked", contentEvaluated: false, header: { overallLabel: "Not scored", overallValue: null, statusLabel: "Audit blocked", tone: "warn", coverageLabel: "16%" }, coverage: { sentence: "There was not enough reliable evidence to produce an overall score." } });
    expect(model.blocked).toMatchObject({ headline: "Audit blocked", text: "The site returned a browser verification or challenge page, so content-based checks could not be evaluated reliably.", kindLabel: "Bot challenge / browser verification", url: "https://example-roofing.co.uk/", pageTitle: "One moment, please...", httpStatusLabel: "HTTP 200", signals: ["title:one_moment_please", "text:request_being_verified", "structure:tiny_document"], detectedAtLabel: "19 September 2026, 10:00 UTC" });
  });

  it("shows no zero for crawl-based categories and keeps measured performance", () => {
    for (const key of ["technical", "local_seo", "content_structure", "crawl"]) expect(model.categories.find((category) => category.key === key)).toMatchObject({ evaluated: false, score: null, ratio: null, scoreLabel: "Not evaluated", summary: "Not evaluated: The audit was blocked by a browser-verification page." });
    expect(model.categories.find((category) => category.key === "performance")).toMatchObject({ evaluated: true, scoreLabel: "19.36 / 20" });
    expect(model.performance.strategies.map((strategy) => strategy.status)).toEqual(["measured", "measured"]);
    expect(JSON.stringify(model.categories)).not.toMatch(/"scoreLabel":"0 \//);
  });

  it("frames nothing as an SEO problem: no findings, 'Not evaluated' instead of 'Not found'", () => {
    expect(model).toMatchObject({ keyFindings: [], findingGroups: [], findingCount: 0, crawlNotes: [] });
    expect(model.localSeo.items.map((item) => item.stateLabel)).toEqual(Array(5).fill("Not evaluated"));
    expect(model.localSeo.localities).toEqual([]);
    expect(model.structure).toMatchObject({ pagesEvaluated: 0, sitemapLabel: "Not evaluated", scopeSentence: "The audit stopped at the homepage, so the website's pages were not evaluated." });
    expect(model.strengths.every((strength) => strength.category === "performance")).toBe(true);
    expect(model.historicalNotice).toBeNull();
  });
});

describe("performance evidence", () => {
  it("unavailable: failed measurements are 'not measured', never zero", () => {
    const failed = [observation("mobile", { status: "failed", performance_score: null, error_code: "provider_error", lcp_ms: null, cls: null, tbt_ms: null, fcp_ms: null, speed_index_ms: null, tti_ms: null }), observation("desktop", { status: "failed", performance_score: null, error_code: "timeout", lcp_ms: null, cls: null, tbt_ms: null, fcp_ms: null, speed_index_ms: null, tti_ms: null })];
    const model = buildAuditReport(reportData(strongTradesSite(), failed));
    expect(model.state).toBe("provisional");
    expect(model.performance.strategies).toEqual([
      { strategy: "mobile", label: "Mobile", status: "failed", score: null, metrics: [], note: "Not measured: the performance provider could not analyse this page (provider_error)." },
      { strategy: "desktop", label: "Desktop", status: "failed", score: null, metrics: [], note: "Not measured: the performance provider could not analyse this page (timeout)." },
    ]);
    expect(model.performance.field).toEqual({ metrics: [], scopeLabel: null, sentence: null });
    expect(model.categories.find((category) => category.key === "performance")).toMatchObject({ evaluated: false, summary: "Not evaluated: The mobile performance measurement failed." });
  });

  it("not collected at all", () => {
    const model = buildAuditReport(reportData(strongTradesSite(), []));
    expect(model.performance.strategies.map((strategy) => [strategy.status, strategy.note])).toEqual([["not_collected", "Not measured for this audit."], ["not_collected", "Not measured for this audit."]]);
  });

  it("missing CrUX field data is stated as not evaluated, in evidence-only words", () => {
    const model = buildAuditReport(reportData(strongTradesSite(), strongPerformance(false)));
    expect(model.state).toBe("complete");
    expect(model.performance.field.sentence).toBe("Real-user (CrUX) data was not available for this URL. These field-data checks were not evaluated.");
    expect(model.performance.field.sentence).not.toMatch(/common|small sites|typically|usually/i);
  });
});

describe("findings", () => {
  const rows = [
    finding("missing_meta_description", "low", "page", { path: "/b", httpStatus: 200 }),
    finding("missing_meta_description", "low", "page", { path: "/a", httpStatus: 200 }),
    finding("page_noindex", "medium", "page", { path: "/old", metaRobots: "noindex" }),
    finding("page_noindex", "high", "page", { path: "/", metaRobots: "noindex" }),
    finding("no_localbusiness_schema", "medium", "site", { pagesCrawled: 9 }),
    finding("sitemap_missing", "low", "site", {}),
    finding("thin_page", "low", "page", { path: "/x", wordCount: 40, threshold: 150 }),
    finding("duplicate_title", "medium", "page", { path: "/p1", title: "Same", groupSize: 2 }),
    finding("duplicate_title", "medium", "page", { path: "/p2", title: "Same", groupSize: 2 }),
    finding("no_structured_data", "info", "page", { path: "/x" }),
    finding("challenge_page_detected", "info", "page", { path: "/contact" }),
  ];
  const model = buildAuditReport(reportData(weakSite(), weakPerformance(), { https: false }, { findings: rows }));

  it("groups by code, orders by severity then scope then reach, and keeps the six most important first", () => {
    expect(model.findingCount).toBe(7);
    expect(model.keyFindings.map((entry) => [entry.code, entry.severity, entry.affectedCount])).toEqual([["page_noindex", "high", 2], ["no_localbusiness_schema", "medium", 0], ["duplicate_title", "medium", 2], ["sitemap_missing", "low", 0], ["missing_meta_description", "low", 2], ["thin_page", "low", 1]]);
    expect(model.keyFindings[4].affectedPaths).toEqual(["/a", "/b"]);
  });

  it("groups the full list by report category", () => {
    expect(model.findingGroups.map((group) => [group.label, group.findings.map((entry) => entry.code)])).toEqual([
      ["Technical SEO", ["sitemap_missing", "missing_meta_description", "no_structured_data"]],
      ["Local SEO", ["no_localbusiness_schema"]],
      ["Content & Structure", ["duplicate_title", "thin_page"]],
      ["Crawl & Indexability", ["page_noindex"]],
    ]);
  });

  it("drops per-page values when an entry stands for several pages, and never lists operational challenge codes as findings", () => {
    expect(model.keyFindings.find((entry) => entry.code === "duplicate_title")?.evidence).toEqual([]);
    expect(model.keyFindings.find((entry) => entry.code === "thin_page")?.evidence).toEqual([{ label: "Visible words", value: "40" }, { label: "Configured limit", value: "150" }]);
    expect(JSON.stringify(model.findingGroups)).not.toContain("challenge_page_detected");
  });
});

describe("crawl scope and secondary challenge pages", () => {
  it("does not imply whole-site coverage when the crawl stopped at the page cap", () => {
    const model = buildAuditReport(reportData(strongTradesSite(), strongPerformance(true), { frontierRemaining: 23, pageCap: 15 }));
    expect(model.structure.scopeSentence).toBe("The crawl stopped at its 15-page limit with 23 discovered pages not evaluated. This report does not cover the whole website.");
  });

  it("says so when the scope was never recorded", () => {
    expect(buildAuditReport(reportData(strongTradesSite(), strongPerformance(true), { frontierRemaining: null })).structure.scopeSentence).toBe("Crawl scope was not recorded for this audit.");
  });

  it("notes pages excluded as browser-verification pages on a completed run", () => {
    const data = reportData(strongTradesSite(), strongPerformance(true));
    data.run.site_summary_json = { ...data.run.site_summary_json, challengePages: [{ path: "/contact", kind: "bot_challenge" }] };
    expect(buildAuditReport(data).crawlNotes).toEqual(["1 page answered with a browser-verification page and was not evaluated: /contact."]);
  });
});

describe("historical audit versions", () => {
  it("adds the notice from stored version fields alone, without changing the score, the findings or the state", () => {
    const current = reportData(strongTradesSite(), strongPerformance(true));
    const older = reportData(strongTradesSite(), strongPerformance(true), {}, { run: { crawler_version: "audit-crawler/v3", rules_version: "audit-rules/v3" }, score: { scoring_version: "audit-score/v1" } });
    const model = buildAuditReport(older);
    expect(model.historicalNotice).toEqual({ text: "This report was produced using an earlier audit version. Some safeguards available in newer audits were not present for this run.", versions: ["Crawler: audit-crawler/v3 (current: audit-crawler/v4)", "Rules: audit-rules/v3 (current: audit-rules/v4)", "Scoring: audit-score/v1 (current: audit-score/v2)"] });
    expect(model.state).toBe("complete");
    expect(model.blocked).toBeNull();
    expect(model.header.overallLabel).toBe(buildAuditReport(current).header.overallLabel);
    expect(model.categories).toEqual(buildAuditReport(current).categories);
    expect(model.header.versions).toEqual({ crawler: "audit-crawler/v3", rules: "audit-rules/v3", scoring: "audit-score/v1" });
  });

  it("flags a single older generation and ignores version strings it cannot parse", () => {
    expect(buildAuditReport(reportData(strongTradesSite(), strongPerformance(true), {}, { score: { scoring_version: "audit-score/v1" } })).historicalNotice?.versions).toEqual(["Scoring: audit-score/v1 (current: audit-score/v2)"]);
    expect(buildAuditReport(reportData(strongTradesSite(), strongPerformance(true), {}, { run: { crawler_version: "custom" } })).historicalNotice).toBeNull();
    expect(versionGeneration("audit-crawler/v12")).toBe(12);
    expect(versionGeneration("nonsense")).toBeNull();
  });
});

describe("helpers", () => {
  it("offers a report only once the crawl is over", () => {
    expect(["queued", "running", "completed", "blocked", "failed"].map((status) => isReportAvailable({ status: status as "queued" }))).toEqual([false, false, true, true, false]);
    expect(isReportAvailable(null)).toBe(false);
  });

  it("formats dates in fixed UTC, independent of locale", () => {
    expect(formatReportDate("2026-09-19T19:33:38.936+00:00")).toBe("19 September 2026");
    expect(formatReportDate("2026-01-05T04:07:00Z", true)).toBe("5 January 2026, 04:07 UTC");
    expect(formatReportDate(null)).toBe("Not recorded");
  });
});
