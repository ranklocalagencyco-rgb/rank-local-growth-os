import { describe, expect, it } from "vitest";

import { initialCrawlState, summariseSite } from "@/audit/crawler";
import { crossPageFindings, pageFindings, pageRuleContext, siteFindings } from "@/audit/findings";
import { buildLinkGraph, duplicateGroups, isMeaningfulRedirect, napSummary, schemaSummary } from "@/audit/site-evidence";
import type { WebsiteAuditPage } from "@/db/types";

// Rules that need more than one page: duplicates, homepage link coverage, orphan-like pages, NAP and schema completeness.
// Rows carry evidenceVersion 3 unless a test says otherwise.

let counter = 0;
function row(overrides: Partial<WebsiteAuditPage> = {}, evidence: Record<string, unknown> = {}): WebsiteAuditPage {
  counter += 1;
  const path = overrides.path ?? `/page-${counter}`;
  const url = `https://example.co.uk${path === "/" ? "/" : path}`;
  return {
    id: `p${counter}`, workspace_id: "w", audit_run_id: "r", prospect_id: "x", requested_url: url, final_url: url, path, discovered_via: "link", discovered_from: "https://example.co.uk/", page_role: "other",
    fetch_ok: true, fetch_error: null, http_status: 200, content_type: "text/html; charset=utf-8", redirect_count: 0, response_ms: 10, response_bytes: 100,
    title: `Title ${counter} | A&B Roofing`, meta_description: `Meta description number ${counter} for a page that is long enough to pass.`, h1_count: 1, h1_text: ["H"], h2_count: 1, canonical_url: url, meta_robots: null, noindex: false, nofollow: false, lang: "en", has_viewport: true,
    word_count: 400, internal_link_count: 3, external_link_count: 0, tel_link_count: 0, mailto_link_count: 0, form_count: 0, cta_count: 0, json_ld_count: 1, schema_types: ["WebPage"], has_structured_data: true,
    evidence_json: { evidenceVersion: 3, renderingMode: "server_rendered", redirectChain: [], links: [], nap: { phones: [], emails: [], postcodes: [], addressCandidates: [], businessNames: [], hasContactForm: false }, schema: null, ...evidence },
    fetched_at: "2026-09-15T10:00:00.000Z", created_at: "2026-09-15T10:00:00.000Z", ...overrides,
  };
}
const link = (url: string, text: string | null = null, group: string | null = null, region: "nav" | "header" | "footer" | "main" = "nav") => ({ url, text, region, group });
const nap = (extra: Partial<{ phones: unknown[]; emails: unknown[]; postcodes: unknown[]; addressCandidates: unknown[]; businessNames: unknown[] }>) => ({ phones: [], emails: [], postcodes: [], addressCandidates: [], businessNames: [], hasContactForm: false, ...extra });

function finalise(pages: WebsiteAuditPage[]) {
  const state = { ...initialCrawlState(), summary: { homepageUrl: "https://example.co.uk/", homepageFinalUrl: "https://example.co.uk/", homepageStatus: 200, robotsTxtReachable: true, sitemapReachable: true } };
  const summary = summariseSite(state, pages);
  const graph = buildLinkGraph(pages);
  const findings = [...pages.flatMap((page) => pageFindings(page, pageRuleContext(graph, page))), ...crossPageFindings(pages, summary), ...siteFindings(summary, pages)];
  return { summary, findings, codes: findings.map((finding) => `${finding.scope}:${finding.code}${finding.pageId ? `@${pages.find((page) => page.id === finding.pageId)?.path}` : ""}`) };
}

const homeWith = (links: ReturnType<typeof link>[], extra: Partial<WebsiteAuditPage> = {}, evidence: Record<string, unknown> = {}) =>
  row({ path: "/", page_role: "homepage", discovered_via: "homepage", discovered_from: null, schema_types: ["RoofingContractor", "WebPage"], ...extra }, { links, nap: nap({ phones: [{ raw: "01895 123456", digits: "01895123456", sources: ["tel_link"] }], addressCandidates: [{ text: "1 High St, Uxbridge, UB8 1AA", postcode: "UB8 1AA", source: "text:footer" }] }), schema: { localBusiness: { types: ["RoofingContractor"], name: "A&B", telephone: "01895 123456", address: { streetAddress: "1 High St", addressLocality: "Uxbridge", addressRegion: null, postalCode: "UB8 1AA", addressCountry: "GB" }, areaServed: ["Uxbridge"], geo: null, sameAs: [], openingHours: false, priceRange: false }, organization: null, aggregateRating: null, reviewCount: 0, hasService: false, breadcrumbNames: [] }, ...evidence });

describe("duplicate title and meta description detection", () => {
  it("flags every member of a duplicate group with the other paths, ignoring canonicalised copies and pre-v3 rows", () => {
    const pages = [
      homeWith([link("https://example.co.uk/a/"), link("https://example.co.uk/b/"), link("https://example.co.uk/c/"), link("https://example.co.uk/d/")]),
      row({ path: "/a", title: "Roofers | SC Roofing", meta_description: "Same meta description on more than one page of the site." }),
      row({ path: "/b", title: "roofers  |  sc roofing", meta_description: "Same meta description on more than one page of the site." }),
      row({ path: "/c", title: "Roofers | SC Roofing" }, { canonicalMatchesFinal: false }), // canonical points elsewhere: excluded
      row({ path: "/d", title: "Roofers | SC Roofing" }, { evidenceVersion: undefined }), // v2 row: excluded
    ];
    const { summary, codes, findings } = finalise(pages);
    expect(summary.duplicateTitleGroups).toEqual([{ title: "Roofers | SC Roofing", paths: ["/a", "/b"] }]);
    expect(summary.duplicateMetaGroups).toEqual([{ metaDescription: "Same meta description on more than one page of the site.", paths: ["/a", "/b"] }]);
    expect(summary.duplicateTitleMetaPairs).toHaveLength(1);
    expect(codes).toEqual(expect.arrayContaining(["page:duplicate_title@/a", "page:duplicate_title@/b", "page:duplicate_meta_description@/a", "page:duplicate_meta_description@/b"]));
    expect(codes.filter((code) => code.startsWith("page:duplicate_title"))).toHaveLength(2);
    expect(findings.find((finding) => finding.code === "duplicate_title")).toMatchObject({ severity: "medium", evidence: expect.objectContaining({ title: "Roofers | SC Roofing", otherPaths: ["/b"], groupSize: 2 }) });
    expect(findings.find((finding) => finding.code === "duplicate_meta_description")).toMatchObject({ severity: "low" });
  });

  it("treats the same page reached with and without a trailing slash as one page, not a duplicate", () => {
    const pages = [row({ path: "/a", requested_url: "https://example.co.uk/a", final_url: "https://example.co.uk/a/", title: "Same" }), row({ path: "/a", requested_url: "https://example.co.uk/a/", final_url: "https://example.co.uk/a/", title: "Same" })];
    expect(duplicateGroups(pages).titles).toEqual([]);
  });
});

describe("homepage link coverage and orphan-like pages", () => {
  it("flags service and location pages the homepage does not link to, ignoring hubs and slash differences", () => {
    const pages = [
      homeWith([link("https://example.co.uk/roof-repairs/", "Roof Repairs", "Services"), link("https://example.co.uk/uxbridge", "Uxbridge", "Areas We Cover"), link("https://example.co.uk/areas-we-cover/")]),
      row({ path: "/roof-repairs", page_role: "service", requested_url: "https://example.co.uk/roof-repairs", final_url: "https://example.co.uk/roof-repairs/" }),
      row({ path: "/guttering", page_role: "service", discovered_via: "sitemap", discovered_from: null }),
      row({ path: "/uxbridge", page_role: "location", requested_url: "https://example.co.uk/uxbridge/", final_url: "https://example.co.uk/uxbridge/" }),
      row({ path: "/ruislip", page_role: "location", discovered_via: "sitemap", discovered_from: null }, { links: [link("https://example.co.uk/guttering/")] }),
      row({ path: "/areas-we-cover", page_role: "location", discovered_via: "sitemap" }),
      row({ path: "/privacy", page_role: "other", discovered_via: "sitemap" }),
    ];
    const { summary, codes, findings } = finalise(pages);
    expect(codes.filter((code) => code.includes("not_linked_from_homepage"))).toEqual(["page:service_page_not_linked_from_homepage@/guttering", "page:location_page_not_linked_from_homepage@/ruislip"]);
    expect(findings.find((finding) => finding.code === "service_page_not_linked_from_homepage")).toMatchObject({ severity: "low", evidence: expect.objectContaining({ homepageLinkCount: 3, linkedFrom: ["/ruislip"], discoveredVia: "sitemap" }) });
    expect(summary.homepageLinkCount).toBe(3);
    expect(summary.pagesWithoutInboundLinks).toEqual(["/ruislip", "/privacy"]);
    expect(summary.locationPages).toEqual([{ path: "/uxbridge", locality: null, hub: false }, { path: "/ruislip", locality: null, hub: false }, { path: "/areas-we-cover", locality: null, hub: true }]);
    expect(codes).not.toContain("site:location_pages_missing");
  });

  it("suppresses coverage rules when the homepage evidence is truncated, client-rendered or pre-v3", () => {
    const location = () => row({ path: "/ruislip", page_role: "location" });
    expect(finalise([homeWith([link("https://example.co.uk/x")], {}, { linksTruncated: true }), location()]).codes).not.toContain("page:location_page_not_linked_from_homepage@/ruislip");
    expect(finalise([homeWith([], {}, { renderingMode: "client_rendered_likely" }), location()]).codes.join(" ")).not.toContain("not_linked_from_homepage");
    expect(finalise([homeWith([], {}, { evidenceVersion: undefined }), location()]).codes.join(" ")).not.toContain("not_linked_from_homepage");
    expect(finalise([homeWith([link("https://example.co.uk/x")]), location()]).codes).toContain("page:location_page_not_linked_from_homepage@/ruislip");
  });
});

describe("internal redirects and broken links across the crawl", () => {
  it("records meaningful redirects with who links to them, and ignores slash-only hops", () => {
    expect(isMeaningfulRedirect("https://example.co.uk/x", "https://example.co.uk/x/")).toBe(false);
    expect(isMeaningfulRedirect("http://example.co.uk/x", "https://example.co.uk/x/")).toBe(true);
    expect(isMeaningfulRedirect("https://example.co.uk/x", "https://www.example.co.uk/x")).toBe(true);
    expect(isMeaningfulRedirect("https://example.co.uk/old", "https://example.co.uk/new")).toBe(true);
    expect(isMeaningfulRedirect("https://example.co.uk/x", null)).toBe(false);
    const pages = [
      homeWith([link("http://example.co.uk/old-page", "Old"), link("https://example.co.uk/missing", "Gone"), link("https://example.co.uk/guttering/")]),
      row({ path: "/new-page", requested_url: "http://example.co.uk/old-page", final_url: "https://example.co.uk/new-page", redirect_count: 1, discovered_via: "sitemap", discovered_from: null }, { redirectChain: ["http://example.co.uk/old-page"] }),
      row({ path: "/guttering", requested_url: "https://example.co.uk/guttering", final_url: "https://example.co.uk/guttering/", redirect_count: 1 }),
      row({ path: "/missing", http_status: 404, title: null, discovered_via: "link" }),
    ];
    const { summary, findings } = finalise(pages);
    expect(summary.internalRedirects).toEqual([{ requestedUrl: "http://example.co.uk/old-page", finalUrl: "https://example.co.uk/new-page", linkedFrom: ["/"] }]);
    expect(findings.filter((finding) => finding.code === "internal_link_redirect")).toHaveLength(1);
    expect(findings.find((finding) => finding.code === "internal_link_redirect")?.evidence).toMatchObject({ linkedFrom: ["/"], redirectChain: ["http://example.co.uk/old-page"] });
    expect(findings.find((finding) => finding.code === "broken_internal_link")?.evidence).toMatchObject({ linkedFrom: ["/"], anchorText: ["Gone"] });
    expect(summary.brokenInternalLinks).toBe(1);
  });
});

describe("site-level NAP, location and schema rules", () => {
  it("aggregates NAP evidence with page counts and provenance and stays silent when phone and address exist", () => {
    const pages = [homeWith([]), row({ path: "/contact", page_role: "contact" }, { nap: nap({ phones: [{ raw: "01895 123456", digits: "01895123456", sources: ["text:main"] }], emails: [{ value: "hi@example.co.uk", sources: ["mailto_link"] }] }) })];
    const { summary, codes } = finalise(pages);
    expect(summary.nap).toMatchObject({ phones: [{ digits: "01895123456", pages: 3, sources: ["tel_link", "schema", "text:main"] }], emails: [{ value: "hi@example.co.uk", pages: 1 }], addressCandidates: [{ text: "1 High St, Uxbridge, UB8 1AA", pages: 1 }], pagesWithPhone: 2, pagesWithAddressCandidate: 1, pagesEvaluated: 2, localities: [{ value: "Uxbridge", sources: ["schema_address_locality"] }] });
    expect(codes).not.toContain("site:nap_phone_missing");
    expect(codes).not.toContain("site:nap_address_missing");
    expect(codes).not.toContain("site:localbusiness_schema_incomplete");
    expect(codes).not.toContain("site:no_localbusiness_schema");
  });

  it("flags missing phone and address only when no crawled page carries them from any source", () => {
    const bare = row({ path: "/", page_role: "homepage", discovered_via: "homepage", discovered_from: null });
    const { summary, codes, findings } = finalise([bare, row({ path: "/about", page_role: "about" })]);
    expect(summary.nap?.phones).toEqual([]);
    expect(codes).toEqual(expect.arrayContaining(["site:nap_phone_missing", "site:nap_address_missing", "site:location_pages_missing"]));
    expect(findings.find((finding) => finding.code === "nap_phone_missing")).toMatchObject({ severity: "medium", evidence: expect.objectContaining({ pagesEvaluated: 2, sourcesChecked: expect.arrayContaining(["tel_link", "schema"]) }) });
    // A schema-only address or a postcode from schema counts as an address.
    const schemaAddress = finalise([row({ path: "/", page_role: "homepage", discovered_via: "homepage" }, { schema: { localBusiness: { types: ["Plumber"], name: "P", telephone: null, address: { streetAddress: "1 Rd", addressLocality: "Hayes", addressRegion: null, postalCode: "UB3 1AA", addressCountry: null }, areaServed: [], geo: null, sameAs: [], openingHours: false, priceRange: false }, organization: null, aggregateRating: null, reviewCount: 0, hasService: false, breadcrumbNames: [] } })]).codes;
    expect(schemaAddress).not.toContain("site:nap_address_missing");
    expect(schemaAddress).toContain("site:nap_phone_missing");
  });

  it("flags an incomplete LocalBusiness schema with the missing fields, never alongside no_localbusiness_schema", () => {
    const partial = { localBusiness: { types: ["RoofingContractor"], name: "A&B", telephone: null, address: { streetAddress: "1 High St", addressLocality: null, addressRegion: null, postalCode: null, addressCountry: null }, areaServed: [], geo: null, sameAs: [], openingHours: false, priceRange: false }, organization: null, aggregateRating: null, reviewCount: 0, hasService: false, breadcrumbNames: [] };
    const pages = [row({ path: "/", page_role: "homepage", discovered_via: "homepage", schema_types: ["RoofingContractor"] }, { schema: partial })];
    const { summary, codes, findings } = finalise(pages);
    expect(summary.schema).toMatchObject({ localBusinessPages: 1, localBusinessTypes: ["RoofingContractor"], hasName: true, hasTelephone: false, hasAddress: false, localBusinessMissingFields: ["telephone", "address"] });
    expect(codes).toContain("site:localbusiness_schema_incomplete");
    expect(codes).not.toContain("site:no_localbusiness_schema");
    expect(findings.find((finding) => finding.code === "localbusiness_schema_incomplete")).toMatchObject({ severity: "low", evidence: expect.objectContaining({ missingFields: ["telephone", "address"], localBusinessPages: 1 }) });
    // Organization-only sites keep the existing no_localbusiness_schema finding and nothing about completeness.
    const orgOnly = finalise([row({ path: "/", page_role: "homepage", discovered_via: "homepage", schema_types: ["Organization"] }, { schema: { ...partial, localBusiness: null, organization: { name: "SC Roofing", telephone: null, address: null, sameAs: [], logo: true } } })]).codes;
    expect(orgOnly).toContain("site:no_localbusiness_schema");
    expect(orgOnly).not.toContain("site:localbusiness_schema_incomplete");
    expect(schemaSummary([]).localBusinessMissingFields).toEqual([]);
    expect(napSummary([]).pagesEvaluated).toBe(0);
  });

  it("records service pages, location pages with localities, and service × location combinations", () => {
    const pages = [
      homeWith([]),
      row({ path: "/new-roofs", page_role: "service" }, { service: "New Roofs", headingPattern: { source: "h1", subject: "New Roofs", preposition: "in", places: ["Uxbridge", "Hillingdon"] } }),
      row({ path: "/uxbridge", page_role: "location" }, { locality: "Uxbridge", headingPattern: { source: "h1", subject: "Roofers", preposition: "in", places: ["Uxbridge"] } }),
      row({ path: "/gallery", page_role: "gallery" }),
      row({ path: "/blog/tips", page_role: "blog" }),
    ];
    const { summary } = finalise(pages);
    expect(summary).toMatchObject({ evidenceVersion: 3, galleryPagesFound: 1, blogPagesFound: 1, servicePages: [{ path: "/new-roofs", service: "New Roofs" }], locationPages: [{ path: "/uxbridge", locality: "Uxbridge", hub: false }], serviceLocationCombos: [{ path: "/new-roofs", service: "New Roofs", locality: "Uxbridge" }, { path: "/new-roofs", service: "New Roofs", locality: "Hillingdon" }] });
    expect(summary.nap?.localities.map((entry) => entry.value)).toEqual(["Uxbridge", "Hillingdon"]);
  });
});
