import type { AuditDiscoveredVia, AuditPageRole } from "@/db/types";
import { normalizeDomain } from "@/domain/identifiers";

// URL rules for the website audit crawler (RL-051/RL-055). Pure functions, no I/O.
// Deterministic by design: no LLM is involved anywhere in the audit fetch/parse path (ai/rules/no-llm-in-crawler.md).

export type NormalizedAuditUrl = {
  /** Canonical absolute URL: lowercase host, no default port, no query, no fragment, no trailing slash except root. */
  url: string;
  /** Scheme-agnostic dedupe key (host + path). */
  key: string;
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

  let path = url.pathname.replace(/\/{2,}/g, "/").replace(INDEX_FILE, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (!path) path = "/";

  const authority = port ? `${host}:${port}` : host;
  return { url: `${url.protocol}//${authority}${path}`, key: `${authority}${path}`.toLowerCase(), path, host };
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

const CONTACT = /(^|\/)(?:contact|contact-us|contactus|get-in-touch|enquir(?:e|y|ies)|inquir(?:e|y|ies)|quote|free-quote|request-a-quote|get-a-quote|book|booking|appointment)s?(?:\/|$)/i;
const ABOUT = /(^|\/)(?:about|about-us|aboutus|our-story|who-we-are|meet-the-team|team|our-team|company|history)(?:\/|$)/i;
const TESTIMONIALS = /(^|\/)(?:testimonials?|reviews?|feedback|case-stud(?:y|ies)|success-stories|what-our-customers-say)(?:\/|$)/i;
const LOCATION = /(^|\/)(?:areas?|areas-we-cover|areas-covered|service-areas?|locations?|coverage|where-we-work|near-me)(?:\/|$)|-in-[a-z]|(^|\/)[a-z0-9-]+-(?:area|areas|locations?)(?:\/|$)/i;
const SERVICE = /(^|\/)(?:services?|our-services|what-we-do|solutions|products?|treatments?|repairs?|installations?|maintenance|offerings?)(?:\/|$)|(?:^|\/)[a-z0-9-]*(?:roof|roofing|gutter|fascia|soffit|plumb|heating|boiler|electric|clean|build|extension|loft|landscap|garden|paving|driveway|fencing|paint|decorat|tiling|plaster|render|glazing|window|door|kitchen|bathroom|flooring|carpet|removal|clearance|pest|tree|scaffold|solar|drain|lock|repair|install|service)[a-z0-9-]*(?:\/|$)/i;

/** Deterministic role classification from the URL path only. */
export function classifyPageRole(path: string): AuditPageRole {
  if (path === "/" || path === "") return "homepage";
  if (CONTACT.test(path)) return "contact";
  if (TESTIMONIALS.test(path)) return "testimonials";
  if (ABOUT.test(path)) return "about";
  if (LOCATION.test(path)) return "location";
  if (SERVICE.test(path)) return "service";
  return "other";
}

const ROLE_PRIORITY: Record<AuditPageRole, number> = { homepage: 0, service: 10, location: 20, contact: 30, about: 40, testimonials: 50, other: 100 };

/** Lower is crawled first. Role dominates; shallower and shorter paths win ties; sitemap discovery ranks above link discovery. */
export function crawlPriority(path: string, via: AuditDiscoveredVia): number {
  const depth = path.split("/").filter(Boolean).length;
  return ROLE_PRIORITY[classifyPageRole(path)] + Math.min(depth, 5) + (via === "sitemap" ? 0 : 1) + Math.min(path.length, 200) / 1000;
}
