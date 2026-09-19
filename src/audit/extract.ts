import { createHash } from "node:crypto";

import { load, type CheerioAPI } from "cheerio";

import { extractNapEvidence, type NapEvidence } from "@/audit/nap";
import { extractSchemaEvidence, type SchemaEvidence } from "@/audit/schema";
import { LOCAL_BUSINESS_TYPE, TRACKED_SCHEMA_TYPES } from "@/audit/schema-types";
import { MAX_H2_TEXT, MAX_SOCIAL_LINKS, MAX_STORED_LINKS_PER_PAGE } from "@/audit/thresholds";
import { isCrawlablePath, isSameSite, normalizeAuditUrl } from "@/audit/url";
import { normalizeDomain } from "@/domain/identifiers";

// Deterministic HTML evidence extraction (RL-052/053/055/056/057). Input is HTML text; output is facts only.
// No interpretation, no scoring, no LLM (ai/rules/no-llm-in-crawler.md).

export const AUDIT_CRAWLER_VERSION = "audit-crawler/v4";
/** Stored on every page's evidence_json; rules that need v3 evidence check it so older rows are never judged by new rules. */
export const EVIDENCE_VERSION = 3;

export { LOCAL_BUSINESS_TYPE, TRACKED_SCHEMA_TYPES };

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

const FOOTER_SELECTOR = "footer, [role='contentinfo'], #footer, .footer, .site-footer";
const HEADER_SELECTOR = "header, [role='banner'], #header, .header, .site-header";
const NAV_SELECTOR = "nav, [role='navigation']";

/** Registrable domains treated as social / profile / review platforms for `socialProfileLinks`. */
const SOCIAL_HOSTS = new Set(["facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "youtube.com", "tiktok.com", "checkatrade.com", "trustpilot.com", "yell.com", "pinterest.com", "nextdoor.co.uk", "g.page", "goo.gl", "trustatrader.com", "ratedpeople.com", "mybuilder.com"]);

export type PageLinkRegion = "nav" | "header" | "footer" | "main";
/** One same-site crawlable link as the page wrote it (trailing slash kept), with where it sits and its menu parent label. */
export type PageLink = { url: string; text: string | null; region: PageLinkRegion; group: string | null };

export type PageEvidence = {
  title: string | null;
  metaDescription: string | null;
  titleLength: number;
  metaDescriptionLength: number;
  h1Count: number;
  h1Text: string[];
  /** H1 elements present in the HTML but with no visible text (e.g. an image without alt). */
  h1EmptyCount: number;
  h2Count: number;
  h2Text: string[];
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
  /** Same-site crawlable links with anchor text, region and menu parent; capped at MAX_STORED_LINKS_PER_PAGE. */
  links: PageLink[];
  linksTruncated: boolean;
  socialProfileLinks: { host: string; url: string }[];
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
  schema: SchemaEvidence;
  breadcrumbNames: string[];
  nap: NapEvidence;
  /** sha1 of the lowercased H1/H2/H3 sequence; evidence only, no rule uses it yet. */
  headingFingerprint: string | null;
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

type AnyElement = Parameters<CheerioAPI>[0];

function linkRegion($: CheerioAPI, element: AnyElement): PageLinkRegion {
  const node = $(element);
  if (node.closest(FOOTER_SELECTOR).length) return "footer";
  if (node.closest(NAV_SELECTOR).length) return "nav";
  if (node.closest(HEADER_SELECTOR).length) return "header";
  return "main";
}

/** Label of the parent menu item for a link inside a nested list (`<li><a>Areas We Cover</a><ul><li><a>Uxbridge</a>`). */
function linkGroup($: CheerioAPI, element: AnyElement): string | null {
  const item = $(element).closest("li");
  if (!item.length) return null;
  const parentItem = item.parent("ul, ol").parent("li");
  if (!parentItem.length) return null;
  const label = parentItem.children("a, span, button, p, div").first();
  const text = clean(label.clone().children("ul, ol").remove().end().text());
  return text ? text.slice(0, 60) : null;
}

function anchorText($: CheerioAPI, element: AnyElement): string | null {
  const node = $(element);
  const text = clean(node.text()) ?? clean(node.attr("aria-label")) ?? clean(node.attr("title")) ?? clean(node.find("img[alt]").first().attr("alt"));
  return text ? text.slice(0, 80) : null;
}

/** `normalizeDomain` keeps subdomains (`m.facebook.com`, `uk.linkedin.com`), so match on the registrable suffix. */
function isSocialHost(host: string, url: string): boolean {
  for (const social of SOCIAL_HOSTS) if (host === social || host.endsWith(`.${social}`)) return true;
  return (host === "google.com" || host.endsWith(".google.com")) && /\/maps\b|maps\.google|business\.google|\/local\b/i.test(url);
}

/** Extracts evidence from one HTML document. `finalUrl` resolves relative links; `siteDomain` classifies internal vs external. */
export function extractPageEvidence(html: string, finalUrl: string, siteDomain: string): PageEvidence {
  const $ = load(html);

  const h1All = $("h1").map((_, element) => clean($(element).text())).get();
  const h1 = h1All.filter((text): text is string => Boolean(text));
  const h2 = $("h2").map((_, element) => clean($(element).text())).get().filter((text): text is string => Boolean(text));
  const h3 = $("h3").map((_, element) => clean($(element).text())).get().filter((text): text is string => Boolean(text));
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
  const links = new Map<string, PageLink>();
  let linksTruncated = false;
  const externalHosts = new Set<string>();
  const social = new Map<string, { host: string; url: string }>();
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
      const crawlable = isCrawlablePath(normalized.path);
      if (crawlable && !internal.has(normalized.key)) internal.set(normalized.key, normalized.url);
      else if (!crawlable && !internal.has(normalized.key)) internal.set(normalized.key, ""); // counted, not crawled
      if (!crawlable) return;
      const existing = links.get(normalized.key);
      const text = anchorText($, element);
      const group = linkGroup($, element);
      if (existing) {
        if (!existing.text && text) existing.text = text;
        if (!existing.group && group) existing.group = group;
      } else if (links.size < MAX_STORED_LINKS_PER_PAGE) {
        links.set(normalized.key, { url: normalized.url, text, region: linkRegion($, element), group });
      } else {
        linksTruncated = true;
      }
    } else {
      externalLinkCount += 1;
      const host = normalizeDomain(normalized.url);
      if (host) {
        externalHosts.add(host);
        if (isSocialHost(host, normalized.url) && !social.has(normalized.url) && social.size < MAX_SOCIAL_LINKS) social.set(normalized.url, { host, url: normalized.url });
      }
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
  const jsonLdDocuments: unknown[] = [];
  let jsonLdCount = 0;
  let jsonLdParseErrors = 0;
  $('script[type="application/ld+json" i]').each((_, element) => {
    jsonLdCount += 1;
    const raw = $(element).text().trim();
    if (!raw) { jsonLdParseErrors += 1; return; }
    try {
      const parsed: unknown = JSON.parse(raw);
      jsonLdDocuments.push(parsed);
      collectTypes(parsed, schemaTypes);
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
  const schema = extractSchemaEvidence(jsonLdDocuments, $);

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

  const title = clean($("head > title").first().text()) ?? clean($("title").first().text());
  const metaDescription = clean($('meta[name="description" i]').attr("content"));
  const headings = [...h1, ...h2, ...h3].map((text) => text.toLowerCase());

  return {
    title,
    metaDescription,
    titleLength: title?.length ?? 0,
    metaDescriptionLength: metaDescription?.length ?? 0,
    h1Count,
    h1Text: h1.slice(0, 10).map((text) => text.slice(0, 200)),
    h1EmptyCount: Math.max(0, h1Count - h1.length),
    h2Count,
    h2Text: h2.slice(0, MAX_H2_TEXT).map((text) => text.slice(0, 120)),
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
    links: [...links.values()],
    linksTruncated,
    socialProfileLinks: [...social.values()],
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
    schema,
    breadcrumbNames: schema.breadcrumbNames,
    nap: extractNapEvidence($),
    headingFingerprint: headings.length ? createHash("sha1").update(headings.join("\n")).digest("hex") : null,
    renderingMode: classifyRenderingMode(renderingSignals, html.trim().length === 0),
    renderingSignals,
  };
}
