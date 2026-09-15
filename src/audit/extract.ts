import { load, type CheerioAPI } from "cheerio";

import { isCrawlablePath, isSameSite, normalizeAuditUrl } from "@/audit/url";
import { normalizeDomain } from "@/domain/identifiers";

// Deterministic HTML evidence extraction (RL-052/053/055/056/057). Input is HTML text; output is facts only.
// No interpretation, no scoring, no LLM (ai/rules/no-llm-in-crawler.md).

export const AUDIT_CRAWLER_VERSION = "audit-crawler/v1";

/** Schema.org types the product cares about, matched case-insensitively against every @type / itemtype seen. */
export const TRACKED_SCHEMA_TYPES = ["LocalBusiness", "Organization", "Service", "WebSite", "WebPage", "BreadcrumbList", "FAQPage", "Review", "AggregateRating"] as const;

/** LocalBusiness and its common schema.org subtypes as seen on trade/local sites. */
export const LOCAL_BUSINESS_TYPE = /^(?:LocalBusiness|HomeAndConstructionBusiness|RoofingContractor|Plumber|Electrician|GeneralContractor|HVACBusiness|HousePainter|Locksmith|MovingCompany|ProfessionalService|LegalService|Attorney|Dentist|Physician|MedicalBusiness|AutoRepair|AutoDealer|Restaurant|Store|FinancialService|RealEstateAgent|TravelAgency|SportsActivityLocation|HealthAndBeautyBusiness|BeautySalon|HairSalon|DaySpa|ChildCare|EmploymentAgency|AnimalShelter|LodgingBusiness|Hotel|FoodEstablishment|EntertainmentBusiness|GovernmentOffice|Library|ShoppingCenter|SelfStorage|TouristInformationCenter|RadioStation|TelevisionStation|InternetCafe|DryCleaningOrLaundry|Florist|GardenStore|HardwareStore|HomeGoodsStore|PetStore|Bakery|CafeOrCoffeeShop|BarOrPub|Winery|Brewery|Distillery|NightClub|Dentist|Optician|Pharmacy|VeterinaryCare|Cleaner|Contractor)$/i;

const CTA_TEXT = /\b(?:get (?:a |your )?(?:free )?quote|free quote|request (?:a )?quote|quote now|call (?:us|now|today)|contact us|get in touch|book (?:now|online|an? appointment)|enquire(?: now)?|make an enquiry|request a callback|free estimate|get started|schedule|speak to|talk to us|email us|message us)\b/i;

export type PageEvidence = {
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  h1Text: string[];
  h2Count: number;
  canonicalUrl: string | null;
  metaRobots: string | null;
  noindex: boolean;
  nofollow: boolean;
  lang: string | null;
  hasViewport: boolean;
  wordCount: number;
  /** Normalised same-site crawlable URLs found on the page, deduplicated. */
  internalLinks: string[];
  internalLinkCount: number;
  externalLinkCount: number;
  externalHosts: string[];
  telLinkCount: number;
  mailtoLinkCount: number;
  formCount: number;
  ctaCount: number;
  ctaSamples: string[];
  jsonLdCount: number;
  jsonLdParseErrors: number;
  schemaTypes: string[];
  hasStructuredData: boolean;
  hasLocalBusinessSchema: boolean;
};

function clean(value: string | undefined | null): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

function collectTypes(node: unknown, out: Set<string>): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, out);
    return;
  }
  if (typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") out.add(type.trim());
  else if (Array.isArray(type)) for (const entry of type) if (typeof entry === "string") out.add(entry.trim());
  for (const [key, value] of Object.entries(record)) {
    if (key === "@type") continue;
    if (value && typeof value === "object") collectTypes(value, out);
  }
}

function lastSegment(value: string): string {
  return value.replace(/\/+$/, "").split("/").pop() ?? value;
}

function countWords($: CheerioAPI): number {
  const body = $("body").clone();
  body.find("script, style, noscript, template, svg, iframe").remove();
  const text = body.text().replace(/\s+/g, " ").trim();
  if (!text) return 0;
  return text.split(" ").filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** Extracts evidence from one HTML document. `finalUrl` resolves relative links; `siteDomain` classifies internal vs external. */
export function extractPageEvidence(html: string, finalUrl: string, siteDomain: string): PageEvidence {
  const $ = load(html);

  const h1 = $("h1").map((_, element) => clean($(element).text())).get().filter((text): text is string => Boolean(text));
  const robots = clean($('meta[name="robots" i]').attr("content")) ?? clean($('meta[name="googlebot" i]').attr("content"));
  const robotsTokens = (robots ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean);
  const canonicalRaw = clean($('link[rel="canonical" i]').attr("href"));
  let canonicalUrl: string | null = null;
  if (canonicalRaw) {
    try {
      canonicalUrl = new URL(canonicalRaw, finalUrl).toString();
    } catch {
      canonicalUrl = null;
    }
  }

  const internal = new Map<string, string>();
  const externalHosts = new Set<string>();
  let externalLinkCount = 0;
  let telLinkCount = 0;
  let mailtoLinkCount = 0;
  $("a[href]").each((_, element) => {
    const href = ($(element).attr("href") ?? "").trim();
    if (!href || href.startsWith("#")) return;
    const lower = href.toLowerCase();
    if (lower.startsWith("tel:")) { telLinkCount += 1; return; }
    if (lower.startsWith("mailto:")) { mailtoLinkCount += 1; return; }
    if (lower.startsWith("javascript:") || lower.startsWith("data:")) return;
    const normalized = normalizeAuditUrl(href, finalUrl);
    if (!normalized) return;
    if (isSameSite(normalized.url, siteDomain)) {
      if (isCrawlablePath(normalized.path) && !internal.has(normalized.key)) internal.set(normalized.key, normalized.url);
      else if (!isCrawlablePath(normalized.path) && !internal.has(normalized.key)) internal.set(normalized.key, ""); // counted, not crawled
    } else {
      externalLinkCount += 1;
      const host = normalizeDomain(normalized.url);
      if (host) externalHosts.add(host);
    }
  });

  const ctaSamples: string[] = [];
  let ctaCount = 0;
  $("a, button, input[type='submit'], input[type='button']").each((_, element) => {
    const node = $(element);
    const text = clean(node.text()) ?? clean(node.attr("value")) ?? clean(node.attr("aria-label")) ?? "";
    const hint = `${node.attr("class") ?? ""} ${node.attr("id") ?? ""}`.toLowerCase();
    const href = (node.attr("href") ?? "").toLowerCase();
    const isCta = CTA_TEXT.test(text) || /\b(?:cta|call-to-action|btn-primary|button--primary|quote|enquir|book-now)\b/.test(hint) || href.startsWith("tel:");
    if (!isCta) return;
    ctaCount += 1;
    if (text && ctaSamples.length < 5 && !ctaSamples.includes(text)) ctaSamples.push(text.slice(0, 60));
  });

  const schemaTypes = new Set<string>();
  let jsonLdCount = 0;
  let jsonLdParseErrors = 0;
  $('script[type="application/ld+json" i]').each((_, element) => {
    jsonLdCount += 1;
    const raw = $(element).text().trim();
    if (!raw) { jsonLdParseErrors += 1; return; }
    try {
      collectTypes(JSON.parse(raw), schemaTypes);
    } catch {
      jsonLdParseErrors += 1;
    }
  });
  $("[itemtype]").each((_, element) => {
    const value = clean($(element).attr("itemtype"));
    if (value) schemaTypes.add(lastSegment(value));
  });
  $("[typeof]").each((_, element) => {
    const value = clean($(element).attr("typeof"));
    if (value) for (const type of value.split(/\s+/)) schemaTypes.add(lastSegment(type));
  });
  const types = [...schemaTypes].filter(Boolean).sort();

  return {
    title: clean($("head > title").first().text()) ?? clean($("title").first().text()),
    metaDescription: clean($('meta[name="description" i]').attr("content")),
    h1Count: $("h1").length,
    h1Text: h1.slice(0, 10).map((text) => text.slice(0, 200)),
    h2Count: $("h2").length,
    canonicalUrl,
    metaRobots: robots,
    noindex: robotsTokens.includes("noindex") || robotsTokens.includes("none"),
    nofollow: robotsTokens.includes("nofollow") || robotsTokens.includes("none"),
    lang: clean($("html").attr("lang")),
    hasViewport: $('meta[name="viewport" i]').length > 0,
    wordCount: countWords($),
    internalLinks: [...internal.values()].filter(Boolean),
    internalLinkCount: internal.size,
    externalLinkCount,
    externalHosts: [...externalHosts].slice(0, 10),
    telLinkCount,
    mailtoLinkCount,
    formCount: $("form").length,
    ctaCount,
    ctaSamples,
    jsonLdCount,
    jsonLdParseErrors,
    schemaTypes: types,
    hasStructuredData: types.length > 0,
    hasLocalBusinessSchema: types.some((type) => LOCAL_BUSINESS_TYPE.test(type)),
  };
}
