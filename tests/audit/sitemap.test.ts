import { describe, expect, it } from "vitest";

import { parseRobotsTxt, parseSitemapXml } from "@/audit/sitemap";

describe("robots and sitemap parsing", () => {
  it("reads sitemap directives and detects a wildcard disallow-all", () => {
    const robots = parseRobotsTxt("# comment\nUser-agent: *\nDisallow: /wp-admin/\nSitemap: /sitemap.xml\nSitemap: https://example.co.uk/sitemap-posts.xml\nUser-agent: badbot\nDisallow: /\n", "https://example.co.uk/");
    expect(robots).toEqual({ sitemaps: ["https://example.co.uk/sitemap.xml", "https://example.co.uk/sitemap-posts.xml"], disallowAll: false });
    expect(parseRobotsTxt("User-agent: *\nDisallow: /", "https://example.co.uk/").disallowAll).toBe(true);
    expect(parseRobotsTxt("garbage", "https://example.co.uk/")).toEqual({ sitemaps: [], disallowAll: false });
  });

  it("parses urlsets and sitemap indexes, resolving relative locs and tolerating junk", () => {
    const urlset = '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.co.uk/</loc></url><url><loc> /services/roofing </loc></url><url><loc>https://example.co.uk/</loc></url></urlset>';
    expect(parseSitemapXml(urlset, "https://example.co.uk/sitemap.xml")).toEqual({ kind: "urlset", urls: ["https://example.co.uk/", "https://example.co.uk/services/roofing"] });
    const index = '<sitemapindex><sitemap><loc>https://example.co.uk/sitemap-pages.xml</loc></sitemap><sitemap><loc>https://example.co.uk/sitemap-posts.xml</loc></sitemap></sitemapindex>';
    expect(parseSitemapXml(index, "https://example.co.uk/sitemap.xml")).toEqual({ kind: "index", urls: ["https://example.co.uk/sitemap-pages.xml", "https://example.co.uk/sitemap-posts.xml"] });
    expect(parseSitemapXml("<html>not a sitemap</html>", "https://example.co.uk/")).toEqual({ kind: "unknown", urls: [] });
    expect(parseSitemapXml("", "https://example.co.uk/")).toEqual({ kind: "unknown", urls: [] });
  });
});
