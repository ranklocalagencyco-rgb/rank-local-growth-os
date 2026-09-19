import { describe, expect, it } from "vitest";

import { AUDIT_RULES_VERSION, pageFindings, siteFindings, type PageForRules, type SiteSummary } from "@/audit/findings";
import { META_DESCRIPTION_MAX_CHARS, META_DESCRIPTION_MIN_CHARS, THIN_PAGE_MIN_WORDS, TITLE_MAX_CHARS, TITLE_MIN_CHARS } from "@/audit/thresholds";

function page(overrides: Partial<PageForRules> = {}): PageForRules {
  return { id: "p1", requested_url: "https://example.co.uk/x", final_url: "https://example.co.uk/x", path: "/x", page_role: "other", fetch_ok: true, fetch_error: null, http_status: 200, content_type: "text/html; charset=utf-8", discovered_via: "link", discovered_from: null, title: "T", meta_description: "D", h1_count: 1, h1_text: ["T"], h2_count: 1, canonical_url: "https://example.co.uk/x", meta_robots: null, noindex: false, has_viewport: true, word_count: 400, redirect_count: 0, json_ld_count: 1, schema_types: ["WebPage"], has_structured_data: true, evidence_json: {}, ...overrides };
}

/** A well-formed v3 page: every v3 rule is silent on it. */
function v3(overrides: Partial<PageForRules> = {}, evidence: Record<string, unknown> = {}): PageForRules {
  const title = "Roof Repairs in Uxbridge | A&B Roofing";
  const meta = "Family-run roofers covering Uxbridge and Hillingdon with free quotes on repairs and new roofs.";
  return page({ title, meta_description: meta, evidence_json: { evidenceVersion: 3, renderingMode: "server_rendered", titleLength: title.length, metaDescriptionLength: meta.length, h1EmptyCount: 0, ...evidence }, ...overrides });
}

const summary: SiteSummary = { homepageUrl: "https://example.co.uk/", homepageFinalUrl: "https://example.co.uk/", homepageHttps: true, homepageStatus: 200, homepageRedirectChain: [], robotsTxtReachable: true, robotsDisallowAll: false, sitemapReachable: true, sitemapUrlsDiscovered: 3, sitemapUrlsSameSite: 3, pagesCrawled: 1, pagesFailed: 0, servicePagesFound: 1, locationPagesFound: 0, contactPageFound: true, aboutPageFound: false, testimonialsPageFound: false, pagesWithLocalBusinessSchema: 1, schemaTypesSeen: ["LocalBusiness"], brokenInternalLinks: 0, clientRenderedPages: 0, homepageRenderingMode: "server_rendered", renderedContentEvaluated: true };

describe("deterministic findings", () => {
  it("versioned rule set", () => {
    expect(AUDIT_RULES_VERSION).toBe("audit-rules/v4");
  });

  it("produces no page findings for a well-formed page", () => {
    expect(pageFindings(page())).toEqual([]);
    expect(pageFindings(v3())).toEqual([]);
  });

  it("flags each explicit page rule with evidence", () => {
    const codes = pageFindings(page({ title: null, meta_description: null, h1_count: 0, h1_text: [], canonical_url: null, noindex: true, meta_robots: "noindex", has_viewport: false, json_ld_count: 0, schema_types: [], has_structured_data: false })).map((f) => [f.code, f.severity]);
    expect(codes).toEqual([["missing_title", "medium"], ["missing_meta_description", "low"], ["missing_h1", "medium"], ["missing_canonical", "low"], ["page_noindex", "medium"], ["missing_viewport", "low"], ["no_structured_data", "info"]]);
    const multi = pageFindings(page({ h1_count: 3, h1_text: ["a", "b", "c"] }));
    expect(multi).toMatchObject([{ scope: "page", code: "multiple_h1", severity: "low", pageId: "p1", evidence: expect.objectContaining({ h1Count: 3, h1Text: ["a", "b", "c"], path: "/x" }) }]);
    expect(pageFindings(page({ page_role: "homepage", noindex: true }))[0]).toMatchObject({ code: "page_noindex", severity: "high" });
  });

  it("does not judge pages that were not successfully parsed, except broken internal links", () => {
    expect(pageFindings(page({ fetch_ok: false, fetch_error: "timeout", http_status: null, title: null }))).toEqual([]);
    expect(pageFindings(page({ http_status: 500, title: null }))).toEqual([]);
    expect(pageFindings(page({ content_type: "application/pdf", title: null }))).toEqual([]);
    expect(pageFindings(page({ http_status: 404, discovered_from: "https://example.co.uk/", title: null }))).toMatchObject([{ scope: "page", code: "broken_internal_link", severity: "medium", pageId: "p1", evidence: expect.objectContaining({ discoveredFrom: "https://example.co.uk/", httpStatus: 404 }) }]);
    expect(pageFindings(page({ http_status: 404, discovered_from: null, title: null }))).toEqual([]);
  });

  it("enriches broken internal links with every crawled page that links to them", () => {
    const broken = pageFindings(page({ http_status: 404, discovered_from: "https://example.co.uk/" }), { linkedFrom: [{ path: "/", text: "Old" }, { path: "/about", text: null }] });
    expect(broken[0].evidence).toMatchObject({ linkedFrom: ["/", "/about"], anchorText: ["Old"] });
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

describe("audit-rules/v3 page rules", () => {
  const codes = (input: PageForRules) => pageFindings(input).map((f) => f.code);

  it("applies title and meta description thresholds at the documented boundaries", () => {
    const title = (length: number) => "t".repeat(length);
    const meta = (length: number) => "m".repeat(length);
    expect(codes(v3({ title: title(TITLE_MIN_CHARS - 1) }, { titleLength: TITLE_MIN_CHARS - 1 }))).toContain("title_too_short");
    expect(codes(v3({ title: title(TITLE_MIN_CHARS) }, { titleLength: TITLE_MIN_CHARS }))).not.toContain("title_too_short");
    expect(codes(v3({ title: title(TITLE_MAX_CHARS) }, { titleLength: TITLE_MAX_CHARS }))).not.toContain("title_too_long");
    expect(codes(v3({ title: title(TITLE_MAX_CHARS + 1) }, { titleLength: TITLE_MAX_CHARS + 1 }))).toContain("title_too_long");
    expect(codes(v3({ meta_description: meta(META_DESCRIPTION_MIN_CHARS - 1) }, { metaDescriptionLength: META_DESCRIPTION_MIN_CHARS - 1 }))).toContain("meta_description_too_short");
    expect(codes(v3({ meta_description: meta(META_DESCRIPTION_MIN_CHARS) }, { metaDescriptionLength: META_DESCRIPTION_MIN_CHARS }))).not.toContain("meta_description_too_short");
    expect(codes(v3({ meta_description: meta(META_DESCRIPTION_MAX_CHARS) }, { metaDescriptionLength: META_DESCRIPTION_MAX_CHARS }))).not.toContain("meta_description_too_long");
    expect(codes(v3({ meta_description: meta(META_DESCRIPTION_MAX_CHARS + 1) }, { metaDescriptionLength: META_DESCRIPTION_MAX_CHARS + 1 }))).toContain("meta_description_too_long");
    const short = pageFindings(v3({ title: "Gallery | SC Roofing" }, { titleLength: 20 }));
    expect(short.map((f) => f.code)).not.toContain("title_too_short");
    const evidence = pageFindings(v3({ title: "Gallery | SC Roof" }, { titleLength: 17 })).find((f) => f.code === "title_too_short");
    expect(evidence).toMatchObject({ severity: "low", evidence: expect.objectContaining({ title: "Gallery | SC Roof", titleLength: 17, threshold: TITLE_MIN_CHARS }) });
    expect(pageFindings(v3({ meta_description: "m".repeat(200) }, { metaDescriptionLength: 200 }))[0]).toMatchObject({ code: "meta_description_too_long", severity: "info" });
  });

  it("falls back to the stored text length when the v3 length field is absent, and never fires length rules on missing text", () => {
    expect(codes(v3({ title: "Tiny" }, { titleLength: undefined }))).toContain("title_too_short");
    const missing = codes(v3({ title: null, meta_description: null }, { titleLength: 0, metaDescriptionLength: 0 }));
    expect(missing).toEqual(["missing_title", "missing_meta_description"]);
  });

  it("flags thin pages below the word threshold except contact and gallery pages, and never on app shells", () => {
    expect(codes(v3({ word_count: THIN_PAGE_MIN_WORDS - 1 }))).toContain("thin_page");
    expect(codes(v3({ word_count: THIN_PAGE_MIN_WORDS }))).not.toContain("thin_page");
    expect(codes(v3({ word_count: 10, page_role: "contact" }))).not.toContain("thin_page");
    expect(codes(v3({ word_count: 10, page_role: "gallery" }))).not.toContain("thin_page");
    expect(codes(v3({ word_count: 10, page_role: "service" }))).toContain("thin_page");
    expect(codes(v3({ word_count: 0 }, { renderingMode: "client_rendered_likely" }))).not.toContain("thin_page");
    expect(pageFindings(v3({ word_count: 12 })).find((f) => f.code === "thin_page")).toMatchObject({ severity: "low", evidence: expect.objectContaining({ wordCount: 12, threshold: THIN_PAGE_MIN_WORDS }) });
  });

  it("flags an empty H1 only when an H1 element exists without text", () => {
    expect(codes(v3({ h1_count: 1, h1_text: [] }, { h1EmptyCount: 1 }))).toContain("h1_empty");
    expect(codes(v3({ h1_count: 2, h1_text: ["Roofers"] }, { h1EmptyCount: 1 }))).toEqual(expect.arrayContaining(["multiple_h1", "h1_empty"]));
    expect(codes(v3({ h1_count: 1, h1_text: ["Roofers"] }, { h1EmptyCount: 0 }))).not.toContain("h1_empty");
    expect(codes(v3({ h1_count: 0, h1_text: [] }, { h1EmptyCount: 0 }))).not.toContain("h1_empty");
  });

  it("flags internal links through meaningful redirects, ignoring trailing-slash-only hops", () => {
    const redirect = (requested: string, final: string, extra: Partial<PageForRules> = {}) => pageFindings(v3({ requested_url: requested, final_url: final, redirect_count: 1, discovered_via: "link", discovered_from: "https://example.co.uk/", ...extra }, { redirectChain: [requested] }), null);
    expect(redirect("http://example.co.uk/x", "https://example.co.uk/x").map((f) => f.code)).toContain("internal_link_redirect");
    expect(redirect("https://example.co.uk/x", "https://www.example.co.uk/x").map((f) => f.code)).toContain("internal_link_redirect");
    expect(redirect("https://example.co.uk/old", "https://example.co.uk/x").map((f) => f.code)).toContain("internal_link_redirect");
    expect(redirect("https://example.co.uk/x", "https://example.co.uk/x/").map((f) => f.code)).not.toContain("internal_link_redirect");
    expect(redirect("https://example.co.uk/X/", "https://example.co.uk/x").map((f) => f.code)).not.toContain("internal_link_redirect");
    // Sitemap-discovered pages are only "internal links" when a crawled page links to them.
    expect(pageFindings(v3({ requested_url: "http://example.co.uk/x", final_url: "https://example.co.uk/x", redirect_count: 1, discovered_via: "sitemap" }), null).map((f) => f.code)).not.toContain("internal_link_redirect");
    expect(pageFindings(v3({ requested_url: "http://example.co.uk/x", final_url: "https://example.co.uk/x", redirect_count: 1, discovered_via: "sitemap" }), { linkedFrom: [{ path: "/", text: "x" }] }).find((f) => f.code === "internal_link_redirect")).toMatchObject({ severity: "low", evidence: expect.objectContaining({ requestedUrl: "http://example.co.uk/x", finalUrl: "https://example.co.uk/x", linkedFrom: ["/"] }) });
  });

  it("never applies v3 rules to rows written by older crawlers", () => {
    const old = page({ title: "Tiny", meta_description: "d", word_count: 3, h1_count: 1, h1_text: [], redirect_count: 1, requested_url: "http://example.co.uk/x", final_url: "https://example.co.uk/x", evidence_json: { renderingMode: "server_rendered" } });
    expect(codes(old)).toEqual([]);
  });
});
