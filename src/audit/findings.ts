import type { AuditFindingSeverity, AuditPageRole, WebsiteAuditPage } from "@/db/types";
import { LOCAL_BUSINESS_TYPE } from "@/audit/extract";

// Deterministic findings (RL-062). Every rule is explicit and versioned; evidence is copied from stored facts.
// No marketing copy, no AI commentary, no scores (ai/rules/no-llm-in-crawler.md).

export const AUDIT_RULES_VERSION = "audit-rules/v1";

export type FindingInput = {
  scope: "site" | "page";
  code: string;
  severity: AuditFindingSeverity;
  pageId: string | null;
  evidence: Record<string, unknown>;
};

export type PageForRules = Pick<
  WebsiteAuditPage,
  "id" | "requested_url" | "final_url" | "path" | "page_role" | "fetch_ok" | "fetch_error" | "http_status" | "content_type" | "discovered_from" | "title" | "meta_description" | "h1_count" | "h1_text" | "canonical_url" | "meta_robots" | "noindex" | "has_viewport" | "json_ld_count" | "schema_types" | "has_structured_data"
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
};

function isHtmlSuccess(page: PageForRules): boolean {
  return page.fetch_ok && page.http_status !== null && page.http_status >= 200 && page.http_status < 300 && /^(?:text\/html|application\/xhtml\+xml)/i.test(page.content_type ?? "");
}

function pageEvidence(page: PageForRules): Record<string, unknown> {
  return { url: page.final_url ?? page.requested_url, path: page.path, pageRole: page.page_role, httpStatus: page.http_status };
}

/** Rules that apply to one successfully parsed HTML page. */
export function pageFindings(page: PageForRules): FindingInput[] {
  const findings: FindingInput[] = [];
  const isHome = page.page_role === "homepage";

  if (page.fetch_ok && page.http_status !== null && (page.http_status === 404 || page.http_status === 410) && page.discovered_from) {
    findings.push({ scope: "page", code: "broken_internal_link", severity: "medium", pageId: page.id, evidence: { ...pageEvidence(page), discoveredFrom: page.discovered_from } });
    return findings;
  }
  if (!isHtmlSuccess(page)) return findings;

  const base = pageEvidence(page);
  if (!page.title) findings.push({ scope: "page", code: "missing_title", severity: "medium", pageId: page.id, evidence: base });
  if (!page.meta_description) findings.push({ scope: "page", code: "missing_meta_description", severity: "low", pageId: page.id, evidence: base });
  if (page.h1_count === 0) findings.push({ scope: "page", code: "missing_h1", severity: "medium", pageId: page.id, evidence: base });
  if (page.h1_count > 1) findings.push({ scope: "page", code: "multiple_h1", severity: "low", pageId: page.id, evidence: { ...base, h1Count: page.h1_count, h1Text: page.h1_text } });
  if (!page.canonical_url) findings.push({ scope: "page", code: "missing_canonical", severity: "low", pageId: page.id, evidence: base });
  if (page.noindex) findings.push({ scope: "page", code: "page_noindex", severity: isHome ? "high" : "medium", pageId: page.id, evidence: { ...base, metaRobots: page.meta_robots } });
  if (!page.has_viewport) findings.push({ scope: "page", code: "missing_viewport", severity: "low", pageId: page.id, evidence: base });
  if (page.json_ld_count === 0 && !page.has_structured_data) findings.push({ scope: "page", code: "no_structured_data", severity: "info", pageId: page.id, evidence: base });
  return findings;
}

/** Site-level rules computed from the summary and every stored page of the run. */
export function siteFindings(summary: SiteSummary, pages: PageForRules[]): FindingInput[] {
  const findings: FindingInput[] = [];
  const crawled = pages.filter(isHtmlSuccess);
  const roles = new Set<AuditPageRole>(crawled.map((page) => page.page_role));
  const evidence = { pagesCrawled: crawled.length, homepageUrl: summary.homepageUrl };

  if (!summary.homepageHttps) findings.push({ scope: "site", code: "homepage_not_https", severity: "high", pageId: null, evidence: { ...evidence, homepageFinalUrl: summary.homepageFinalUrl, redirectChain: summary.homepageRedirectChain } });
  if (crawled.length > 0 && !crawled.some((page) => page.schema_types.some((type) => LOCAL_BUSINESS_TYPE.test(type)))) {
    findings.push({ scope: "site", code: "no_localbusiness_schema", severity: "medium", pageId: null, evidence: { ...evidence, schemaTypesSeen: summary.schemaTypesSeen } });
  }
  if (crawled.length > 0 && !roles.has("contact")) findings.push({ scope: "site", code: "no_contact_page_detected", severity: "medium", pageId: null, evidence: { ...evidence, rolesSeen: [...roles] } });
  if (crawled.length > 0 && !roles.has("service")) findings.push({ scope: "site", code: "no_service_pages_detected", severity: "low", pageId: null, evidence: { ...evidence, rolesSeen: [...roles] } });
  if (!summary.robotsTxtReachable) findings.push({ scope: "site", code: "robots_txt_missing", severity: "info", pageId: null, evidence });
  if (!summary.sitemapReachable) findings.push({ scope: "site", code: "sitemap_missing", severity: "low", pageId: null, evidence });
  return findings;
}
