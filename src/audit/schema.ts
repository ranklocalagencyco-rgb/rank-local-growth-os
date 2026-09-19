import type { CheerioAPI } from "cheerio";

import { LOCAL_BUSINESS_TYPE } from "@/audit/schema-types";
import { MAX_BREADCRUMB_ITEMS } from "@/audit/thresholds";

// Deterministic structured-data evidence (audit-crawler/v3): which local-business facts the page's JSON-LD / microdata
// actually carry. Presence and shape only; no eligibility claims (docs/MASTER_BUILD_SPEC.md §11.3).

export type SchemaAddress = { streetAddress: string | null; addressLocality: string | null; addressRegion: string | null; postalCode: string | null; addressCountry: string | null };

export type LocalBusinessSchema = {
  types: string[];
  name: string | null;
  telephone: string | null;
  address: SchemaAddress | null;
  areaServed: string[];
  geo: { latitude: number; longitude: number } | null;
  sameAs: string[];
  openingHours: boolean;
  priceRange: boolean;
};

export type OrganizationSchema = { name: string | null; telephone: string | null; address: SchemaAddress | null; sameAs: string[]; logo: boolean };

export type SchemaEvidence = {
  localBusiness: LocalBusinessSchema | null;
  organization: OrganizationSchema | null;
  aggregateRating: { ratingValue: number | null; ratingCount: number | null } | null;
  reviewCount: number;
  hasService: boolean;
  breadcrumbNames: string[];
};

type Node = Record<string, unknown>;

function isObject(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function typesOf(node: Node): string[] {
  const type = node["@type"];
  if (typeof type === "string") return [type.trim()];
  if (Array.isArray(type)) return type.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim());
  return [];
}

function text(value: unknown): string | null {
  if (typeof value === "string") {
    const clean = value.replace(/\s+/g, " ").trim();
    return clean ? clean.slice(0, 200) : null;
  }
  if (typeof value === "number") return String(value);
  return null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Collects every typed node in document order and an @id map for reference resolution. */
function collectNodes(documents: unknown[]): { nodes: Node[]; byId: Map<string, Node> } {
  const nodes: Node[] = [];
  const byId = new Map<string, Node>();
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number) => {
    if (!value || depth > 12 || seen.has(value)) return;
    if (Array.isArray(value)) {
      seen.add(value);
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (!isObject(value)) return;
    seen.add(value);
    if (typesOf(value).length) nodes.push(value);
    const id = value["@id"];
    if (typeof id === "string" && !byId.has(id) && Object.keys(value).length > 1) byId.set(id, value);
    for (const [key, child] of Object.entries(value)) if (key !== "@type" && child && typeof child === "object") walk(child, depth + 1);
  };
  for (const document of documents) walk(document, 0);
  return { nodes, byId };
}

function makeResolver(byId: Map<string, Node>) {
  return (value: unknown): unknown => {
    if (isObject(value) && typeof value["@id"] === "string" && Object.keys(value).length === 1) return byId.get(value["@id"]) ?? value;
    return value;
  };
}

function strings(value: unknown, resolve: (value: unknown) => unknown): string[] {
  const out: string[] = [];
  const push = (entry: unknown) => {
    const resolved = resolve(entry);
    if (typeof resolved === "string") { const clean = text(resolved); if (clean) out.push(clean); return; }
    if (isObject(resolved)) { const name = text(resolved.name) ?? text(resolved.url) ?? text(resolved["@id"]); if (name) out.push(name); }
  };
  if (Array.isArray(value)) for (const entry of value) push(entry);
  else if (value !== undefined && value !== null) push(value);
  return [...new Set(out)].slice(0, 25);
}

function address(value: unknown, resolve: (value: unknown) => unknown): SchemaAddress | null {
  const resolved = resolve(Array.isArray(value) ? value[0] : value);
  if (typeof resolved === "string") return text(resolved) ? { streetAddress: text(resolved), addressLocality: null, addressRegion: null, postalCode: null, addressCountry: null } : null;
  if (!isObject(resolved)) return null;
  const country = resolve(resolved.addressCountry);
  const out: SchemaAddress = {
    streetAddress: text(resolved.streetAddress),
    addressLocality: text(resolved.addressLocality),
    addressRegion: text(resolved.addressRegion),
    postalCode: text(resolved.postalCode),
    addressCountry: isObject(country) ? text(country.name) : text(country),
  };
  return Object.values(out).some(Boolean) ? out : null;
}

function geo(value: unknown, resolve: (value: unknown) => unknown): { latitude: number; longitude: number } | null {
  const resolved = resolve(Array.isArray(value) ? value[0] : value);
  if (!isObject(resolved)) return null;
  const latitude = number(resolved.latitude);
  const longitude = number(resolved.longitude);
  return latitude !== null && longitude !== null ? { latitude, longitude } : null;
}

function breadcrumbFromJsonLd(nodes: Node[], resolve: (value: unknown) => unknown): string[] {
  const list = nodes.find((node) => typesOf(node).some((type) => /^BreadcrumbList$/i.test(type)));
  if (!list || !Array.isArray(list.itemListElement)) return [];
  const items = list.itemListElement
    .map((entry) => resolve(entry))
    .filter(isObject)
    .map((entry) => ({ position: number(entry.position) ?? Number.MAX_SAFE_INTEGER, name: text(entry.name) ?? (isObject(resolve(entry.item)) ? text((resolve(entry.item) as Node).name) : null) }))
    .filter((entry): entry is { position: number; name: string } => Boolean(entry.name))
    .sort((a, b) => a.position - b.position);
  return items.map((entry) => entry.name).slice(0, MAX_BREADCRUMB_ITEMS);
}

const BREADCRUMB_SEPARATOR = /^(?:[>»›/|→•·-]+|home)?$/i;

function breadcrumbFromHtml($: CheerioAPI): string[] {
  const container = $("nav[aria-label*='breadcrumb' i], .breadcrumb, .breadcrumbs, [itemtype*='BreadcrumbList' i], [class*='breadcrumb' i]").first();
  if (!container.length) return [];
  const items = container.find("li").length ? container.find("li") : container.find("a, span[itemprop='name'], span[property='name']");
  const names = items.map((_, element) => text($(element).clone().children("ul, ol").remove().end().text())).get().filter((name): name is string => Boolean(name) && !/^[>»›/|→•·-]+$/.test(name));
  return [...new Set(names)].slice(0, MAX_BREADCRUMB_ITEMS);
}

/** Microdata fallback for pages without JSON-LD LocalBusiness. */
function microdataLocalBusiness($: CheerioAPI): LocalBusinessSchema | null {
  const scope = $("[itemscope][itemtype]").filter((_, element) => LOCAL_BUSINESS_TYPE.test(($(element).attr("itemtype") ?? "").replace(/\/+$/, "").split("/").pop() ?? "")).first();
  if (!scope.length) return null;
  const prop = (name: string) => text(scope.find(`[itemprop='${name}']`).first().attr("content") ?? scope.find(`[itemprop='${name}']`).first().text());
  const addressNode = scope.find("[itemprop='address']").first();
  const addr: SchemaAddress | null = addressNode.length
    ? { streetAddress: prop("streetAddress"), addressLocality: prop("addressLocality"), addressRegion: prop("addressRegion"), postalCode: prop("postalCode"), addressCountry: prop("addressCountry") }
    : null;
  return {
    types: [(scope.attr("itemtype") ?? "").replace(/\/+$/, "").split("/").pop() ?? "LocalBusiness"],
    name: prop("name"),
    telephone: prop("telephone"),
    address: addr && Object.values(addr).some(Boolean) ? addr : null,
    areaServed: scope.find("[itemprop='areaServed']").map((_, element) => text($(element).text())).get().filter((v): v is string => Boolean(v)),
    geo: null,
    sameAs: scope.find("[itemprop='sameAs']").map((_, element) => text($(element).attr("href") ?? $(element).attr("content") ?? $(element).text())).get().filter((v): v is string => Boolean(v)),
    openingHours: scope.find("[itemprop='openingHours'], [itemprop='openingHoursSpecification']").length > 0,
    priceRange: scope.find("[itemprop='priceRange']").length > 0,
  };
}

/** Builds structured-data evidence from parsed JSON-LD documents and the DOM. Deterministic; first matching node wins. */
export function extractSchemaEvidence(jsonLdDocuments: unknown[], $: CheerioAPI): SchemaEvidence {
  const { nodes, byId } = collectNodes(jsonLdDocuments);
  const resolve = makeResolver(byId);

  const localNode = nodes.find((node) => typesOf(node).some((type) => LOCAL_BUSINESS_TYPE.test(type))) ?? null;
  const organizationNode = nodes.find((node) => typesOf(node).some((type) => /^Organization$/i.test(type)) && node !== localNode) ?? null;
  const ratingNode = nodes.find((node) => typesOf(node).some((type) => /^AggregateRating$/i.test(type))) ?? null;

  const localBusiness: LocalBusinessSchema | null = localNode
    ? {
        types: typesOf(localNode),
        name: text(localNode.name),
        telephone: text(localNode.telephone),
        address: address(localNode.address, resolve),
        areaServed: strings(localNode.areaServed, resolve),
        geo: geo(localNode.geo, resolve),
        sameAs: strings(localNode.sameAs, resolve),
        openingHours: localNode.openingHours !== undefined || localNode.openingHoursSpecification !== undefined,
        priceRange: localNode.priceRange !== undefined,
      }
    : microdataLocalBusiness($);

  const organization: OrganizationSchema | null = organizationNode
    ? { name: text(organizationNode.name), telephone: text(organizationNode.telephone), address: address(organizationNode.address, resolve), sameAs: strings(organizationNode.sameAs, resolve), logo: organizationNode.logo !== undefined }
    : null;

  const jsonLdBreadcrumb = breadcrumbFromJsonLd(nodes, resolve);
  return {
    localBusiness,
    organization,
    aggregateRating: ratingNode ? { ratingValue: number(ratingNode.ratingValue), ratingCount: number(ratingNode.ratingCount) ?? number(ratingNode.reviewCount) } : null,
    reviewCount: nodes.filter((node) => typesOf(node).some((type) => /^Review$/i.test(type))).length,
    hasService: nodes.some((node) => typesOf(node).some((type) => /^Service$/i.test(type))),
    breadcrumbNames: jsonLdBreadcrumb.length ? jsonLdBreadcrumb : breadcrumbFromHtml($),
  };
}
