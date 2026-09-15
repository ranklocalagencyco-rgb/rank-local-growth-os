import { load } from "cheerio";

// robots.txt and sitemap parsing for crawl planning (RL-054). Pure functions; the fetch happens elsewhere.

export const MAX_SITEMAP_URLS = 500;

export type RobotsTxtSummary = {
  sitemaps: string[];
  /** True when a `User-agent: *` group disallows `/` outright. Recorded as evidence; V1 does not change crawl policy on it. */
  disallowAll: boolean;
};

export function parseRobotsTxt(text: string, baseUrl: string): RobotsTxtSummary {
  const sitemaps: string[] = [];
  let disallowAll = false;
  let inWildcardGroup = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") inWildcardGroup = value === "*";
    else if (key === "sitemap" && value) {
      try {
        sitemaps.push(new URL(value, baseUrl).toString());
      } catch {
        // ignore malformed sitemap lines
      }
    } else if (key === "disallow" && inWildcardGroup && value === "/") disallowAll = true;
  }
  return { sitemaps: [...new Set(sitemaps)], disallowAll };
}

export type SitemapParseResult = { kind: "index" | "urlset" | "unknown"; urls: string[] };

/** Parses a sitemap or sitemap index. Returns at most MAX_SITEMAP_URLS `<loc>` values. Malformed XML yields `unknown`. */
export function parseSitemapXml(xml: string, baseUrl: string): SitemapParseResult {
  if (!xml || !/<(?:sitemapindex|urlset)\b/i.test(xml)) return { kind: "unknown", urls: [] };
  let $;
  try {
    $ = load(xml, { xml: true });
  } catch {
    return { kind: "unknown", urls: [] };
  }
  const isIndex = $("sitemapindex").length > 0;
  const container = isIndex ? "sitemap" : "url";
  const urls: string[] = [];
  $(`${container} > loc`).each((_, element) => {
    if (urls.length >= MAX_SITEMAP_URLS) return false;
    const value = $(element).text().trim();
    if (!value) return;
    try {
      urls.push(new URL(value, baseUrl).toString());
    } catch {
      // skip malformed loc
    }
  });
  return { kind: isIndex ? "index" : "urlset", urls: [...new Set(urls)] };
}
