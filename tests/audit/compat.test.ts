import { describe, expect, it } from "vitest";

import { initialCrawlState, parseCrawlState, summariseSite } from "@/audit/crawler";
import { crossPageFindings, pageFindings, siteFindings } from "@/audit/findings";
import { buildLinkGraph, evidenceVersionOf, napSummary, readEvidenceV3, schemaSummary } from "@/audit/site-evidence";
import type { WebsiteAuditPage } from "@/db/types";
import { findingLabel, pageRoleLabel } from "@/domain/audit";

// Rows written by audit-crawler/v2 (the live SC Roofing run of 2026-09-17) must stay readable and must never be judged
// by v3 rules. The evidence_json shape below is exactly what v2 stored.

const at = "2026-09-17T08:09:20.000Z";
function v2Row(path: string, role: WebsiteAuditPage["page_role"], overrides: Partial<WebsiteAuditPage> = {}): WebsiteAuditPage {
  const url = `https://scroofinguxbridge.co.uk${path}`;
  return {
    id: `id-${path}`, workspace_id: "w", audit_run_id: "run", prospect_id: "p", requested_url: url, final_url: `${url}${path === "/" ? "" : "/"}`, path, discovered_via: path === "/" ? "homepage" : "sitemap", discovered_from: null, page_role: role,
    fetch_ok: true, fetch_error: null, http_status: 200, content_type: "text/html; charset=UTF-8", redirect_count: path === "/" ? 0 : 1, response_ms: 300, response_bytes: 200000,
    title: `Roofers | ${path.slice(1) || "Uxbridge and Hillingdon"} | SC Roofing`, meta_description: "d", h1_count: 1, h1_text: ["Roofers in Uxbridge"], h2_count: 3, canonical_url: `${url}/`, meta_robots: null, noindex: false, nofollow: false, lang: "en-GB", has_viewport: true,
    word_count: 870, internal_link_count: 16, external_link_count: 3, tel_link_count: 12, mailto_link_count: 4, form_count: 0, cta_count: 14, json_ld_count: 1, schema_types: ["BreadcrumbList", "Organization", "WebPage", "WebSite"], has_structured_data: true,
    evidence_json: { redirectChain: path === "/" ? [] : [url], externalHosts: ["facebook.com"], ctaSamples: ["Contact Us"], jsonLdParseErrors: 0, hasLocalBusinessSchema: false, canonicalMatchesFinal: true, renderingMode: "server_rendered", renderingSignals: { wordCount: 870, headingCount: 5, linkCount: 19, formCount: 0, scriptCount: 20, moduleScriptCount: 0, appBundleScriptCount: 0, emptyAppRoot: false } },
    fetched_at: at, created_at: at, ...overrides,
  };
}

const v2Pages = [v2Row("/", "homepage"), v2Row("/new-roofs", "service"), v2Row("/areas-we-cover", "location"), v2Row("/contact-us", "contact"), v2Row("/reviews", "testimonials"), v2Row("/gallery", "other"), v2Row("/uxbridge", "other"), v2Row("/ruislip", "other")];
const v2State = { phase: "finalize", siteDomain: "scroofinguxbridge.co.uk", frontier: [], visited: ["scroofinguxbridge.co.uk/"], finalKeys: ["scroofinguxbridge.co.uk/"], duplicateRedirects: 0, auxRequests: 3, summary: { homepageUrl: "https://scroofinguxbridge.co.uk", homepageFinalUrl: "https://scroofinguxbridge.co.uk/", homepageStatus: 200, homepageRedirectChain: [], robotsTxtReachable: true, robotsDisallowAll: false, sitemapReachable: true, sitemapUrlsDiscovered: 15, sitemapUrlsSameSite: 15 } };

describe("audit-crawler/v2 evidence compatibility", () => {
  it("reads v2 rows as version 0 with empty v3 evidence instead of throwing", () => {
    for (const page of v2Pages) {
      expect(evidenceVersionOf(page)).toBe(0);
      expect(readEvidenceV3(page)).toBeNull();
    }
    expect(buildLinkGraph(v2Pages)).toMatchObject({ homepageKeys: null, homepageLinkCount: null, truncated: false });
    expect(buildLinkGraph(v2Pages).inbound.size).toBe(0);
    expect(napSummary(v2Pages)).toMatchObject({ phones: [], addressCandidates: [], pagesEvaluated: 0 });
    expect(schemaSummary(v2Pages)).toMatchObject({ localBusinessPages: 0, localBusinessMissingFields: [] });
  });

  it("rehydrates a v2 crawl state without link context and summarises v2 pages without v3 fields", () => {
    const state = parseCrawlState(v2State);
    expect(state.linkContext).toEqual({});
    expect(state.phase).toBe("finalize");
    const summary = summariseSite(state, v2Pages);
    expect(summary).toMatchObject({ pagesCrawled: 8, servicePagesFound: 1, locationPagesFound: 1, contactPageFound: true, testimonialsPageFound: true, pagesWithLocalBusinessSchema: 0, homepageHttps: true, renderedContentEvaluated: true });
    expect(summary.evidenceVersion).toBeUndefined();
    expect(summary.nap).toBeUndefined();
    expect(summary.locationPages).toBeUndefined();
    expect(summary.duplicateTitleGroups).toBeUndefined();
    expect(summariseSite(initialCrawlState(), [])).toMatchObject({ pagesCrawled: 0, homepageUrl: "" });
  });

  it("emits exactly the v2 findings for v2 rows and no v3 codes, even though the titles and meta are short", () => {
    const state = parseCrawlState(v2State);
    const summary = summariseSite(state, v2Pages);
    const findings = [...v2Pages.flatMap((page) => pageFindings(page)), ...crossPageFindings(v2Pages, summary), ...siteFindings(summary, v2Pages)];
    expect(findings.map((finding) => `${finding.scope}:${finding.code}`)).toEqual(["site:no_localbusiness_schema"]);
    for (const finding of findings) expect(findingLabel(finding.code)).not.toBe(finding.code);
  });

  it("keeps labels for every stored role, including the new ones and unknown values", () => {
    expect(pageRoleLabel("location")).toBe("Location");
    expect(pageRoleLabel("gallery")).toBe("Gallery");
    expect(pageRoleLabel("blog")).toBe("Blog");
    expect(pageRoleLabel("other")).toBe("Other");
    expect(pageRoleLabel("mystery" as WebsiteAuditPage["page_role"])).toBe("Other");
  });
});
