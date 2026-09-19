import type { ScoreCategoryKey } from "@/audit/score/rules";
import type { AuditFindingSeverity } from "@/db/types";

// Static, client-readable text for the website audit report. Every string here is fixed at build time and keyed by a deterministic
// code (score rule, finding code, not-evaluated reason). Nothing is generated: no LLM, no templated sales copy, no recommendations,
// and no claim about rankings, revenue or customers, because none of those is measured. docs/AUDIT_REPORT.md.

export const CATEGORY_LABELS: Record<ScoreCategoryKey, string> = {
  technical: "Technical SEO",
  local_seo: "Local SEO",
  content_structure: "Content & Structure",
  performance: "Performance",
  crawl: "Crawl & Indexability",
};

/** `label` names the check, `pass` states the measured fact when it passed, `gap` states it when points were lost (fail or partial). */
export type RuleText = { label: string; pass: string; gap: string };

export const RULE_TEXT: Record<string, RuleText> = {
  // Crawl & indexability
  homepage_reachable: { label: "Homepage reachable", pass: "The homepage responded successfully", gap: "The homepage did not return a successful response" },
  homepage_indexable: { label: "Homepage indexable", pass: "The homepage is open to search-engine indexing", gap: "The homepage is set to noindex" },
  robots_allows_crawling: { label: "robots.txt allows crawling", pass: "robots.txt does not block crawling of the site", gap: "robots.txt blocks crawling of the whole site" },
  pages_indexable: { label: "Other pages indexable", pass: "Every other evaluated page is open to indexing", gap: "Not every evaluated page is open to indexing" },
  pages_fetch_success: { label: "Pages load without errors", pass: "Every page the crawler requested loaded without a server or network error", gap: "Not every requested page loaded without a server or network error" },
  // Technical SEO
  https: { label: "HTTPS", pass: "The website is served over HTTPS", gap: "The homepage does not resolve to HTTPS" },
  sitemap: { label: "XML sitemap", pass: "An XML sitemap was found", gap: "No XML sitemap was found" },
  robots_txt: { label: "robots.txt", pass: "robots.txt is reachable", gap: "robots.txt was not reachable" },
  title_coverage: { label: "Page titles", pass: "Every evaluated page has a title", gap: "Not every evaluated page has a title" },
  title_length: { label: "Title length", pass: "Every title is within the configured length range", gap: "Not every title is within the configured length range" },
  meta_description_coverage: { label: "Meta descriptions", pass: "Every evaluated page has a meta description", gap: "Not every evaluated page has a meta description" },
  meta_description_length: { label: "Meta description length", pass: "Every meta description is within the configured length range", gap: "Not every meta description is within the configured length range" },
  canonical_coverage: { label: "Canonical links", pass: "Every evaluated page declares a canonical URL", gap: "Not every evaluated page declares a canonical URL" },
  viewport_coverage: { label: "Mobile viewport", pass: "Every evaluated page has a mobile viewport tag", gap: "Not every evaluated page has a mobile viewport tag" },
  h1_coverage: { label: "Main headings (H1)", pass: "Every evaluated page has exactly one main heading", gap: "Not every evaluated page has exactly one non-empty main heading" },
  structured_data: { label: "Structured data", pass: "Every evaluated page carries structured data", gap: "Not every evaluated page carries structured data" },
  // Local SEO
  localbusiness_schema: { label: "LocalBusiness structured data", pass: "LocalBusiness structured data was detected", gap: "LocalBusiness structured data was not detected" },
  localbusiness_name: { label: "LocalBusiness name", pass: "The LocalBusiness data includes the business name", gap: "No LocalBusiness data with a business name was found" },
  localbusiness_telephone: { label: "LocalBusiness telephone", pass: "The LocalBusiness data includes a telephone number", gap: "No LocalBusiness data with a telephone number was found" },
  localbusiness_address: { label: "LocalBusiness address", pass: "The LocalBusiness data includes a full postal address", gap: "No LocalBusiness data with a full postal address was found" },
  nap_phone: { label: "Phone number on the website", pass: "A phone number was found on the website", gap: "No phone number was found on the evaluated pages" },
  nap_address: { label: "Postal address on the website", pass: "A postal address or postcode was found on the website", gap: "No postal address was found on the evaluated pages" },
  location_pages: { label: "Location pages", pass: "Dedicated location pages were detected", gap: "No dedicated location page was detected" },
  service_area_evidence: { label: "Service-area evidence", pass: "The website names the areas it serves", gap: "No service-area evidence was found" },
  // Content & structure
  service_pages: { label: "Service pages", pass: "Dedicated service pages were detected", gap: "No dedicated service page was detected" },
  contact_page: { label: "Contact page", pass: "A contact page was found", gap: "No contact page was detected" },
  homepage_links_key_pages: { label: "Homepage links to key pages", pass: "The homepage links to every service and location page that was evaluated", gap: "The homepage does not link to every service and location page that was evaluated" },
  unique_titles: { label: "Unique titles", pass: "Every page title is unique", gap: "Some pages share the same title" },
  unique_meta_descriptions: { label: "Unique meta descriptions", pass: "Every meta description is unique", gap: "Some pages share the same meta description" },
  non_thin_pages: { label: "Page depth", pass: "Every evaluated page has a substantial amount of text", gap: "Some evaluated pages have very little text" },
  no_broken_internal_links: { label: "Internal links", pass: "No broken internal links were found", gap: "Broken internal links were found" },
  no_internal_redirects: { label: "Internal redirects", pass: "Internal links point directly at their destination", gap: "Some internal links point through a redirect" },
  // Performance
  lighthouse_performance_mobile: { label: "Lighthouse performance, mobile", pass: "Mobile Lighthouse performance scored 100", gap: "Mobile Lighthouse performance is below 100" },
  lighthouse_performance_desktop: { label: "Lighthouse performance, desktop", pass: "Desktop Lighthouse performance scored 100", gap: "Desktop Lighthouse performance is below 100" },
  lcp_mobile_lab: { label: "Largest Contentful Paint, mobile", pass: "Mobile Largest Contentful Paint is within the Good threshold", gap: "Mobile Largest Contentful Paint is above the Good threshold" },
  cls_mobile_lab: { label: "Cumulative Layout Shift, mobile", pass: "Mobile layout stability (CLS) is within the Good threshold", gap: "Mobile layout stability (CLS) is above the Good threshold" },
  tbt_mobile_lab: { label: "Total Blocking Time, mobile", pass: "Mobile Total Blocking Time is within the Good threshold", gap: "Mobile Total Blocking Time is above the Good threshold" },
  field_lcp: { label: "Real-user Largest Contentful Paint", pass: "Real-user Largest Contentful Paint is within the Good threshold", gap: "Real-user Largest Contentful Paint is above the Good threshold" },
  field_inp: { label: "Real-user Interaction to Next Paint", pass: "Real-user Interaction to Next Paint is within the Good threshold", gap: "Real-user Interaction to Next Paint is above the Good threshold" },
  field_cls: { label: "Real-user Cumulative Layout Shift", pass: "Real-user layout stability (CLS) is within the Good threshold", gap: "Real-user layout stability (CLS) is above the Good threshold" },
};

function humanize(code: string): string {
  const text = code.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unnamed check";
}

/** Text of a score rule. An unknown code (a future scoring version) gets a neutral label from the code itself, never a blank. */
export function ruleText(code: string): RuleText {
  return RULE_TEXT[code] ?? { label: humanize(code), pass: `${humanize(code)}: passed`, gap: `${humanize(code)}: points were lost` };
}

/** Why a rule or category was not evaluated. Keys are the `evidence.reason` strings written by src/audit/score/calculate.ts. */
export const NOT_EVALUATED_REASON_TEXT: Record<string, string> = {
  crawl_blocked: "The audit was blocked by a browser-verification page",
  challenge_pages_not_evaluated: "A page answered with a browser-verification page, so its absence could not be confirmed",
  crawl_capped: "The crawl reached its page limit before every discovered page was evaluated",
  client_rendered_content_not_evaluated: "The page content is rendered by JavaScript, which this crawler does not execute",
  no_eligible_pages: "No page was eligible for this check",
  requires_evidence_v3: "This audit predates the evidence needed for this check",
  field_data_unavailable: "Real-user (CrUX) data was not available for this URL",
  metric_not_returned: "The performance provider did not return this metric",
  mobile_observation_failed: "The mobile performance measurement failed",
  desktop_observation_failed: "The desktop performance measurement failed",
  mobile_observation_not_collected: "No mobile performance measurement was collected",
  desktop_observation_not_collected: "No desktop performance measurement was collected",
  homepage_status_not_recorded: "The homepage status was not recorded",
  homepage_row_missing: "No homepage evidence was stored",
  robots_not_recorded: "robots.txt evidence was not recorded",
  https_not_recorded: "HTTPS evidence was not recorded",
  sitemap_not_recorded: "Sitemap evidence was not recorded",
  schema_summary_not_recorded: "Structured-data evidence was not recorded",
  nap_not_evaluated: "Contact-detail evidence was not recorded",
  homepage_links_not_recorded: "The homepage's links were not recorded",
  stored_links_truncated: "A page had more links than the audit stores, so link coverage was not evaluated",
  broken_links_not_recorded: "Broken-link evidence was not recorded",
  insufficient_category_evidence: "Too little of this category could be measured",
};

export function notEvaluatedReasonText(reason: unknown): string {
  return typeof reason === "string" && reason ? NOT_EVALUATED_REASON_TEXT[reason] ?? humanize(reason) : "Not enough evidence was collected";
}

export type ClientFindingText = { title: string; explanation: string; category: ScoreCategoryKey };

/** Client-readable title and explanation for every finding code the rules can emit (src/audit/findings.ts). Explanatory only. */
export const CLIENT_FINDING_TEXT: Record<string, ClientFindingText> = {
  missing_title: { category: "technical", title: "Page title is missing", explanation: "No title element was found on the page. The title is the headline search engines show for a page." },
  missing_meta_description: { category: "technical", title: "Meta description is missing", explanation: "No meta description was found on the page." },
  missing_h1: { category: "technical", title: "Main heading (H1) is missing", explanation: "No H1 heading was found in the page's HTML." },
  multiple_h1: { category: "technical", title: "More than one main heading (H1)", explanation: "The page has more than one H1 heading." },
  h1_empty: { category: "technical", title: "Main heading (H1) is empty", explanation: "An H1 element is present but contains no visible text." },
  missing_canonical: { category: "technical", title: "Canonical link is missing", explanation: "The page does not declare a canonical URL." },
  missing_viewport: { category: "technical", title: "Mobile viewport tag is missing", explanation: "No viewport meta tag was found, so mobile browsers may show the page zoomed out." },
  no_structured_data: { category: "technical", title: "No structured data on the page", explanation: "No JSON-LD, microdata or RDFa was found on the page." },
  title_too_short: { category: "technical", title: "Page title is very short", explanation: "The title is shorter than the configured length range." },
  title_too_long: { category: "technical", title: "Page title is very long", explanation: "The title is longer than the configured length range and is likely to be cut off in search results." },
  meta_description_too_short: { category: "technical", title: "Meta description is very short", explanation: "The meta description is shorter than the configured length range." },
  meta_description_too_long: { category: "technical", title: "One or more meta descriptions exceed the configured length range", explanation: "The meta description is longer than the configured length range and is likely to be cut off in search results." },
  homepage_not_https: { category: "technical", title: "Homepage is not served over HTTPS", explanation: "After redirects, the homepage's final address does not use HTTPS." },
  robots_txt_missing: { category: "technical", title: "robots.txt was not reachable", explanation: "The robots.txt file did not return a successful response." },
  sitemap_missing: { category: "technical", title: "No XML sitemap was found", explanation: "No XML sitemap was found through robots.txt or at /sitemap.xml." },
  page_noindex: { category: "crawl", title: "Page is set to noindex", explanation: "A robots meta tag tells search engines not to index this page." },
  client_rendered_site: { category: "crawl", title: "Website content is rendered by JavaScript", explanation: "The server's HTML is an application shell with almost no text. Content-based checks were not evaluated because this crawler does not execute JavaScript." },
  no_localbusiness_schema: { category: "local_seo", title: "LocalBusiness structured data was not detected", explanation: "None of the evaluated pages carries a LocalBusiness structured-data type." },
  localbusiness_schema_incomplete: { category: "local_seo", title: "LocalBusiness structured data is missing core fields", explanation: "LocalBusiness structured data is present, but the name, telephone number or full postal address is missing from it." },
  nap_phone_missing: { category: "local_seo", title: "No phone number was found on the website", explanation: "No telephone link, phone number text or structured-data telephone was found on the evaluated pages." },
  nap_address_missing: { category: "local_seo", title: "No postal address was found on the website", explanation: "No address element, structured-data address or address text with a postcode was found on the evaluated pages." },
  location_pages_missing: { category: "local_seo", title: "No dedicated location pages were detected", explanation: "None of the evaluated pages was identified as a page for a single service location." },
  location_page_not_linked_from_homepage: { category: "content_structure", title: "Location page is not linked from the homepage", explanation: "The homepage's links do not include this location page." },
  service_page_not_linked_from_homepage: { category: "content_structure", title: "Service page is not linked from the homepage", explanation: "The homepage's links do not include this service page." },
  no_contact_page_detected: { category: "content_structure", title: "No contact page was detected", explanation: "None of the evaluated pages was identified as a contact page." },
  no_service_pages_detected: { category: "content_structure", title: "No dedicated service pages were detected", explanation: "None of the evaluated pages was identified as a page for a single service." },
  duplicate_title: { category: "content_structure", title: "Pages share the same title", explanation: "Another evaluated page with a different address has exactly the same title." },
  duplicate_meta_description: { category: "content_structure", title: "Pages share the same meta description", explanation: "Another evaluated page with a different address has exactly the same meta description." },
  thin_page: { category: "content_structure", title: "Page has very little text", explanation: "The page has fewer visible words than the configured minimum." },
  broken_internal_link: { category: "content_structure", title: "Internal link leads to a missing page", explanation: "A link on the website leads to an address that returned HTTP 404 or 410." },
  internal_link_redirect: { category: "content_structure", title: "Internal link points through a redirect", explanation: "A link on the website, or its sitemap, points at an address that redirects elsewhere." },
  // Operational: about the audit itself, never an SEO defect. Shown as crawl notes, not as findings.
  challenge_page_detected: { category: "crawl", title: "A browser-verification page was returned instead of the page", explanation: "The server answered the crawler with a verification or holding page. Its content was not evaluated." },
  challenge_page_suspected: { category: "crawl", title: "A page showed some signs of a browser-verification page", explanation: "The page was evaluated normally; its results should be read with caution." },
};

export function clientFindingText(code: string): ClientFindingText {
  return CLIENT_FINDING_TEXT[code] ?? { category: "technical", title: humanize(code), explanation: "No description is registered for this finding." };
}

export const SEVERITY_ORDER: AuditFindingSeverity[] = ["high", "medium", "low", "info"];
export const SEVERITY_LABELS: Record<AuditFindingSeverity, string> = { high: "High", medium: "Medium", low: "Low", info: "Note" };

/** Evidence keys a finding may show, in display order. Free text captured from the site (titles, descriptions, anchors) is never shown. */
export const FINDING_EVIDENCE_LABELS: Record<string, string> = {
  titleLength: "Title length (characters)",
  metaDescriptionLength: "Meta description length (characters)",
  wordCount: "Visible words",
  threshold: "Configured limit",
  h1Count: "H1 headings",
  h1EmptyCount: "Empty H1 headings",
  groupSize: "Pages sharing this value",
  httpStatus: "HTTP status",
  pagesCrawled: "Pages evaluated",
  pagesEvaluated: "Pages evaluated",
  missingFields: "Missing fields",
  metaRobots: "Robots meta tag",
  homepageLinkCount: "Links on the homepage",
  clientRenderedPages: "JavaScript-rendered pages",
  discoveredFrom: "Linked from",
};

/** Labels for the measured values stored with each score rule, used by the score breakdown. Unknown keys are humanized. */
export const RULE_EVIDENCE_LABELS: Record<string, string> = {
  passing: "Pages passing",
  eligible: "Pages checked",
  minChars: "Minimum characters",
  maxChars: "Maximum characters",
  minWords: "Minimum words",
  thresholds: "Good / needs-improvement thresholds",
  performanceScore: "Lighthouse performance score",
  lcpMs: "LCP (ms)",
  cls: "CLS",
  tbtMs: "TBT (ms)",
  fieldLcpMs: "Field LCP (ms)",
  fieldInpMs: "Field INP (ms)",
  fieldCls: "Field CLS",
  fieldScope: "Field data scope",
  reason: "Reason",
};

export function evidenceLabel(key: string, labels: Record<string, string>): string {
  return labels[key] ?? humanize(key);
}

/** Challenge kinds recorded by src/audit/challenge-detection.ts. */
export const CHALLENGE_KIND_TEXT: Record<string, string> = {
  bot_challenge: "Bot challenge / browser verification",
  access_block: "Access blocked",
  interstitial: "Holding / interstitial page",
};

// ---- Fixed sentences for score states and notices (docs/AUDIT_REPORT.md §4) ----
export const STATE_TEXT = {
  complete: "Every category was scored and enough of the audit was measured for the overall score to stand on its own.",
  provisional: "Some audit evidence was unavailable, so this score is provisional.",
  insufficient: "There was not enough reliable evidence to produce an overall score.",
  unscored: "The score for this audit has not been calculated yet.",
  blockedHeadline: "Audit blocked",
  blocked: "The site returned a browser verification or challenge page, so content-based checks could not be evaluated reliably.",
  blockedDetail: "This describes how the website answered the audit, not a fault in the website's search optimisation. The verification step was not bypassed. Performance evidence, where shown, was measured separately by the performance provider.",
  historical: "This report was produced using an earlier audit version. Some safeguards available in newer audits were not present for this run.",
  fieldUnavailable: "Real-user (CrUX) data was not available for this URL. These field-data checks were not evaluated.",
  allPassed: "All evaluated checks passed.",
} as const;
