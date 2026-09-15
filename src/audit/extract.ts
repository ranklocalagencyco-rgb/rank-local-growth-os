import { load, type CheerioAPI } from "cheerio";

import { isCrawlablePath, isSameSite, normalizeAuditUrl } from "@/audit/url";
import { normalizeDomain } from "@/domain/identifiers";

// Deterministic HTML evidence extraction (RL-052/053/055/056/057). Input is HTML text; output is facts only.
// No interpretation, no scoring, no LLM (ai/rules/no-llm-in-crawler.md).

export const AUDIT_CRAWLER_VERSION = "audit-crawler/v2";

/** Schema.org types the product cares about, matched case-insensitively against every @type / itemtype seen. */
export const TRACKED_SCHEMA_TYPES = ["LocalBusiness", "Organization", "Service", "WebSite", "WebPage", "BreadcrumbList", "FAQPage", "Review", "AggregateRating"] as const;

/** LocalBusiness and its common schema.org subtypes as seen on trade/local sites. */
export const LOCAL_BUSINESS_TYPE = /^(?:LocalBusiness|HomeAndConstructionBusiness|RoofingContractor|Plumber|Electrician|GeneralContractor|HVACBusiness|HousePainter|Locksmith|MovingCompany|ProfessionalService|LegalService|Attorney|Dentist|Physician|MedicalBusiness|AutoRepair|AutoDealer|Restaurant|Store|FinancialService|RealEstateAgent|TravelAgency|SportsActivityLocation|HealthAndBeautyBusiness|BeautySalon|HairSalon|DaySpa|ChildCare|EmploymentAgency|AnimalShelter|LodgingBusiness|Hotel|FoodEstablishment|EntertainmentBusiness|GovernmentOffice|Library|ShoppingCenter|SelfStorage|TouristInformationCenter|RadioStation|TelevisionStation|InternetCafe|DryCleaningOrLaundry|Florist|GardenStore|HardwareStore|HomeGoodsStore|PetStore|Bakery|CafeOrCoffeeShop|BarOrPub|Winery|Brewery|Distillery|NightClub|Dentist|Optician|Pharmacy|VeterinaryCare|Cleaner|Contractor)$/i;

const CTA_TEXT = /\b(?:get (?:a |your )?(?:free )?quote|free quote|request (?:a )?quote|quote now|call (?:us|now|today)|contact us|get in touch|book (?:now|online|an? appointment)|enquire(?: now)?|make an enquiry|request a callback|free estimate|get started|schedule|speak to|talk to us|email us|message us)\b/i;

/**
 * How the server-rendered HTML was classified. This crawler never executes JavaScript, so
 * "client_rendered_likely" means content-dependent checks could not be evaluated, not that the site lacks content.
 */
export type RenderingMode = "server_rendered" | "client_rendered_likely" | "unknown";

/** The raw counts the rendering classification was made from. Stored with the page so the decision is auditable. */
export type RenderingSignals = {
  wordCount: number;
  headingCount: number;
  linkCount: number;
  formCount: number;
  scriptCount: number;
  moduleScriptCount: number;
  appBundleScriptCount: number;
  emptyAppRoot: boolean;
};

/** App-shell thresholds. A page must fail ALL of content, structure and script signals to be classified client-rendered. */
export const APP_SHELL_MAX_WORDS = 20;
export const APP_SHELL_MAX_LINKS = 2;

/** Script src paths typical of bundled front-end apps (Vite, Next, Nuxt, CRA, Gatsby, Webpack output). */
const APP_BUNDLE_SRC = /(?:^|\/)(?:assets|static|_next|_nuxt|_app|build|dist|bundles?)\/[^"'?#]*\.m?js(?:[?#]|$)|\/(?:main|app|index|bundle|runtime|vendors?|chunk)[.-][A-Za-z0-9_]{4,}\.m?js(?:[?#]|$)/i;
/** Mount points that client-side frameworks fill at runtime. Empty on the server response when the app is client-rendered. */
const APP_ROOT_SELECTOR = "#root, #app, #__next, #__nuxt, #___gatsby, #svelte, [data-reactroot], [data-server-rendered]";

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
  renderingMode: RenderingMode;
  renderingSignals: RenderingSignals;
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

/** Counts the script and mount-point facts used by the rendering classification. */
function scriptSignals($: CheerioAPI): Pick<RenderingSignals, "scriptCount" | "moduleScriptCount" | "appBundleScriptCount" | "emptyAppRoot"> {
  let scriptCount = 0;
  let moduleScriptCount = 0;
  let appBundleScriptCount = 0;
  $("script").each((_, element) => {
    const node = $(element);
    const type = (node.attr("type") ?? "").trim().toLowerCase();
    if (type === "application/ld+json" || type === "application/json" || type.startsWith("text/template")) return;
    scriptCount += 1;
    if (type === "module") moduleScriptCount += 1;
    const src = (node.attr("src") ?? "").trim();
    if (src && APP_BUNDLE_SRC.test(src)) appBundleScriptCount += 1;
  });
  let emptyAppRoot = false;
  $(APP_ROOT_SELECTOR).each((_, element) => {
    if (emptyAppRoot) return;
    const node = $(element).clone();
    node.find("script, style, noscript, template").remove();
    if (!node.text().replace(/\s+/g, "").length) emptyAppRoot = true;
  });
  return { scriptCount, moduleScriptCount, appBundleScriptCount, emptyAppRoot };
}

/**
 * Conservative app-shell classification. Three independent signals must all agree:
 * a front-end bundle or empty framework mount point, near-zero visible text, and no server-rendered structure.
 * A sparse but ordinary HTML page (no bundle) or a page with real text is always "server_rendered".
 */
export function classifyRenderingMode(signals: RenderingSignals, isEmptyDocument = false): RenderingMode {
  if (isEmptyDocument) return "unknown";
  const scriptSignal = signals.moduleScriptCount > 0 || signals.appBundleScriptCount > 0 || signals.emptyAppRoot;
  const contentSignal = signals.wordCount <= APP_SHELL_MAX_WORDS;
  const structureSignal = signals.headingCount === 0 && signals.formCount === 0 && signals.linkCount <= APP_SHELL_MAX_LINKS;
  return scriptSignal && contentSignal && structureSignal ? "client_rendered_likely" : "server_rendered";
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

  const h1Count = $("h1").length;
  const h2Count = $("h2").length;
  const formCount = $("form").length;
  const wordCount = countWords($);
  const renderingSignals: RenderingSignals = {
    wordCount,
    headingCount: h1Count + h2Count + $("h3").length,
    linkCount: internal.size + externalLinkCount,
    formCount,
    ...scriptSignals($),
  };

  return {
    title: clean($("head > title").first().text()) ?? clean($("title").first().text()),
    metaDescription: clean($('meta[name="description" i]').attr("content")),
    h1Count,
    h1Text: h1.slice(0, 10).map((text) => text.slice(0, 200)),
    h2Count,
    canonicalUrl,
    metaRobots: robots,
    noindex: robotsTokens.includes("noindex") || robotsTokens.includes("none"),
    nofollow: robotsTokens.includes("nofollow") || robotsTokens.includes("none"),
    lang: clean($("html").attr("lang")),
    hasViewport: $('meta[name="viewport" i]').length > 0,
    wordCount,
    internalLinks: [...internal.values()].filter(Boolean),
    internalLinkCount: internal.size,
    externalLinkCount,
    externalHosts: [...externalHosts].slice(0, 10),
    telLinkCount,
    mailtoLinkCount,
    formCount,
    ctaCount,
    ctaSamples,
    jsonLdCount,
    jsonLdParseErrors,
    schemaTypes: types,
    hasStructuredData: types.length > 0,
    hasLocalBusinessSchema: types.some((type) => LOCAL_BUSINESS_TYPE.test(type)),
    renderingMode: classifyRenderingMode(renderingSignals, html.trim().length === 0),
    renderingSignals,
  };
}
