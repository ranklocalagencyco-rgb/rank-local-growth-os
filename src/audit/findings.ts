import type { AuditFindingSeverity, AuditPageRole, WebsiteAuditPage } from "@/db/types";
import { LOCAL_BUSINESS_TYPE, type RenderingMode, type RenderingSignals } from "@/audit/extract";

// Deterministic findings (RL-062). Every rule is explicit and versioned; evidence is copied from stored facts.
// No marketing copy, no AI commentary, no scores (ai/rules/no-llm-in-crawler.md).

export const AUDIT_RULES_VERSION = "audit-rules/v2";

export type FindingInput = {
  scope: "site" | "page";
  code: string;
  severity: AuditFindingSeverity;
  pageId: string | null;
  evidence: Record<string, unknown>;
  /** Static rule label from FINDING_TEXT. Never generated. */
  title: string;
  /** Static one-sentence description from FINDING_TEXT. Never generated. */
  summary: string;
};

export type PageForRules = Pick<
  WebsiteAuditPage,
  "id" | "requested_url" | "final_url" | "path" | "page_role" | "fetch_ok" | "fetch_error" | "http_status" | "content_type" | "discovered_from" | "title" | "meta_description" | "h1_count" | "h1_text" | "canonical_url" | "meta_robots" | "noindex" | "has_viewport" | "json_ld_count" | "schema_types" | "has_structured_data" | "evidence_json"
>;

/** Site-level facts gathered during the crawl, stored on `website_audit_runs.site_summary_json`. */
export type SiteSummary = {
  homepageUrl: string;
  homepageFinalUrl: string | null;
  homepageHttps: boolean;
  homepageStatus: number | null;
  homepageRedirectChain: string[];
  robotsTxtReachable: boolean;
  robotsDisallowAll: boolean;
  sitemapReachable: boolean;
  sitemapUrlsDiscovered: number;
  sitemapUrlsSameSite: number;
  pagesCrawled: number;
  pagesFailed: number;
  servicePagesFound: number;
  locationPagesFound: number;
  contactPageFound: boolean;
  aboutPageFound: boolean;
  testimonialsPageFound: boolean;
  pagesWithLocalBusinessSchema: number;
  schemaTypesSeen: string[];
  brokenInternalLinks: number;
  /** Crawled HTML pages whose server response was classified as a client-rendered app shell. */
  clientRenderedPages: number;
  homepageRenderingMode: RenderingMode;
  /** False when the homepage is an app shell: content-dependent rules were skipped, not passed. */
  renderedContentEvaluated: boolean;
};

/** Static, rule-owned title and summary for every finding code. UI labels, not AI commentary. */
export const FINDING_TEXT: Record<string, { title: string; summary: string }> = {
  missing_title: { title: "Page has no title", summary: "No <title> element was found in the HTML head." },
  missing_meta_description: { title: "Page has no meta description", summary: "No meta description tag was found in the HTML head." },
  missing_h1: { title: "Page has no H1", summary: "No H1 heading was found in the server-rendered HTML." },
  multiple_h1: { title: "Page has more than one H1", summary: "More than one H1 heading was found on the page." },
  missing_canonical: { title: "Page has no canonical link", summary: "No rel=\"canonical\" link was found in the HTML head." },
  page_noindex: { title: "Page is set to noindex", summary: "A robots meta tag tells search engines not to index this page." },
  missing_viewport: { title: "Page has no viewport meta tag", summary: "No viewport meta tag was found; mobile browsers may render the page zoomed out." },
  no_structured_data: { title: "Page has no structured data", summary: "No JSON-LD, microdata or RDFa types were found in the server-rendered HTML." },
  broken_internal_link: { title: "Internal link returns 404/410", summary: "A link on a crawled page led to a URL that returned HTTP 404 or 410." },
  no_localbusiness_schema: { title: "No LocalBusiness schema on crawled pages", summary: "None of the crawled pages carried a LocalBusiness schema type or subtype." },
  no_contact_page_detected: { title: "No contact page detected", summary: "No crawled page was classified as a contact page." },
  no_service_pages_detected: { title: "No service pages detected", summary: "No crawled page was classified as a service page." },
  homepage_not_https: { title: "Homepage does not resolve to HTTPS", summary: "The homepage's final URL after redirects is not served over HTTPS." },
  robots_txt_missing: { title: "robots.txt not reachable", summary: "robots.txt did not return HTTP 200." },
  sitemap_missing: { title: "No sitemap found", summary: "No XML sitemap was found via robots.txt or /sitemap.xml." },
  client_rendered_site: { title: "Site content is rendered by JavaScript", summary: "The server-rendered HTML is an application shell with almost no text, headings or links. Content-dependent checks were not evaluated because this crawler does not execute JavaScript." },
};

export const ALL_FINDING_CODES = Object.keys(FINDING_TEXT);

/** Rules that read body content and are therefore skipped for client-rendered app shells. Head-level and HTTP rules stay evaluated. */
export const CONTENT_DEPENDENT_PAGE_CODES = ["missing_h1", "multiple_h1", "no_structured_data"] as const;
export const CONTENT_DEPENDENT_SITE_CODES = ["no_localbusiness_schema", "no_contact_page_detected", "no_service_pages_detected"] as const;

function text(code: string): { title: string; summary: string } {
  return FINDING_TEXT[code] ?? { title: code.replace(/_/g, " "), summary: "No description is registered for this finding code." };
}

function finding(input: Omit<FindingInput, "title" | "summary">): FindingInput {
  return { ...input, ...text(input.code) };
}

function isHtmlSuccess(page: PageForRules): boolean {
  return page.fetch_ok && page.http_status !== null && page.http_status >= 200 && page.http_status < 300 && /^(?:text\/html|application\/xhtml\+xml)/i.test(page.content_type ?? "");
}

/** Rendering classification stored with the page evidence; rows written before audit-crawler/v2 have none and count as unknown. */
export function renderingModeOf(page: Pick<WebsiteAuditPage, "evidence_json">): RenderingMode {
  const value = page.evidence_json?.renderingMode;
  return value === "server_rendered" || value === "client_rendered_likely" ? value : "unknown";
}

function renderingSignalsOf(page: Pick<WebsiteAuditPage, "evidence_json">): RenderingSignals | null {
  const value = page.evidence_json?.renderingSignals;
  return value && typeof value === "object" ? (value as RenderingSignals) : null;
}

function pageEvidence(page: PageForRules): Record<string, unknown> {
  return { url: page.final_url ?? page.requested_url, path: page.path, pageRole: page.page_role, httpStatus: page.http_status };
}

/** Rules that apply to one successfully parsed HTML page. */
export function pageFindings(page: PageForRules): FindingInput[] {
  const findings: FindingInput[] = [];
  const isHome = page.page_role === "homepage";

  if (page.fetch_ok && page.http_status !== null && (page.http_status === 404 || page.http_status === 410) && page.discovered_from) {
    findings.push(finding({ scope: "page", code: "broken_internal_link", severity: "medium", pageId: page.id, evidence: { ...pageEvidence(page), discoveredFrom: page.discovered_from } }));
    return findings;
  }
  if (!isHtmlSuccess(page)) return findings;

  const base = pageEvidence(page);
  const contentEvaluable = renderingModeOf(page) !== "client_rendered_likely";
  if (!page.title) findings.push(finding({ scope: "page", code: "missing_title", severity: "medium", pageId: page.id, evidence: base }));
  if (!page.meta_description) findings.push(finding({ scope: "page", code: "missing_meta_description", severity: "low", pageId: page.id, evidence: base }));
  if (contentEvaluable && page.h1_count === 0) findings.push(finding({ scope: "page", code: "missing_h1", severity: "medium", pageId: page.id, evidence: base }));
  if (contentEvaluable && page.h1_count > 1) findings.push(finding({ scope: "page", code: "multiple_h1", severity: "low", pageId: page.id, evidence: { ...base, h1Count: page.h1_count, h1Text: page.h1_text } }));
  if (!page.canonical_url) findings.push(finding({ scope: "page", code: "missing_canonical", severity: "low", pageId: page.id, evidence: base }));
  if (page.noindex) findings.push(finding({ scope: "page", code: "page_noindex", severity: isHome ? "high" : "medium", pageId: page.id, evidence: { ...base, metaRobots: page.meta_robots } }));
  if (!page.has_viewport) findings.push(finding({ scope: "page", code: "missing_viewport", severity: "low", pageId: page.id, evidence: base }));
  if (contentEvaluable && page.json_ld_count === 0 && !page.has_structured_data) findings.push(finding({ scope: "page", code: "no_structured_data", severity: "info", pageId: page.id, evidence: base }));
  return findings;
}

/** Site-level rules computed from the summary and every stored page of the run. */
export function siteFindings(summary: SiteSummary, pages: PageForRules[]): FindingInput[] {
  const findings: FindingInput[] = [];
  const crawled = pages.filter(isHtmlSuccess);
  const roles = new Set<AuditPageRole>(crawled.map((page) => page.page_role));
  const evidence = { pagesCrawled: crawled.length, homepageUrl: summary.homepageUrl };
  const homepage = crawled.find((page) => page.page_role === "homepage") ?? null;
  const clientRendered = crawled.filter((page) => renderingModeOf(page) === "client_rendered_likely");
  // Link discovery starts from the homepage, so an app-shell homepage means the site's pages were never reachable.
  const siteClientRendered = homepage ? renderingModeOf(homepage) === "client_rendered_likely" : crawled.length > 0 && clientRendered.length === crawled.length;

  if (!summary.homepageHttps) findings.push(finding({ scope: "site", code: "homepage_not_https", severity: "high", pageId: null, evidence: { ...evidence, homepageFinalUrl: summary.homepageFinalUrl, redirectChain: summary.homepageRedirectChain } }));
  if (siteClientRendered) {
    const shell = homepage ?? clientRendered[0];
    findings.push(finding({
      scope: "site",
      code: "client_rendered_site",
      severity: "info",
      pageId: null,
      evidence: {
        ...evidence,
        clientRenderedPages: clientRendered.length,
        homepageRenderingMode: homepage ? renderingModeOf(homepage) : "unknown",
        signals: renderingSignalsOf(shell),
        renderedContentEvaluated: false,
        notEvaluated: [...CONTENT_DEPENDENT_PAGE_CODES, ...CONTENT_DEPENDENT_SITE_CODES],
      },
    }));
  } else {
    if (crawled.length > 0 && !crawled.some((page) => page.schema_types.some((type) => LOCAL_BUSINESS_TYPE.test(type)))) {
      findings.push(finding({ scope: "site", code: "no_localbusiness_schema", severity: "medium", pageId: null, evidence: { ...evidence, schemaTypesSeen: summary.schemaTypesSeen } }));
    }
    if (crawled.length > 0 && !roles.has("contact")) findings.push(finding({ scope: "site", code: "no_contact_page_detected", severity: "medium", pageId: null, evidence: { ...evidence, rolesSeen: [...roles] } }));
    if (crawled.length > 0 && !roles.has("service")) findings.push(finding({ scope: "site", code: "no_service_pages_detected", severity: "low", pageId: null, evidence: { ...evidence, rolesSeen: [...roles] } }));
  }
  if (!summary.robotsTxtReachable) findings.push(finding({ scope: "site", code: "robots_txt_missing", severity: "info", pageId: null, evidence }));
  if (!summary.sitemapReachable) findings.push(finding({ scope: "site", code: "sitemap_missing", severity: "low", pageId: null, evidence }));
  return findings;
}
