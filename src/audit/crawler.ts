import type { SafeFetcher, SafeFetchResult } from "@/audit/safe-fetch";
import { detectChallengePage, isBlockingChallenge, readChallengeEvidence, type ChallengeEvidence } from "@/audit/challenge-detection";
import { classifyPage, roleFromSectionLabel, type InboundLinkContext } from "@/audit/classify";
import { EVIDENCE_VERSION, AUDIT_CRAWLER_VERSION, extractPageEvidence, type PageEvidence } from "@/audit/extract";
import { renderingModeOf, type SiteSummary } from "@/audit/findings";
import { parseRobotsTxt, parseSitemapXml } from "@/audit/sitemap";
import { buildLinkGraph, duplicateGroups, evidenceVersionOf, inboundFor, isChallengePage, isHtmlSuccess, isMeaningfulRedirect, napSummary, rolePageFacts, schemaSummary, type PageRow } from "@/audit/site-evidence";
import { classifyPageRole, crawlPriority, isCrawlablePath, isSameSite, normalizeAuditUrl } from "@/audit/url";
import type { AuditDiscoveredVia, WebsiteAuditPage } from "@/db/types";
import type { AuditPageInsert } from "@/audit/store";
import { normalizeDomain } from "@/domain/identifiers";

// Bounded crawl planning and per-page processing (RL-051). Pure apart from the injected SafeFetcher.
// State is a plain JSON object persisted on the run so a job can stop at its deadline and resume.

export const MAX_FRONTIER = 200;
export const MAX_AUX_REQUESTS = 6;
export const MAX_SITEMAP_FILES = 3;
/** Homepage link context kept in crawl state: bounded so the persisted JSON stays small. */
export const MAX_LINK_CONTEXT = 200;
const MAX_CONTEXT_ANCHORS = 3;
const READ_TEXT_TYPES = /^(?:text\/plain|text\/xml|application\/xml|application\/rss\+xml|application\/atom\+xml|application\/x-gzip|application\/octet-stream)$/;

export type FrontierEntry = { url: string; key: string; via: AuditDiscoveredVia; from: string | null; priority: number };

export type CrawlState = {
  /** `blocked`: the homepage was a high-confidence challenge document; the run finalises as blocked without any further request. */
  phase: "start" | "crawl" | "finalize" | "blocked";
  siteDomain: string | null;
  frontier: FrontierEntry[];
  visited: string[];
  finalKeys: string[];
  duplicateRedirects: number;
  auxRequests: number;
  summary: Partial<SiteSummary>;
  /** Page key → anchors and menu parent as seen on the homepage. Lets later pages be classified with inbound context. */
  linkContext: Record<string, InboundLinkContext>;
};

export function initialCrawlState(): CrawlState {
  return { phase: "start", siteDomain: null, frontier: [], visited: [], finalKeys: [], duplicateRedirects: 0, auxRequests: 0, summary: {}, linkContext: {} };
}

function parseLinkContext(value: unknown): Record<string, InboundLinkContext> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, InboundLinkContext> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Partial<InboundLinkContext>;
    out[key] = { anchors: Array.isArray(record.anchors) ? record.anchors.filter((anchor): anchor is string => typeof anchor === "string") : [], navParent: typeof record.navParent === "string" ? record.navParent : null };
  }
  return out;
}

export function parseCrawlState(value: unknown): CrawlState {
  const base = initialCrawlState();
  if (!value || typeof value !== "object") return base;
  const record = value as Partial<CrawlState>;
  return {
    phase: record.phase === "crawl" || record.phase === "finalize" || record.phase === "blocked" ? record.phase : "start",
    siteDomain: typeof record.siteDomain === "string" ? record.siteDomain : null,
    frontier: Array.isArray(record.frontier) ? record.frontier.filter((entry): entry is FrontierEntry => Boolean(entry && typeof entry === "object" && typeof (entry as FrontierEntry).url === "string" && typeof (entry as FrontierEntry).key === "string")) : [],
    visited: Array.isArray(record.visited) ? record.visited.filter((key): key is string => typeof key === "string") : [],
    finalKeys: Array.isArray(record.finalKeys) ? record.finalKeys.filter((key): key is string => typeof key === "string") : [],
    duplicateRedirects: typeof record.duplicateRedirects === "number" ? record.duplicateRedirects : 0,
    auxRequests: typeof record.auxRequests === "number" ? record.auxRequests : 0,
    summary: record.summary && typeof record.summary === "object" ? record.summary : {},
    linkContext: parseLinkContext(record.linkContext),
  };
}

/** Records the homepage's links (anchor text, menu parent) so pages fetched later carry inbound context. */
export function recordLinkContext(state: CrawlState, evidence: PageEvidence): void {
  for (const link of evidence.links) {
    const key = normalizeAuditUrl(link.url)?.key;
    if (!key) continue;
    const existing = state.linkContext[key];
    if (existing) {
      if (link.text && existing.anchors.length < MAX_CONTEXT_ANCHORS && !existing.anchors.includes(link.text)) existing.anchors.push(link.text.slice(0, 40));
      if (!existing.navParent && link.group) existing.navParent = link.group;
      continue;
    }
    if (Object.keys(state.linkContext).length >= MAX_LINK_CONTEXT) break;
    state.linkContext[key] = { anchors: link.text ? [link.text.slice(0, 40)] : [], navParent: link.group };
  }
}

/** Adds same-site, crawlable, unseen URLs to the frontier, keeping it bounded and sorted by priority. */
export function enqueueFrontier(state: CrawlState, candidates: { url: string; via: AuditDiscoveredVia; from: string | null }[]): number {
  if (!state.siteDomain) return 0;
  const known = new Set([...state.visited, ...state.frontier.map((entry) => entry.key)]);
  let added = 0;
  for (const candidate of candidates) {
    const normalized = normalizeAuditUrl(candidate.url);
    if (!normalized || known.has(normalized.key)) continue;
    if (!isSameSite(normalized.url, state.siteDomain) || !isCrawlablePath(normalized.path)) continue;
    known.add(normalized.key);
    const hint = roleFromSectionLabel(state.linkContext[normalized.key]?.navParent);
    state.frontier.push({ url: normalized.url, key: normalized.key, via: candidate.via, from: candidate.from, priority: crawlPriority(normalized.path, candidate.via, hint) });
    added += 1;
  }
  state.frontier.sort((a, b) => a.priority - b.priority);
  if (state.frontier.length > MAX_FRONTIER) state.frontier.length = MAX_FRONTIER;
  return added;
}

export function nextFrontierEntry(state: CrawlState): FrontierEntry | null {
  const entry = state.frontier.shift() ?? null;
  if (entry) state.visited.push(entry.key);
  return entry;
}

/**
 * `evidence` is null for anything that is not website content, including a high-confidence challenge document, so callers can never
 * enqueue links or record link context from one. `challenge` carries any detection (high, medium or low); `challengeExcluded` is true
 * only for high confidence.
 */
export type PageOutcome = { page: AuditPageInsert | null; evidence: PageEvidence | null; duplicateOf: string | null; challenge: ChallengeEvidence | null; challengeExcluded: boolean };

/**
 * Turns a fetch result into a page row (evidence extracted for HTML successes). Returns no row for a redirect onto an already-crawled URL.
 * A high-confidence challenge document (src/audit/challenge-detection.ts) is stored like a non-HTML response: HTTP facts and the
 * detection provenance only. Its title, headings, links, NAP and schema never reach the content columns, so no rule can read them.
 */
export function buildPageOutcome(input: { workspaceId: string; runId: string; prospectId: string; entry: Pick<FrontierEntry, "url" | "via" | "from">; result: SafeFetchResult; state: CrawlState; fetchedAt: string }): PageOutcome {
  const { result, state, entry } = input;
  const finalNormalized = result.finalUrl ? normalizeAuditUrl(result.finalUrl) : null;
  const requestedNormalized = normalizeAuditUrl(entry.url);

  if (result.ok && finalNormalized && finalNormalized.key !== requestedNormalized?.key && state.finalKeys.includes(finalNormalized.key)) {
    state.duplicateRedirects += 1;
    return { page: null, evidence: null, duplicateOf: finalNormalized.url, challenge: null, challengeExcluded: false };
  }
  if (finalNormalized && !state.finalKeys.includes(finalNormalized.key)) state.finalKeys.push(finalNormalized.key);

  const path = finalNormalized?.path ?? requestedNormalized?.path ?? null;
  const html = result.ok && result.isHtml && result.body !== null && result.status !== null && result.status >= 200 && result.status < 300;
  const extracted = html && state.siteDomain ? extractPageEvidence(result.body as string, result.finalUrl as string, state.siteDomain) : null;
  const detection = extracted ? detectChallengePage({ html: result.body as string, title: extracted.title, wordCount: extracted.wordCount, internalLinkCount: extracted.internalLinkCount, h1Count: extracted.h1Count }) : null;
  const challenge: ChallengeEvidence | null = extracted && detection?.detected
    ? { ...detection, url: result.finalUrl ?? entry.url, httpStatus: result.status, title: extracted.title?.slice(0, 200) ?? null, wordCount: extracted.wordCount, internalLinkCount: extracted.internalLinkCount, h1Count: extracted.h1Count, detectedAt: input.fetchedAt }
    : null;
  const challengeExcluded = isBlockingChallenge(challenge);
  const evidence = challengeExcluded ? null : extracted;
  const inbound = (requestedNormalized && state.linkContext[requestedNormalized.key]) ?? (finalNormalized && state.linkContext[finalNormalized.key]) ?? null;
  const classification = evidence
    ? classifyPage({ path, via: entry.via, title: evidence.title, h1Text: evidence.h1Text, breadcrumbNames: evidence.breadcrumbNames, schemaTypes: evidence.schemaTypes, inbound })
    : null;
  const pageRole = entry.via === "homepage" ? "homepage" : classification?.role ?? classifyPageRole(path ?? "/");

  const page: AuditPageInsert = {
    workspace_id: input.workspaceId,
    audit_run_id: input.runId,
    prospect_id: input.prospectId,
    requested_url: entry.url,
    final_url: result.finalUrl,
    path,
    discovered_via: entry.via,
    discovered_from: entry.from,
    page_role: pageRole,
    fetch_ok: result.ok,
    fetch_error: result.reason,
    http_status: result.status,
    content_type: result.contentType,
    redirect_count: result.redirectChain.length,
    response_ms: result.durationMs,
    response_bytes: result.bytes,
    title: evidence?.title ?? null,
    meta_description: evidence?.metaDescription ?? null,
    h1_count: evidence?.h1Count ?? 0,
    h1_text: evidence?.h1Text ?? [],
    h2_count: evidence?.h2Count ?? 0,
    canonical_url: evidence?.canonicalUrl ?? null,
    meta_robots: evidence?.metaRobots ?? null,
    noindex: evidence?.noindex ?? false,
    nofollow: evidence?.nofollow ?? false,
    lang: evidence?.lang ?? null,
    has_viewport: evidence?.hasViewport ?? false,
    word_count: evidence?.wordCount ?? 0,
    internal_link_count: evidence?.internalLinkCount ?? 0,
    external_link_count: evidence?.externalLinkCount ?? 0,
    tel_link_count: evidence?.telLinkCount ?? 0,
    mailto_link_count: evidence?.mailtoLinkCount ?? 0,
    form_count: evidence?.formCount ?? 0,
    cta_count: evidence?.ctaCount ?? 0,
    json_ld_count: evidence?.jsonLdCount ?? 0,
    schema_types: evidence?.schemaTypes ?? [],
    has_structured_data: evidence?.hasStructuredData ?? false,
    evidence_json: {
      // v1/v2 keys, unchanged
      redirectChain: result.redirectChain,
      externalHosts: evidence?.externalHosts ?? [],
      ctaSamples: evidence?.ctaSamples ?? [],
      jsonLdParseErrors: evidence?.jsonLdParseErrors ?? 0,
      hasLocalBusinessSchema: evidence?.hasLocalBusinessSchema ?? false,
      canonicalMatchesFinal: evidence?.canonicalUrl && result.finalUrl ? normalizeAuditUrl(evidence.canonicalUrl)?.key === finalNormalized?.key : null,
      renderingMode: evidence?.renderingMode ?? "unknown",
      renderingSignals: evidence?.renderingSignals ?? null,
      // v3 additions (optional for readers; absent on older rows)
      evidenceVersion: EVIDENCE_VERSION,
      crawlerVersion: AUDIT_CRAWLER_VERSION,
      meaningfulRedirect: result.finalUrl ? isMeaningfulRedirect(entry.url, result.finalUrl) : false,
      roleSignals: classification?.signals ?? [],
      locality: classification?.locality ?? null,
      service: classification?.service ?? null,
      headingPattern: classification?.headingPattern ?? null,
      titleLength: evidence?.titleLength ?? null,
      metaDescriptionLength: evidence?.metaDescriptionLength ?? null,
      h1EmptyCount: evidence?.h1EmptyCount ?? 0,
      h2Text: evidence?.h2Text ?? [],
      breadcrumbNames: evidence?.breadcrumbNames ?? [],
      links: evidence?.links ?? [],
      linksTruncated: evidence?.linksTruncated ?? false,
      socialProfileLinks: evidence?.socialProfileLinks ?? [],
      nap: evidence?.nap ?? null,
      schema: evidence?.schema ?? null,
      headingFingerprint: evidence?.headingFingerprint ?? null,
      // RL-067: present only when the challenge detector matched. High confidence = this row is not website evidence.
      ...(challenge ? { challenge } : {}),
    },
    fetched_at: input.fetchedAt,
  };
  return { page, evidence, duplicateOf: null, challenge, challengeExcluded };
}

export type SitemapDiscovery = { robotsTxtReachable: boolean; robotsDisallowAll: boolean; sitemapReachable: boolean; sitemapUrlsDiscovered: number; sitemapUrlsSameSite: number; urls: string[] };

/** robots.txt then sitemap(s), bounded by MAX_AUX_REQUESTS. Never counts toward the page cap. */
export async function discoverSitemaps(fetcher: SafeFetcher, origin: string, state: CrawlState): Promise<SitemapDiscovery> {
  const discovery: SitemapDiscovery = { robotsTxtReachable: false, robotsDisallowAll: false, sitemapReachable: false, sitemapUrlsDiscovered: 0, sitemapUrlsSameSite: 0, urls: [] };
  const siteDomain = state.siteDomain;
  if (!siteDomain) return discovery;
  const fetchAux = async (url: string): Promise<SafeFetchResult | null> => {
    if (state.auxRequests >= MAX_AUX_REQUESTS) return null;
    state.auxRequests += 1;
    return fetcher.fetch(url, { sameSiteDomain: siteDomain, readContentTypes: READ_TEXT_TYPES });
  };

  let sitemapCandidates: string[] = [];
  const robots = await fetchAux(`${origin}/robots.txt`);
  if (robots?.ok && robots.status === 200 && robots.body !== null) {
    discovery.robotsTxtReachable = true;
    const parsed = parseRobotsTxt(robots.body, origin);
    discovery.robotsDisallowAll = parsed.disallowAll;
    sitemapCandidates = parsed.sitemaps.filter((url) => isSameSite(url, siteDomain)).slice(0, MAX_SITEMAP_FILES);
  }
  if (sitemapCandidates.length === 0) sitemapCandidates = [`${origin}/sitemap.xml`];

  const collected = new Set<string>();
  const queue = [...sitemapCandidates];
  let files = 0;
  while (queue.length > 0 && files < MAX_SITEMAP_FILES) {
    const url = queue.shift() as string;
    files += 1;
    const result = await fetchAux(url);
    if (!result?.ok || result.status !== 200 || result.body === null) continue;
    const parsed = parseSitemapXml(result.body, url);
    if (parsed.kind === "unknown") continue;
    discovery.sitemapReachable = true;
    if (parsed.kind === "index") {
      for (const child of parsed.urls.filter((candidate) => isSameSite(candidate, siteDomain))) if (queue.length + files < MAX_SITEMAP_FILES + 1) queue.push(child);
      continue;
    }
    for (const location of parsed.urls) collected.add(location);
  }
  discovery.sitemapUrlsDiscovered = collected.size;
  discovery.urls = [...collected].filter((url) => isSameSite(url, siteDomain));
  discovery.sitemapUrlsSameSite = discovery.urls.length;
  return discovery;
}

/** Site-level facts from the persisted pages plus crawl state. Re-derivable from stored rows on every finalisation. */
export function summariseSite(state: CrawlState, pages: (PageRow & Pick<WebsiteAuditPage, "schema_types">)[]): SiteSummary {
  const html = pages.filter(isHtmlSuccess);
  const partial = state.summary;
  const homepageFinalUrl = partial.homepageFinalUrl ?? null;
  const schemaTypes = new Set<string>();
  for (const page of html) for (const type of page.schema_types) schemaTypes.add(type);
  const homepage = html.find((page) => page.page_role === "homepage") ?? null;
  const homepageRenderingMode = homepage ? renderingModeOf(homepage) : "unknown";
  const v3 = html.some((page) => evidenceVersionOf(page) >= 3);

  const base: SiteSummary = {
    homepageUrl: partial.homepageUrl ?? "",
    homepageFinalUrl,
    homepageHttps: homepageFinalUrl ? homepageFinalUrl.startsWith("https://") : false,
    homepageStatus: partial.homepageStatus ?? null,
    homepageRedirectChain: partial.homepageRedirectChain ?? [],
    robotsTxtReachable: partial.robotsTxtReachable ?? false,
    robotsDisallowAll: partial.robotsDisallowAll ?? false,
    sitemapReachable: partial.sitemapReachable ?? false,
    sitemapUrlsDiscovered: partial.sitemapUrlsDiscovered ?? 0,
    sitemapUrlsSameSite: partial.sitemapUrlsSameSite ?? 0,
    pagesCrawled: html.length,
    pagesFailed: pages.filter((page) => !page.fetch_ok || (page.http_status !== null && page.http_status >= 400)).length,
    servicePagesFound: html.filter((page) => page.page_role === "service").length,
    locationPagesFound: html.filter((page) => page.page_role === "location").length,
    contactPageFound: html.some((page) => page.page_role === "contact"),
    aboutPageFound: html.some((page) => page.page_role === "about"),
    testimonialsPageFound: html.some((page) => page.page_role === "testimonials"),
    pagesWithLocalBusinessSchema: html.filter((page) => page.evidence_json?.hasLocalBusinessSchema === true).length,
    schemaTypesSeen: [...schemaTypes].sort(),
    brokenInternalLinks: pages.filter((page) => page.fetch_ok && (page.http_status === 404 || page.http_status === 410) && page.discovered_from).length,
    clientRenderedPages: html.filter((page) => renderingModeOf(page) === "client_rendered_likely").length,
    homepageRenderingMode,
    renderedContentEvaluated: homepageRenderingMode !== "client_rendered_likely",
  };
  // Secondary pages answered with a challenge document: provenance only, excluded from every count above.
  const challengePages = pages.filter(isChallengePage).map((page) => ({ path: page.path ?? page.requested_url, kind: readChallengeEvidence(page.evidence_json?.challenge)?.kind ?? null }));
  if (!v3) return challengePages.length > 0 ? { ...base, challengePages } : base;

  const graph = buildLinkGraph(pages);
  const duplicates = duplicateGroups(pages);
  const facts = rolePageFacts(pages);
  const internalRedirects = pages
    .filter((page) => page.fetch_ok && page.redirect_count > 0 && page.final_url && isMeaningfulRedirect(page.requested_url, page.final_url))
    .map((page) => ({ requestedUrl: page.requested_url, finalUrl: page.final_url as string, linkedFrom: inboundFor(graph, page).map((entry) => entry.path ?? "").filter(Boolean) }));
  const pagesWithoutInboundLinks = graph.truncated ? [] : html.filter((page) => page.page_role !== "homepage" && inboundFor(graph, page).length === 0).map((page) => page.path ?? page.requested_url);

  return {
    ...base,
    ...(challengePages.length > 0 ? { challengePages } : {}),
    evidenceVersion: EVIDENCE_VERSION,
    galleryPagesFound: html.filter((page) => page.page_role === "gallery").length,
    blogPagesFound: html.filter((page) => page.page_role === "blog").length,
    locationPages: facts.locationPages,
    servicePages: facts.servicePages,
    serviceLocationCombos: facts.serviceLocationCombos,
    nap: napSummary(pages),
    schema: schemaSummary(pages),
    duplicateTitleGroups: duplicates.titles.map((group) => ({ title: group.value, paths: group.paths })),
    duplicateMetaGroups: duplicates.metas.map((group) => ({ metaDescription: group.value, paths: group.paths })),
    duplicateTitleMetaPairs: duplicates.pairs.map((group) => ({ value: group.value, paths: group.paths })),
    homepageLinkCount: graph.homepageLinkCount,
    pagesWithoutInboundLinks,
    internalRedirects,
    linksTruncatedOnAnyPage: graph.truncated,
  };
}

/**
 * Summary of a run whose homepage was a high-confidence challenge document. Only what was observed about the response is stored;
 * no site fact (HTTPS, robots, sitemap, roles, NAP, schema) is derived, because none of them was measured on the real website.
 */
export function blockedSiteSummary(state: CrawlState, challenge: ChallengeEvidence): Pick<SiteSummary, "homepageUrl" | "homepageFinalUrl" | "homepageStatus" | "homepageRedirectChain" | "crawlBlocked" | "challenge"> {
  return { homepageUrl: state.summary.homepageUrl ?? "", homepageFinalUrl: state.summary.homepageFinalUrl ?? null, homepageStatus: state.summary.homepageStatus ?? null, homepageRedirectChain: state.summary.homepageRedirectChain ?? [], crawlBlocked: true, challenge };
}

export function siteOrigin(url: string): string | null {
  const normalized = normalizeAuditUrl(url);
  if (!normalized) return null;
  return new URL(normalized.url).origin;
}

export function siteDomainOf(url: string | null): string | null {
  return url ? normalizeDomain(url) : null;
}
