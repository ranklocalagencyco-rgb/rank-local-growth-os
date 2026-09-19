import { isBlockingChallenge, readChallengeEvidence } from "@/audit/challenge-detection";
import type { HeadingPattern } from "@/audit/classify";
import type { PageLink } from "@/audit/extract";
import type { NapEvidence } from "@/audit/nap";
import type { SchemaEvidence } from "@/audit/schema";
import { isLocationHubPath, normalizeAuditUrl } from "@/audit/url";
import type { WebsiteAuditPage } from "@/db/types";

// Cross-page, deterministic facts derived from stored page rows (audit-crawler/v3): link graph, duplicate groups,
// NAP and schema aggregates. Pure functions over rows so a retried finalisation recomputes exactly the same result.
// Rows written before v3 have no `evidenceVersion` and yield empty v3 evidence rather than errors.

export type PageRow = Pick<WebsiteAuditPage, "id" | "requested_url" | "final_url" | "path" | "page_role" | "fetch_ok" | "http_status" | "content_type" | "discovered_via" | "discovered_from" | "title" | "meta_description" | "canonical_url" | "word_count" | "redirect_count" | "evidence_json">;

/** Optional v3 fields read back from `evidence_json`. Every field has a safe default for older rows. */
export type PageEvidenceV3 = {
  links: PageLink[];
  linksTruncated: boolean;
  nap: NapEvidence | null;
  schema: SchemaEvidence | null;
  locality: string | null;
  service: string | null;
  headingPattern: HeadingPattern | null;
  titleLength: number | null;
  metaDescriptionLength: number | null;
  h1EmptyCount: number;
  breadcrumbNames: string[];
  roleSignals: string[];
  socialProfileLinks: { host: string; url: string }[];
};

export function evidenceVersionOf(page: Pick<WebsiteAuditPage, "evidence_json">): number {
  const value = page.evidence_json?.evidenceVersion;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * True for a row whose response was a high-confidence bot-challenge / interstitial document (RL-067). The HTTP fetch succeeded, but
 * the document is not the website, so the row is provenance only. Medium and low detections are recorded and change nothing.
 */
export function isChallengePage(page: { evidence_json?: WebsiteAuditPage["evidence_json"] | null }): boolean {
  return isBlockingChallenge(readChallengeEvidence(page.evidence_json?.challenge));
}

/** A fetched HTML document that counts as website evidence. Every summary, finding and score rule selects pages through this. */
export function isHtmlSuccess(page: Pick<WebsiteAuditPage, "fetch_ok" | "http_status" | "content_type"> & { evidence_json?: WebsiteAuditPage["evidence_json"] | null }): boolean {
  if (isChallengePage(page)) return false;
  return page.fetch_ok && page.http_status !== null && page.http_status >= 200 && page.http_status < 300 && /^(?:text\/html|application\/xhtml\+xml)/i.test(page.content_type ?? "");
}

/** Slash-agnostic key of the page's final (or requested) URL. */
export function pageKey(page: Pick<WebsiteAuditPage, "requested_url" | "final_url">): string | null {
  return normalizeAuditUrl(page.final_url ?? page.requested_url)?.key ?? null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** Reads the v3 evidence of a row; null for rows written before audit-crawler/v3. */
export function readEvidenceV3(page: Pick<WebsiteAuditPage, "evidence_json">): PageEvidenceV3 | null {
  if (evidenceVersionOf(page) < 3) return null;
  const json = page.evidence_json ?? {};
  const links = Array.isArray(json.links) ? (json.links as unknown[]).filter((entry): entry is PageLink => Boolean(entry && typeof entry === "object" && typeof (entry as PageLink).url === "string")) : [];
  const pattern = json.headingPattern;
  return {
    links,
    linksTruncated: json.linksTruncated === true,
    nap: json.nap && typeof json.nap === "object" ? (json.nap as NapEvidence) : null,
    schema: json.schema && typeof json.schema === "object" ? (json.schema as SchemaEvidence) : null,
    locality: typeof json.locality === "string" ? json.locality : null,
    service: typeof json.service === "string" ? json.service : null,
    headingPattern: pattern && typeof pattern === "object" && Array.isArray((pattern as HeadingPattern).places) ? (pattern as HeadingPattern) : null,
    titleLength: typeof json.titleLength === "number" ? json.titleLength : null,
    metaDescriptionLength: typeof json.metaDescriptionLength === "number" ? json.metaDescriptionLength : null,
    h1EmptyCount: typeof json.h1EmptyCount === "number" ? json.h1EmptyCount : 0,
    breadcrumbNames: stringArray(json.breadcrumbNames),
    roleSignals: stringArray(json.roleSignals),
    socialProfileLinks: Array.isArray(json.socialProfileLinks) ? (json.socialProfileLinks as { host: string; url: string }[]) : [],
  };
}

/** True when a redirect changed more than case or the trailing slash (scheme, host or path). */
export function isMeaningfulRedirect(requestedUrl: string, finalUrl: string | null): boolean {
  if (!finalUrl) return false;
  const requested = normalizeAuditUrl(requestedUrl);
  const final = normalizeAuditUrl(finalUrl);
  if (!requested || !final) return requestedUrl !== finalUrl;
  if (requested.key !== final.key) return true;
  return new URL(requested.url).protocol !== new URL(final.url).protocol;
}

export type InboundLink = { path: string | null; text: string | null };
export type LinkGraph = {
  /** Page key → crawled pages that link to it. Crawl scope only: pages outside the crawl never contribute. */
  inbound: Map<string, InboundLink[]>;
  /** Keys the homepage links to, or null when the homepage evidence cannot be evaluated (pre-v3 row or app shell). */
  homepageKeys: Set<string> | null;
  homepageLinkCount: number | null;
  /** True when any crawled page hit the stored-link cap; link-coverage rules are then suppressed. */
  truncated: boolean;
};

export function buildLinkGraph(pages: PageRow[]): LinkGraph {
  const inbound = new Map<string, InboundLink[]>();
  let homepageKeys: Set<string> | null = null;
  let homepageLinkCount: number | null = null;
  let truncated = false;
  for (const page of pages) {
    if (!isHtmlSuccess(page)) continue;
    const evidence = readEvidenceV3(page);
    if (!evidence) continue;
    if (evidence.linksTruncated) truncated = true;
    const keys = new Set<string>();
    for (const link of evidence.links) {
      const key = normalizeAuditUrl(link.url)?.key;
      if (!key) continue;
      keys.add(key);
      const list = inbound.get(key) ?? [];
      if (!list.some((entry) => entry.path === page.path)) list.push({ path: page.path, text: link.text ?? null });
      inbound.set(key, list);
    }
    if (page.page_role === "homepage" && page.evidence_json?.renderingMode !== "client_rendered_likely") {
      homepageKeys = keys;
      homepageLinkCount = keys.size;
    }
  }
  return { inbound, homepageKeys, homepageLinkCount, truncated };
}

/** Inbound links for a page by either of its keys (requested and final). */
export function inboundFor(graph: LinkGraph, page: Pick<WebsiteAuditPage, "requested_url" | "final_url">): InboundLink[] {
  const keys = new Set([normalizeAuditUrl(page.requested_url)?.key, page.final_url ? normalizeAuditUrl(page.final_url)?.key : null].filter((key): key is string => Boolean(key)));
  const out: InboundLink[] = [];
  for (const key of keys) for (const entry of graph.inbound.get(key) ?? []) if (!out.some((existing) => existing.path === entry.path)) out.push(entry);
  return out;
}

export function homepageLinksTo(graph: LinkGraph, page: Pick<WebsiteAuditPage, "requested_url" | "final_url">): boolean | null {
  if (!graph.homepageKeys) return null;
  const requested = normalizeAuditUrl(page.requested_url)?.key;
  const final = page.final_url ? normalizeAuditUrl(page.final_url)?.key : null;
  return Boolean((requested && graph.homepageKeys.has(requested)) || (final && graph.homepageKeys.has(final)));
}

export type DuplicateGroup = { value: string; paths: string[] };
export type DuplicateGroups = { titles: DuplicateGroup[]; metas: DuplicateGroup[]; pairs: DuplicateGroup[] };

function canonicalPointsElsewhere(page: PageRow): boolean {
  return page.evidence_json?.canonicalMatchesFinal === false;
}

/** Exact duplicates after lowercasing and whitespace collapse, across distinct final URLs, ignoring canonicalised copies. */
export function duplicateGroups(pages: PageRow[]): DuplicateGroups {
  const eligible = pages.filter((page) => isHtmlSuccess(page) && evidenceVersionOf(page) >= 3 && !canonicalPointsElsewhere(page));
  const group = (select: (page: PageRow) => string | null): DuplicateGroup[] => {
    const byValue = new Map<string, { value: string; keys: Set<string>; paths: string[] }>();
    for (const page of eligible) {
      const raw = select(page);
      const value = raw?.replace(/\s+/g, " ").trim().toLowerCase();
      if (!value) continue;
      const key = pageKey(page) ?? page.requested_url;
      const entry = byValue.get(value) ?? { value: raw!.replace(/\s+/g, " ").trim(), keys: new Set<string>(), paths: [] };
      if (!entry.keys.has(key)) {
        entry.keys.add(key);
        entry.paths.push(page.path ?? page.requested_url);
      }
      byValue.set(value, entry);
    }
    return [...byValue.values()].filter((entry) => entry.keys.size >= 2).map((entry) => ({ value: entry.value, paths: entry.paths }));
  };
  return {
    titles: group((page) => page.title),
    metas: group((page) => page.meta_description),
    pairs: group((page) => (page.title && page.meta_description ? `${page.title} || ${page.meta_description}` : null)),
  };
}

export type SiteNapSummary = {
  phones: { digits: string; raw: string; pages: number; sources: string[] }[];
  emails: { value: string; pages: number; sources: string[] }[];
  postcodes: { value: string; pages: number; sources: string[] }[];
  addressCandidates: { text: string; postcode: string | null; pages: number; sources: string[] }[];
  businessNames: { value: string; sources: string[] }[];
  localities: { value: string; sources: string[] }[];
  pagesWithPhone: number;
  pagesWithEmail: number;
  pagesWithAddressCandidate: number;
  pagesEvaluated: number;
};

function merge<T extends { sources: string[] }>(map: Map<string, T>, key: string, make: () => T, sources: string[], onExisting?: (entry: T) => void): void {
  const existing = map.get(key);
  if (existing) {
    for (const source of sources) if (!existing.sources.includes(source)) existing.sources.push(source);
    onExisting?.(existing);
    return;
  }
  map.set(key, { ...make(), sources: [...new Set(sources)] });
}

/** Aggregates observed NAP values across crawled pages. Observed values only; no canonical choice is made. */
export function napSummary(pages: PageRow[]): SiteNapSummary {
  const phones = new Map<string, SiteNapSummary["phones"][number]>();
  const emails = new Map<string, SiteNapSummary["emails"][number]>();
  const postcodes = new Map<string, SiteNapSummary["postcodes"][number]>();
  const addresses = new Map<string, SiteNapSummary["addressCandidates"][number]>();
  const names = new Map<string, SiteNapSummary["businessNames"][number]>();
  const localities = new Map<string, SiteNapSummary["localities"][number]>();
  let pagesWithPhone = 0;
  let pagesWithEmail = 0;
  let pagesWithAddressCandidate = 0;
  let pagesEvaluated = 0;

  for (const page of pages) {
    if (!isHtmlSuccess(page)) continue;
    const evidence = readEvidenceV3(page);
    if (!evidence) continue;
    pagesEvaluated += 1;
    const nap = evidence.nap;
    const schema = evidence.schema;
    const schemaPhone = schema?.localBusiness?.telephone ?? schema?.organization?.telephone ?? null;
    const schemaAddress = schema?.localBusiness?.address ?? schema?.organization?.address ?? null;
    if (nap) {
      if (nap.phones.length || schemaPhone) pagesWithPhone += 1;
      if (nap.emails.length) pagesWithEmail += 1;
      if (nap.addressCandidates.length || (schemaAddress && (schemaAddress.streetAddress || schemaAddress.postalCode))) pagesWithAddressCandidate += 1;
      for (const phone of nap.phones) merge(phones, phone.digits, () => ({ digits: phone.digits, raw: phone.raw, pages: 1, sources: [] }), phone.sources, (entry) => { entry.pages += 1; });
      for (const email of nap.emails) merge(emails, email.value, () => ({ value: email.value, pages: 1, sources: [] }), email.sources, (entry) => { entry.pages += 1; });
      for (const postcode of nap.postcodes) merge(postcodes, postcode.value, () => ({ value: postcode.value, pages: 1, sources: [] }), postcode.sources, (entry) => { entry.pages += 1; });
      for (const candidate of nap.addressCandidates) merge(addresses, candidate.text.toLowerCase(), () => ({ text: candidate.text, postcode: candidate.postcode, pages: 1, sources: [] }), [candidate.source], (entry) => { entry.pages += 1; });
      for (const name of nap.businessNames) merge(names, name.value.toLowerCase(), () => ({ value: name.value, sources: [] }), [name.source]);
    } else if (schemaPhone) pagesWithPhone += 1;
    if (schema?.localBusiness?.name) merge(names, schema.localBusiness.name.toLowerCase(), () => ({ value: schema.localBusiness!.name as string, sources: [] }), ["schema_localbusiness"]);
    if (schema?.organization?.name) merge(names, schema.organization.name.toLowerCase(), () => ({ value: schema.organization!.name as string, sources: [] }), ["schema_organization"]);
    if (schemaPhone) {
      const digits = schemaPhone.replace(/\D/g, "");
      if (digits.length >= 10) merge(phones, digits.startsWith("44") ? `0${digits.slice(2).replace(/^0/, "")}` : digits, () => ({ digits, raw: schemaPhone, pages: 1, sources: [] }), ["schema"], (entry) => { entry.pages += 1; });
    }
    if (schemaAddress?.postalCode) merge(postcodes, schemaAddress.postalCode.toUpperCase(), () => ({ value: schemaAddress.postalCode as string, pages: 1, sources: [] }), ["schema"], (entry) => { entry.pages += 1; });
    if (schemaAddress?.addressLocality) merge(localities, schemaAddress.addressLocality.toLowerCase(), () => ({ value: schemaAddress.addressLocality as string, sources: [] }), ["schema_address_locality"]);
    if (evidence.locality) merge(localities, evidence.locality.toLowerCase(), () => ({ value: evidence.locality as string, sources: [] }), [`role:${page.page_role}`]);
    if (evidence.headingPattern) for (const place of evidence.headingPattern.places) merge(localities, place.toLowerCase(), () => ({ value: place, sources: [] }), [`${evidence.headingPattern!.source}_in_pattern`]);
  }
  return { phones: [...phones.values()], emails: [...emails.values()], postcodes: [...postcodes.values()], addressCandidates: [...addresses.values()], businessNames: [...names.values()], localities: [...localities.values()].slice(0, 50), pagesWithPhone, pagesWithEmail, pagesWithAddressCandidate, pagesEvaluated };
}

export type SiteSchemaSummary = {
  localBusinessPages: number;
  organizationPages: number;
  localBusinessTypes: string[];
  hasName: boolean;
  hasTelephone: boolean;
  /** streetAddress, addressLocality and postalCode all present on at least one page's LocalBusiness. */
  hasAddress: boolean;
  addressLocality: string | null;
  areaServed: string[];
  hasGeo: boolean;
  sameAs: string[];
  hasAggregateRating: boolean;
  reviewCount: number;
  /** Fields missing from every LocalBusiness node seen; empty when none is missing or no LocalBusiness exists. */
  localBusinessMissingFields: string[];
};

export function schemaSummary(pages: PageRow[]): SiteSchemaSummary {
  const summary: SiteSchemaSummary = { localBusinessPages: 0, organizationPages: 0, localBusinessTypes: [], hasName: false, hasTelephone: false, hasAddress: false, addressLocality: null, areaServed: [], hasGeo: false, sameAs: [], hasAggregateRating: false, reviewCount: 0, localBusinessMissingFields: [] };
  const types = new Set<string>();
  const areaServed = new Set<string>();
  const sameAs = new Set<string>();
  for (const page of pages) {
    if (!isHtmlSuccess(page)) continue;
    const schema = readEvidenceV3(page)?.schema;
    if (!schema) continue;
    const local = schema.localBusiness;
    if (local) {
      summary.localBusinessPages += 1;
      for (const type of local.types) types.add(type);
      if (local.name) summary.hasName = true;
      if (local.telephone) summary.hasTelephone = true;
      if (local.address?.streetAddress && local.address.addressLocality && local.address.postalCode) summary.hasAddress = true;
      if (local.address?.addressLocality && !summary.addressLocality) summary.addressLocality = local.address.addressLocality;
      for (const area of local.areaServed) areaServed.add(area);
      if (local.geo) summary.hasGeo = true;
      for (const link of local.sameAs) sameAs.add(link);
    }
    if (schema.organization) {
      summary.organizationPages += 1;
      for (const link of schema.organization.sameAs) sameAs.add(link);
    }
    if (schema.aggregateRating) summary.hasAggregateRating = true;
    summary.reviewCount += schema.reviewCount ?? 0;
  }
  summary.localBusinessTypes = [...types].sort();
  summary.areaServed = [...areaServed].slice(0, 50);
  summary.sameAs = [...sameAs].slice(0, 25);
  if (summary.localBusinessPages > 0) {
    if (!summary.hasName) summary.localBusinessMissingFields.push("name");
    if (!summary.hasTelephone) summary.localBusinessMissingFields.push("telephone");
    if (!summary.hasAddress) summary.localBusinessMissingFields.push("address");
  }
  return summary;
}

export type LocationPageFact = { path: string; locality: string | null; hub: boolean };
export type ServicePageFact = { path: string; service: string | null };
export type ServiceLocationCombo = { path: string; service: string; locality: string };

export function rolePageFacts(pages: PageRow[]): { locationPages: LocationPageFact[]; servicePages: ServicePageFact[]; serviceLocationCombos: ServiceLocationCombo[] } {
  const locationPages: LocationPageFact[] = [];
  const servicePages: ServicePageFact[] = [];
  const serviceLocationCombos: ServiceLocationCombo[] = [];
  for (const page of pages) {
    if (!isHtmlSuccess(page)) continue;
    const path = page.path ?? page.requested_url;
    const evidence = readEvidenceV3(page);
    if (page.page_role === "location") locationPages.push({ path, locality: evidence?.locality ?? null, hub: isLocationHubPath(page.path) });
    if (page.page_role === "service") {
      const service = evidence?.service ?? evidence?.headingPattern?.subject ?? null;
      servicePages.push({ path, service });
      if (service && evidence?.headingPattern) for (const locality of evidence.headingPattern.places) serviceLocationCombos.push({ path, service, locality });
    }
  }
  return { locationPages, servicePages, serviceLocationCombos };
}
