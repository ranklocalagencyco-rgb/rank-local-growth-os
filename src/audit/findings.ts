import type { AuditFindingSeverity, AuditPageRole, WebsiteAuditPage } from "@/db/types";
import { LOCAL_BUSINESS_TYPE, type RenderingMode, type RenderingSignals } from "@/audit/extract";
import { buildLinkGraph, duplicateGroups, evidenceVersionOf, homepageLinksTo, inboundFor, isHtmlSuccess, isMeaningfulRedirect, type InboundLink, type LinkGraph, type SiteNapSummary, type SiteSchemaSummary, type LocationPageFact, type ServicePageFact, type ServiceLocationCombo } from "@/audit/site-evidence";
import { META_DESCRIPTION_MAX_CHARS, META_DESCRIPTION_MIN_CHARS, THIN_PAGE_MIN_WORDS, TITLE_MAX_CHARS, TITLE_MIN_CHARS } from "@/audit/thresholds";
import { isLocationHubPath } from "@/audit/url";

// Deterministic findings (RL-062). Every rule is explicit and versioned; evidence is copied from stored facts.
// No marketing copy, no AI commentary, no scores (ai/rules/no-llm-in-crawler.md). Thresholds: src/audit/thresholds.ts,
// catalogue and rules: docs/AUDIT_RULES.md.

export const AUDIT_RULES_VERSION = "audit-rules/v3";
/** Rules introduced in v3 read `evidence_json.evidenceVersion` and never fire on rows written by older crawlers. */
export const RULES_MIN_EVIDENCE_VERSION = 3;

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
  "id" | "requested_url" | "final_url" | "path" | "page_role" | "fetch_ok" | "fetch_error" | "http_status" | "content_type" | "discovered_via" | "discovered_from" | "title" | "meta_description" | "h1_count" | "h1_text" | "h2_count" | "canonical_url" | "meta_robots" | "noindex" | "has_viewport" | "word_count" | "redirect_count" | "json_ld_count" | "schema_types" | "has_structured_data" | "evidence_json"
>;

/** Site-level facts gathered during the crawl, stored on `website_audit_runs.site_summary_json`. v3 fields are optional so v1/v2 summaries stay readable. */
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
  // ---- audit-crawler/v3 additions (absent on runs finalised by older crawlers) ----
  evidenceVersion?: number;
  galleryPagesFound?: number;
  blogPagesFound?: number;
  locationPages?: LocationPageFact[];
  servicePages?: ServicePageFact[];
  serviceLocationCombos?: ServiceLocationCombo[];
  nap?: SiteNapSummary;
  schema?: SiteSchemaSummary;
  duplicateTitleGroups?: { title: string; paths: string[] }[];
  duplicateMetaGroups?: { metaDescription: string; paths: string[] }[];
  duplicateTitleMetaPairs?: { value: string; paths: string[] }[];
  homepageLinkCount?: number | null;
  /** Crawled pages with no inbound link from any other crawled page. Crawl scope only: not proof of a true orphan. */
  pagesWithoutInboundLinks?: string[];
  internalRedirects?: { requestedUrl: string; finalUrl: string; linkedFrom: string[] }[];
  linksTruncatedOnAnyPage?: boolean;
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
  // ---- audit-rules/v3 ----
  duplicate_title: { title: "Title is shared with other crawled pages", summary: "Another crawled page with a different URL has exactly the same title." },
  duplicate_meta_description: { title: "Meta description is shared with other crawled pages", summary: "Another crawled page with a different URL has exactly the same meta description." },
  title_too_short: { title: "Title is very short", summary: `The title has fewer than ${TITLE_MIN_CHARS} characters.` },
  title_too_long: { title: "Title is very long", summary: `The title has more than ${TITLE_MAX_CHARS} characters and is likely to be truncated in search results.` },
  meta_description_too_short: { title: "Meta description is very short", summary: `The meta description has fewer than ${META_DESCRIPTION_MIN_CHARS} characters.` },
  meta_description_too_long: { title: "Meta description is very long", summary: `The meta description has more than ${META_DESCRIPTION_MAX_CHARS} characters and is likely to be truncated in search results.` },
  h1_empty: { title: "Page has an empty H1", summary: "An H1 element is present but contains no visible text." },
  thin_page: { title: "Page has very little text", summary: `The server-rendered page has fewer than ${THIN_PAGE_MIN_WORDS} visible words.` },
  internal_link_redirect: { title: "Internal link points through a redirect", summary: "A crawled page or the sitemap links to a URL that redirects to a different scheme, host or path." },
  location_pages_missing: { title: "No location pages detected", summary: "No crawled page was classified as a single-location service-area page." },
  nap_phone_missing: { title: "No phone number found on crawled pages", summary: "No telephone link, phone number text or schema telephone was found on any crawled page." },
  nap_address_missing: { title: "No postal address found on crawled pages", summary: "No address element, schema PostalAddress or address text with a postcode was found on any crawled page." },
  localbusiness_schema_incomplete: { title: "LocalBusiness schema is missing core fields", summary: "A LocalBusiness schema type is present but name, telephone or a full postal address is missing from it." },
  location_page_not_linked_from_homepage: { title: "Location page is not linked from the homepage", summary: "The homepage's links do not include this location page." },
  service_page_not_linked_from_homepage: { title: "Service page is not linked from the homepage", summary: "The homepage's links do not include this service page." },
};

export const ALL_FINDING_CODES = Object.keys(FINDING_TEXT);

/** Rules that read body content and are therefore skipped for client-rendered app shells. Head-level and HTTP rules stay evaluated. */
export const CONTENT_DEPENDENT_PAGE_CODES = ["missing_h1", "multiple_h1", "no_structured_data", "h1_empty", "thin_page"] as const;
export const CONTENT_DEPENDENT_SITE_CODES = ["no_localbusiness_schema", "no_contact_page_detected", "no_service_pages_detected", "location_pages_missing", "nap_phone_missing", "nap_address_missing", "localbusiness_schema_incomplete"] as const;

function text(code: string): { title: string; summary: string } {
  return FINDING_TEXT[code] ?? { title: code.replace(/_/g, " "), summary: "No description is registered for this finding code." };
}

function finding(input: Omit<FindingInput, "title" | "summary">): FindingInput {
  return { ...input, ...text(input.code) };
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

function hasV3Evidence(page: Pick<WebsiteAuditPage, "evidence_json">): boolean {
  return evidenceVersionOf(page) >= RULES_MIN_EVIDENCE_VERSION;
}

/** Cross-page context for one page's rules: who links to it within the crawl. Optional; single-page callers omit it. */
export type PageRuleContext = { linkedFrom: InboundLink[] };

export function pageRuleContext(graph: LinkGraph, page: Pick<WebsiteAuditPage, "requested_url" | "final_url">): PageRuleContext {
  return { linkedFrom: inboundFor(graph, page) };
}

/** Rules that apply to one page. Rules introduced in v3 need `evidence_json.evidenceVersion >= 3`. */
export function pageFindings(page: PageForRules, context: PageRuleContext | null = null): FindingInput[] {
  const findings: FindingInput[] = [];
  const isHome = page.page_role === "homepage";
  const linkedFrom = context?.linkedFrom ?? [];
  const linkedFromPaths = linkedFrom.map((entry) => entry.path).filter((path): path is string => Boolean(path));

  if (page.fetch_ok && page.http_status !== null && (page.http_status === 404 || page.http_status === 410) && page.discovered_from) {
    findings.push(finding({ scope: "page", code: "broken_internal_link", severity: "medium", pageId: page.id, evidence: { ...pageEvidence(page), discoveredFrom: page.discovered_from, linkedFrom: linkedFromPaths, anchorText: linkedFrom.map((entry) => entry.text).filter(Boolean) } }));
    return findings;
  }
  const v3 = hasV3Evidence(page);
  if (v3 && page.fetch_ok && page.redirect_count > 0 && page.final_url && isMeaningfulRedirect(page.requested_url, page.final_url) && (page.discovered_via === "link" || linkedFromPaths.length > 0)) {
    findings.push(finding({ scope: "page", code: "internal_link_redirect", severity: "low", pageId: page.id, evidence: { ...pageEvidence(page), requestedUrl: page.requested_url, finalUrl: page.final_url, redirectChain: page.evidence_json?.redirectChain ?? [], discoveredVia: page.discovered_via, discoveredFrom: page.discovered_from, linkedFrom: linkedFromPaths } }));
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
  if (!v3) return findings;

  const titleLength = typeof page.evidence_json?.titleLength === "number" ? page.evidence_json.titleLength : (page.title?.length ?? 0);
  const metaLength = typeof page.evidence_json?.metaDescriptionLength === "number" ? page.evidence_json.metaDescriptionLength : (page.meta_description?.length ?? 0);
  const h1EmptyCount = typeof page.evidence_json?.h1EmptyCount === "number" ? page.evidence_json.h1EmptyCount : 0;
  if (page.title && titleLength < TITLE_MIN_CHARS) findings.push(finding({ scope: "page", code: "title_too_short", severity: "low", pageId: page.id, evidence: { ...base, title: page.title, titleLength, threshold: TITLE_MIN_CHARS } }));
  if (page.title && titleLength > TITLE_MAX_CHARS) findings.push(finding({ scope: "page", code: "title_too_long", severity: "low", pageId: page.id, evidence: { ...base, title: page.title, titleLength, threshold: TITLE_MAX_CHARS } }));
  if (page.meta_description && metaLength < META_DESCRIPTION_MIN_CHARS) findings.push(finding({ scope: "page", code: "meta_description_too_short", severity: "low", pageId: page.id, evidence: { ...base, metaDescription: page.meta_description, metaDescriptionLength: metaLength, threshold: META_DESCRIPTION_MIN_CHARS } }));
  if (page.meta_description && metaLength > META_DESCRIPTION_MAX_CHARS) findings.push(finding({ scope: "page", code: "meta_description_too_long", severity: "info", pageId: page.id, evidence: { ...base, metaDescription: page.meta_description, metaDescriptionLength: metaLength, threshold: META_DESCRIPTION_MAX_CHARS } }));
  if (contentEvaluable && page.h1_count > 0 && h1EmptyCount > 0) findings.push(finding({ scope: "page", code: "h1_empty", severity: "low", pageId: page.id, evidence: { ...base, h1Count: page.h1_count, h1EmptyCount, h1Text: page.h1_text } }));
  if (contentEvaluable && page.page_role !== "contact" && page.page_role !== "gallery" && page.word_count < THIN_PAGE_MIN_WORDS) findings.push(finding({ scope: "page", code: "thin_page", severity: "low", pageId: page.id, evidence: { ...base, wordCount: page.word_count, threshold: THIN_PAGE_MIN_WORDS } }));
  return findings;
}

/** Rules that need more than one page: duplicate titles/metas and homepage link coverage. v3 evidence only. */
export function crossPageFindings(pages: PageForRules[], summary: SiteSummary): FindingInput[] {
  const findings: FindingInput[] = [];
  const crawled = pages.filter((page) => isHtmlSuccess(page) && hasV3Evidence(page));
  if (crawled.length === 0) return findings;
  const byPath = new Map<string, PageForRules>();
  for (const page of crawled) byPath.set(page.path ?? page.requested_url, page);

  const duplicates = duplicateGroups(pages);
  for (const group of duplicates.titles) {
    for (const path of group.paths) {
      const page = byPath.get(path);
      if (!page) continue;
      findings.push(finding({ scope: "page", code: "duplicate_title", severity: "medium", pageId: page.id, evidence: { ...pageEvidence(page), title: group.value, otherPaths: group.paths.filter((other) => other !== path), groupSize: group.paths.length } }));
    }
  }
  for (const group of duplicates.metas) {
    for (const path of group.paths) {
      const page = byPath.get(path);
      if (!page) continue;
      findings.push(finding({ scope: "page", code: "duplicate_meta_description", severity: "low", pageId: page.id, evidence: { ...pageEvidence(page), metaDescription: group.value, otherPaths: group.paths.filter((other) => other !== path), groupSize: group.paths.length } }));
    }
  }

  const graph = buildLinkGraph(pages);
  if (summary.renderedContentEvaluated && graph.homepageKeys && !graph.truncated && graph.homepageKeys.size > 0) {
    for (const page of crawled) {
      if (page.page_role !== "location" && page.page_role !== "service") continue;
      if (page.page_role === "location" && isLocationHubPath(page.path)) continue;
      if (homepageLinksTo(graph, page) !== false) continue;
      findings.push(finding({ scope: "page", code: page.page_role === "location" ? "location_page_not_linked_from_homepage" : "service_page_not_linked_from_homepage", severity: "low", pageId: page.id, evidence: { ...pageEvidence(page), homepageLinkCount: graph.homepageLinkCount, linkedFrom: inboundFor(graph, page).map((entry) => entry.path).filter(Boolean), discoveredVia: page.discovered_via } }));
    }
  }
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
  const v3 = (summary.evidenceVersion ?? 0) >= RULES_MIN_EVIDENCE_VERSION && crawled.some(hasV3Evidence);

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
    const hasLocalBusiness = crawled.some((page) => page.schema_types.some((type) => LOCAL_BUSINESS_TYPE.test(type)));
    if (crawled.length > 0 && !hasLocalBusiness) {
      findings.push(finding({ scope: "site", code: "no_localbusiness_schema", severity: "medium", pageId: null, evidence: { ...evidence, schemaTypesSeen: summary.schemaTypesSeen } }));
    }
    if (crawled.length > 0 && !roles.has("contact")) findings.push(finding({ scope: "site", code: "no_contact_page_detected", severity: "medium", pageId: null, evidence: { ...evidence, rolesSeen: [...roles] } }));
    if (crawled.length > 0 && !roles.has("service")) findings.push(finding({ scope: "site", code: "no_service_pages_detected", severity: "low", pageId: null, evidence: { ...evidence, rolesSeen: [...roles] } }));
    if (v3) {
      const locationPages = summary.locationPages ?? [];
      if (!locationPages.some((page) => !page.hub)) findings.push(finding({ scope: "site", code: "location_pages_missing", severity: "low", pageId: null, evidence: { ...evidence, rolesSeen: [...roles], locationHubPages: locationPages.filter((page) => page.hub).map((page) => page.path) } }));
      const nap = summary.nap;
      if (nap && nap.pagesEvaluated > 0) {
        if (nap.phones.length === 0) findings.push(finding({ scope: "site", code: "nap_phone_missing", severity: "medium", pageId: null, evidence: { ...evidence, pagesEvaluated: nap.pagesEvaluated, sourcesChecked: ["tel_link", "text:header", "text:footer", "text:main", "schema"] } }));
        if (nap.addressCandidates.length === 0 && !summary.schema?.hasAddress && !nap.postcodes.some((postcode) => postcode.sources.includes("schema"))) findings.push(finding({ scope: "site", code: "nap_address_missing", severity: "medium", pageId: null, evidence: { ...evidence, pagesEvaluated: nap.pagesEvaluated, postcodesSeen: nap.postcodes.map((postcode) => postcode.value), sourcesChecked: ["address_element", "schema_postal_address", "text:header", "text:footer", "text:main"] } }));
      }
      const schema = summary.schema;
      if (hasLocalBusiness && schema && schema.localBusinessPages > 0 && schema.localBusinessMissingFields.length > 0) {
        findings.push(finding({ scope: "site", code: "localbusiness_schema_incomplete", severity: "low", pageId: null, evidence: { ...evidence, localBusinessPages: schema.localBusinessPages, localBusinessTypes: schema.localBusinessTypes, missingFields: schema.localBusinessMissingFields, hasName: schema.hasName, hasTelephone: schema.hasTelephone, hasAddress: schema.hasAddress } }));
      }
    }
  }
  if (!summary.robotsTxtReachable) findings.push(finding({ scope: "site", code: "robots_txt_missing", severity: "info", pageId: null, evidence }));
  if (!summary.sitemapReachable) findings.push(finding({ scope: "site", code: "sitemap_missing", severity: "low", pageId: null, evidence }));
  return findings;
}
