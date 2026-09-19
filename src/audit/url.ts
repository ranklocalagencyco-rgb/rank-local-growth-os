import type { AuditDiscoveredVia, AuditPageRole } from "@/db/types";
import { normalizeDomain } from "@/domain/identifiers";

// URL rules for the website audit crawler (RL-051/RL-055). Pure functions, no I/O.
// Deterministic by design: no LLM is involved anywhere in the audit fetch/parse path (ai/rules/no-llm-in-crawler.md).

export type NormalizedAuditUrl = {
  /**
   * Absolute URL to fetch: lowercase host, no default port, no query, no fragment, duplicate slashes collapsed,
   * index files removed. The trailing slash is kept exactly as the site wrote it (audit-crawler/v3) so the crawler
   * requests what the site links to and redirect evidence reflects the site, not our normalisation.
   */
  url: string;
  /** Scheme-agnostic, slash-agnostic dedupe key (host + path without trailing slash). `/x` and `/x/` share a key. */
  key: string;
  /** Path without trailing slash (root stays `/`). Used for classification and storage. */
  path: string;
  host: string;
};

const BINARY_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|tiff?|avif|heic|pdf|docx?|xlsx?|pptx?|odt|rtf|zip|rar|7z|gz|tgz|tar|bz2|mp[34]|m4[av]|mov|avi|wmv|webm|mkv|ogg|wav|flac|css|js|mjs|cjs|map|json|xml|rss|atom|txt|woff2?|ttf|eot|otf|exe|msi|dmg|apk|csv|ics|vcf)$/i;
const SKIP_SEGMENTS = /(^|\/)(?:wp-admin|wp-login\.php|wp-json|xmlrpc\.php|admin|administrator|login|logout|log-in|signin|sign-in|signup|sign-up|register|account|my-account|dashboard|cart|basket|checkout|search|tag|tags|feed|rss|author|category|categories|attachment|cgi-bin|calendar|events\/\d{4}|page\/\d+|\?s=)(?:\/|$)/i;
const INDEX_FILE = /\/index\.(?:html?|php|aspx?)$/i;

/** Parses and normalises a URL for crawling. Returns null for anything that is not an http(s) URL with a public-looking host. */
export function normalizeAuditUrl(input: string, base?: string): NormalizedAuditUrl | null {
  let url: URL;
  try {
    url = base ? new URL(input.trim(), base) : new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) return null;
  const defaultPort = (url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443");
  const port = defaultPort ? "" : url.port;

  let fetchPath = url.pathname.replace(/\/{2,}/g, "/").replace(INDEX_FILE, "/");
  if (!fetchPath) fetchPath = "/";
  const path = fetchPath.length > 1 ? fetchPath.replace(/\/+$/, "") : fetchPath;

  const authority = port ? `${host}:${port}` : host;
  return { url: `${url.protocol}//${authority}${fetchPath}`, key: `${authority}${path}`.toLowerCase(), path, host };
}

/** True when the URL belongs to the audited site (same registrable domain, `www.` ignored). */
export function isSameSite(url: string, siteDomain: string): boolean {
  const domain = normalizeDomain(url);
  return domain !== null && domain === siteDomain;
}

/** Rejects binaries, feeds, admin/auth/commerce areas and pagination-like paths. */
export function isCrawlablePath(path: string): boolean {
  if (BINARY_EXTENSIONS.test(path)) return false;
  if (SKIP_SEGMENTS.test(path)) return false;
  return true;
}

/** Trade / service vocabulary shared by the path rule and the heading rules in classify.ts. */
export const TRADE_KEYWORDS = "roof|roofing|gutter|fascia|soffit|plumb|heating|boiler|electric|clean|build|extension|loft|landscap|garden|paving|driveway|fencing|paint|decorat|tiling|plaster|render|glazing|window|door|kitchen|bathroom|flooring|carpet|removal|clearance|pest|tree|scaffold|solar|drain|lock|repair|install|service";
export const TRADE_KEYWORD_PATTERN = new RegExp(`(?:${TRADE_KEYWORDS})`, "i");

const BLOG = /^\/(?:blog|news|articles?|posts?|guides?|insights|resources)(?:\/|$)|^\/\d{4}\/\d{2}(?:\/|$)/i;
const CONTACT = /(^|\/)(?:contact|contact-us|contactus|get-in-touch|enquir(?:e|y|ies)|inquir(?:e|y|ies)|quote|free-quote|request-a-quote|get-a-quote|book|booking|appointment)s?(?:\/|$)/i;
const ABOUT = /(^|\/)(?:about|about-us|aboutus|our-story|who-we-are|meet-the-team|team|our-team|company|history)(?:\/|$)/i;
const TESTIMONIALS = /(^|\/)(?:testimonials?|reviews?|feedback|case-stud(?:y|ies)|success-stories|what-our-customers-say)(?:\/|$)/i;
const GALLERY = /(^|\/)(?:gallery|galleries|portfolio|our-work|projects?|photos?|before-and-after|[a-z0-9-]+-gallery)(?:\/|$)/i;
const LOCATION = /(^|\/)(?:areas?|areas-we-cover|areas-covered|service-areas?|locations?|coverage|where-we-work|near-me)(?:\/|$)|-in-[a-z]|(^|\/)[a-z0-9-]+-(?:area|areas|locations?)(?:\/|$)/i;
const SERVICE = new RegExp(`(^|\\/)(?:services?|our-services|what-we-do|solutions|products?|treatments?|repairs?|installations?|maintenance|offerings?)(?:\\/|$)|(?:^|\\/)[a-z0-9-]*(?:${TRADE_KEYWORDS})[a-z0-9-]*(?:\\/|$)`, "i");
/** Hub pages that list service areas rather than describing one location. */
const LOCATION_HUB = /(^|\/)(?:areas?|areas-we-cover|areas-covered|service-areas?|locations?|coverage|where-we-work)(?:\/|$)/i;

/**
 * Deterministic role classification from the URL path only. First match wins; blog runs first so `/blog/how-to-book`
 * is not a contact page and gallery runs before service so `/roofing-gallery` is a gallery.
 * Multi-signal classification (title, H1, breadcrumb, nav context) lives in classify.ts and falls back to this.
 */
export function classifyPageRole(path: string): AuditPageRole {
  if (path === "/" || path === "") return "homepage";
  if (BLOG.test(path)) return "blog";
  if (CONTACT.test(path)) return "contact";
  if (TESTIMONIALS.test(path)) return "testimonials";
  if (ABOUT.test(path)) return "about";
  if (GALLERY.test(path)) return "gallery";
  if (LOCATION.test(path)) return "location";
  if (SERVICE.test(path)) return "service";
  return "other";
}

/** True for a service-area index page (`/areas-we-cover`, `/locations`) as opposed to a single-location page. */
export function isLocationHubPath(path: string | null): boolean {
  return path !== null && LOCATION_HUB.test(path);
}

const ROLE_PRIORITY: Record<AuditPageRole, number> = { homepage: 0, service: 10, location: 20, contact: 30, about: 40, testimonials: 50, gallery: 60, blog: 70, other: 100 };

/**
 * Lower is crawled first. Role dominates; shallower and shorter paths win ties; sitemap discovery ranks above link discovery.
 * `roleHint` (from the homepage navigation context) can only raise a page's priority, never lower it.
 */
export function crawlPriority(path: string, via: AuditDiscoveredVia, roleHint: AuditPageRole | null = null): number {
  const depth = path.split("/").filter(Boolean).length;
  const pathRole = classifyPageRole(path);
  const rolePriority = roleHint && ROLE_PRIORITY[roleHint] < ROLE_PRIORITY[pathRole] ? ROLE_PRIORITY[roleHint] : ROLE_PRIORITY[pathRole];
  return rolePriority + Math.min(depth, 5) + (via === "sitemap" ? 0 : 1) + Math.min(path.length, 200) / 1000;
}
