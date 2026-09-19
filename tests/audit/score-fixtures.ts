import { initialCrawlState, summariseSite } from "@/audit/crawler";
import type { AuditScoreInput } from "@/audit/score/calculate";
import type { WebsiteAuditPage, WebsitePerformanceObservation } from "@/db/types";

// Shared builders for the audit-score tests. Site summaries are produced by the real summariseSite() so the score is tested
// against exactly the evidence shape the audit job stores. Not a test file (no .test suffix).

const at = "2026-09-19T10:00:00.000Z";
const origin = "https://example-roofing.co.uk";

export function page(path: string, overrides: Partial<WebsiteAuditPage> = {}, evidence: Record<string, unknown> = {}): WebsiteAuditPage {
  const url = `${origin}${path}`;
  const title = overrides.title === undefined ? `Roofing page ${path} | Example Roofing` : overrides.title;
  const meta = overrides.meta_description === undefined ? `Example Roofing page ${path}: a description long enough to be useful.` : overrides.meta_description;
  return {
    id: `page:${path}`, workspace_id: "w", audit_run_id: "r", prospect_id: "x", requested_url: url, final_url: url, path, discovered_via: path === "/" ? "homepage" : "link", discovered_from: path === "/" ? null : `${origin}/`, page_role: path === "/" ? "homepage" : "other",
    fetch_ok: true, fetch_error: null, http_status: 200, content_type: "text/html; charset=utf-8", redirect_count: 0, response_ms: 10, response_bytes: 100,
    h1_count: 1, h1_text: ["Heading"], h2_count: 2, canonical_url: url, meta_robots: null, noindex: false, nofollow: false, lang: "en", has_viewport: true,
    word_count: 400, internal_link_count: 5, external_link_count: 0, tel_link_count: 1, mailto_link_count: 0, form_count: 0, cta_count: 1, json_ld_count: 1, schema_types: ["WebPage"], has_structured_data: true,
    fetched_at: at, created_at: at,
    ...overrides,
    title,
    meta_description: meta,
    evidence_json: { evidenceVersion: 3, renderingMode: "server_rendered", redirectChain: [], links: [], titleLength: title?.length ?? 0, metaDescriptionLength: meta?.length ?? 0, h1EmptyCount: 0, nap: { phones: [], emails: [], postcodes: [], addressCandidates: [], businessNames: [], hasContactForm: false }, schema: null, ...evidence },
  };
}

export const link = (path: string) => ({ url: `${origin}${path}`, text: path, region: "nav" as const, group: null });

export function observation(strategy: "mobile" | "desktop", overrides: Partial<WebsitePerformanceObservation> = {}): WebsitePerformanceObservation {
  return {
    id: `obs-${strategy}`, workspace_id: "w", prospect_id: "x", audit_run_id: "r", provider: "pagespeed", provider_version: "12.6.0", strategy, page_role: "homepage", requested_url: `${origin}/`, final_url: `${origin}/`, status: "succeeded", attempts: 1, error_code: null, error_summary: null,
    performance_score: 90, accessibility_score: 90, best_practices_score: 100, seo_score: 92, fcp_ms: 1500, lcp_ms: 2100, cls: 0.02, tbt_ms: 120, speed_index_ms: 2500, tti_ms: 3000,
    field_data_available: false, field_scope: null, field_lcp_ms: null, field_inp_ms: null, field_cls: null, field_overall_category: null, run_warnings: [], observed_at: at, retention_class: "audit_evidence", created_at: at, updated_at: at,
    ...overrides,
  };
}

export type SiteFacts = { https?: boolean; robotsTxtReachable?: boolean; sitemapReachable?: boolean; robotsDisallowAll?: boolean; frontierRemaining?: number | null; pageCap?: number };

/** Builds the calculator input the way the audit job would have stored it. `frontierRemaining: null` = a run finalised before crawlScope existed. */
export function scoreInput(pages: WebsiteAuditPage[], observations: WebsitePerformanceObservation[], facts: SiteFacts = {}): AuditScoreInput {
  const home = `${facts.https === false ? origin.replace("https://", "http://") : origin}/`;
  const state = { ...initialCrawlState(), summary: { homepageUrl: home, homepageFinalUrl: home, homepageStatus: 200, homepageRedirectChain: [], robotsTxtReachable: facts.robotsTxtReachable ?? true, robotsDisallowAll: facts.robotsDisallowAll ?? false, sitemapReachable: facts.sitemapReachable ?? true, sitemapUrlsDiscovered: 6, sitemapUrlsSameSite: 6 } };
  const summary = summariseSite(state, pages);
  const crawlScope = facts.frontierRemaining === null ? {} : { crawlScope: { pageCap: facts.pageCap ?? 15, frontierRemaining: facts.frontierRemaining ?? 0 } };
  return { run: { crawler_version: "audit-crawler/v3", rules_version: "audit-rules/v3", pages_attempted: pages.length, site_summary_json: { ...summary, ...crawlScope } as unknown as Record<string, unknown> }, pages, observations };
}

const localBusiness = { types: ["RoofingContractor"], name: "Example Roofing", telephone: "01895 123456", address: { streetAddress: "1 High Street", addressLocality: "Uxbridge", postalCode: "UB8 1AA" }, areaServed: ["Uxbridge", "Hillingdon"], geo: null, sameAs: [], openingHours: [], priceRange: null };
const napEvidence = { phones: [{ raw: "01895 123456", digits: "01895123456", sources: ["tel_link"] }], emails: [], postcodes: [{ value: "UB8 1AA", sources: ["text:footer"] }], addressCandidates: [{ text: "1 High Street, Uxbridge, UB8 1AA", postcode: "UB8 1AA", source: "text:footer" }], businessNames: [], hasContactForm: true };

/** 1. Strong conventional trades website: every measurable rule passes. */
export function strongTradesSite(): WebsiteAuditPage[] {
  const paths = ["/services/roof-repairs", "/services/flat-roofing", "/areas/uxbridge", "/contact", "/about"];
  return [
    page("/", { schema_types: ["RoofingContractor", "WebPage"] }, { links: paths.map(link), nap: napEvidence, schema: { localBusiness, organization: null, aggregateRating: null, reviewCount: 0, hasService: true, breadcrumbNames: [] }, hasLocalBusinessSchema: true }),
    page("/services/roof-repairs", { page_role: "service" }, { service: "Roof repairs" }),
    page("/services/flat-roofing", { page_role: "service" }, { service: "Flat roofing" }),
    page("/areas/uxbridge", { page_role: "location" }, { locality: "Uxbridge" }),
    page("/contact", { page_role: "contact", word_count: 80 }),
    page("/about", { page_role: "about" }),
  ];
}

/** 2. Technically weak website, fully crawled (3 pages + one broken link), server-rendered so everything is measurable. */
export function weakSite(): WebsiteAuditPage[] {
  const bare = { canonical_url: null, has_viewport: false, json_ld_count: 0, has_structured_data: false, schema_types: [] as string[] };
  return [
    page("/", { ...bare, title: "Home", meta_description: "Short meta description here.", h1_count: 0, h1_text: [] }, { links: [link("/page-a"), link("/page-b"), link("/missing")] }),
    page("/page-a", { ...bare, title: "Welcome to our website page", meta_description: null, h1_count: 2, word_count: 50 }),
    page("/page-b", { ...bare, title: "Welcome to our website page", meta_description: null }),
    page("/missing", { ...bare, http_status: 404, title: null, meta_description: null }),
  ];
}

/** 3. Client-rendered shell: one page, body content not observable without executing JavaScript. */
export function clientRenderedShell(): WebsiteAuditPage[] {
  return [page("/", { title: "Example Roofing | Roofers in Uxbridge", meta_description: null, canonical_url: null, h1_count: 0, h1_text: [], word_count: 3, json_ld_count: 0, has_structured_data: false, schema_types: [] }, { renderingMode: "client_rendered_likely", nap: null })];
}

export const strongPerformance = (field: boolean): WebsitePerformanceObservation[] => [
  observation("mobile", { performance_score: 92, ...(field ? { field_data_available: true, field_scope: "url" as const, field_lcp_ms: 2000, field_inp_ms: 150, field_cls: 0.05, field_overall_category: "FAST" } : {}) }),
  observation("desktop", { performance_score: 99 }),
];
export const weakPerformance = (): WebsitePerformanceObservation[] => [observation("mobile", { performance_score: 28, lcp_ms: 9000, cls: 0.4, tbt_ms: 1500 }), observation("desktop", { performance_score: 55 })];
export const shellPerformance = (): WebsitePerformanceObservation[] => [observation("mobile", { performance_score: 45, lcp_ms: 6000, cls: 0, tbt_ms: 900 }), observation("desktop", { performance_score: 80 })];
