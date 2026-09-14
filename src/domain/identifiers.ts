// Deterministic identifier normalisation used for deduplication and provenance.

/** Hosts that indicate a third-party profile/listing rather than a business's own website. */
const THIRD_PARTY_HOSTS = [
  "facebook.com",
  "fb.com",
  "fb.me",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
  "pinterest.co.uk",
  "whatsapp.com",
  "wa.me",
  "linktr.ee",
  "google.com",
  "goo.gl",
  "maps.app.goo.gl",
  "business.site",
  "yell.com",
  "checkatrade.com",
  "trustatrader.com",
  "mybuilder.com",
  "ratedpeople.com",
  "bark.com",
  "trustpilot.com",
  "yelp.com",
  "yelp.co.uk",
  "thomsonlocal.com",
  "freeindex.co.uk",
  "cylex-uk.co.uk",
  "192.com",
  "scoot.co.uk",
  "hotfrog.co.uk",
  "nextdoor.co.uk",
  "houzz.co.uk",
  "houzz.com",
  "gumtree.com",
  "ebay.co.uk",
  "amazon.co.uk",
  "etsy.com",
  "booksy.com",
  "treatwell.co.uk",
  "fresha.com",
];

function parseHttpUrl(input: string | null | undefined): URL | null {
  if (!input) return null;
  let raw = input.trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `http://${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url;
}

function isIpLiteral(host: string): boolean {
  return host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * Normalises a URL or hostname into a canonical registrable-style domain:
 * lowercase, no scheme, no `www.` prefix, no port, no path, no trailing dot.
 * Returns null for anything that is not a public DNS name (IP literals, bare hostnames).
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  const url = parseHttpUrl(input);
  if (!url) return null;

  let host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host || isIpLiteral(host)) return null;
  host = host.replace(/^www\d*\./, "");
  if (!host.includes(".")) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  return host;
}

/** Canonical form of a website URL: https-preferred scheme kept as given, host normalised, no query/fragment. */
export function normalizeWebsiteUrl(input: string | null | undefined): string | null {
  const url = parseHttpUrl(input);
  if (!url) return null;
  const domain = normalizeDomain(input);
  if (!domain) return null;

  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.hostname.toLowerCase().replace(/\.+$/, "")}${path}`;
}

export function isThirdPartyHost(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const host = domain.toLowerCase();
  return THIRD_PARTY_HOSTS.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/** Normalises a phone number to E.164-style digits with a leading plus. UK-first heuristics. */
export function normalizePhone(input: string | null | undefined, countryCode = "GB"): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (hasPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (countryCode.toUpperCase() === "GB") {
    if (digits.startsWith("0")) digits = `44${digits.slice(1)}`;
    else if (!digits.startsWith("44")) digits = `44${digits}`;
  }

  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

export function normalizeLocality(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return value || null;
}
