import { describe, expect, it } from "vitest";

import { AUDIT_RULES_VERSION, pageFindings, siteFindings, type PageForRules, type SiteSummary } from "@/audit/findings";

function page(overrides: Partial<PageForRules> = {}): PageForRules {
  return { id: "p1", requested_url: "https://example.co.uk/x", final_url: "https://example.co.uk/x", path: "/x", page_role: "other", fetch_ok: true, fetch_error: null, http_status: 200, content_type: "text/html; charset=utf-8", discovered_from: null, title: "T", meta_description: "D", h1_count: 1, h1_text: ["T"], canonical_url: "https://example.co.uk/x", meta_robots: null, noindex: false, has_viewport: true, json_ld_count: 1, schema_types: ["WebPage"], has_structured_data: true, ...overrides };
}

const summary: SiteSummary = { homepageUrl: "https://example.co.uk/", homepageFinalUrl: "https://example.co.uk/", homepageHttps: true, homepageStatus: 200, homepageRedirectChain: [], robotsTxtReachable: true, robotsDisallowAll: false, sitemapReachable: true, sitemapUrlsDiscovered: 3, sitemapUrlsSameSite: 3, pagesCrawled: 1, pagesFailed: 0, servicePagesFound: 1, locationPagesFound: 0, contactPageFound: true, aboutPageFound: false, testimonialsPageFound: false, pagesWithLocalBusinessSchema: 1, schemaTypesSeen: ["LocalBusiness"], brokenInternalLinks: 0 };

describe("deterministic findings", () => {
  it("versioned rule set", () => {
    expect(AUDIT_RULES_VERSION).toBe("audit-rules/v1");
  });

  it("produces no page findings for a well-formed page", () => {
    expect(pageFindings(page())).toEqual([]);
  });

  it("flags each explicit page rule with evidence", () => {
    const codes = pageFindings(page({ title: null, meta_description: null, h1_count: 0, h1_text: [], canonical_url: null, noindex: true, meta_robots: "noindex", has_viewport: false, json_ld_count: 0, schema_types: [], has_structured_data: false })).map((f) => [f.code, f.severity]);
    expect(codes).toEqual([["missing_title", "medium"], ["missing_meta_description", "low"], ["missing_h1", "medium"], ["missing_canonical", "low"], ["page_noindex", "medium"], ["missing_viewport", "low"], ["no_structured_data", "info"]]);
    const multi = pageFindings(page({ h1_count: 3, h1_text: ["a", "b", "c"] }));
    expect(multi).toEqual([{ scope: "page", code: "multiple_h1", severity: "low", pageId: "p1", evidence: expect.objectContaining({ h1Count: 3, h1Text: ["a", "b", "c"], path: "/x" }) }]);
    expect(pageFindings(page({ page_role: "homepage", noindex: true }))[0]).toMatchObject({ code: "page_noindex", severity: "high" });
  });

  it("does not judge pages that were not successfully parsed, except broken internal links", () => {
    expect(pageFindings(page({ fetch_ok: false, fetch_error: "timeout", http_status: null, title: null }))).toEqual([]);
    expect(pageFindings(page({ http_status: 500, title: null }))).toEqual([]);
    expect(pageFindings(page({ content_type: "application/pdf", title: null }))).toEqual([]);
    expect(pageFindings(page({ http_status: 404, discovered_from: "https://example.co.uk/", title: null }))).toEqual([{ scope: "page", code: "broken_internal_link", severity: "medium", pageId: "p1", evidence: expect.objectContaining({ discoveredFrom: "https://example.co.uk/", httpStatus: 404 }) }]);
    expect(pageFindings(page({ http_status: 404, discovered_from: null, title: null }))).toEqual([]);
  });

  it("flags site-level gaps from the summary and stored pages", () => {
    const pages = [page({ page_role: "homepage", schema_types: ["WebSite"] }), page({ id: "p2", page_role: "other" })];
    const codes = siteFindings({ ...summary, homepageHttps: false, robotsTxtReachable: false, sitemapReachable: false, schemaTypesSeen: ["WebSite"] }, pages).map((f) => `${f.code}:${f.severity}`);
    expect(codes).toEqual(["homepage_not_https:high", "no_localbusiness_schema:medium", "no_contact_page_detected:medium", "no_service_pages_detected:low", "robots_txt_missing:info", "sitemap_missing:low"]);
    const good = siteFindings(summary, [page({ page_role: "homepage", schema_types: ["RoofingContractor"] }), page({ id: "p2", page_role: "contact" }), page({ id: "p3", page_role: "service" })]);
    expect(good).toEqual([]);
  });

  it("does not raise site findings that need pages when nothing was crawled", () => {
    const none = siteFindings({ ...summary, pagesCrawled: 0 }, []).map((f) => f.code);
    expect(none).not.toContain("no_localbusiness_schema");
    expect(none).not.toContain("no_contact_page_detected");
  });
});
