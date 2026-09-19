import { describe, expect, it } from "vitest";

import { classifyPageRole, crawlPriority, isCrawlablePath, isLocationHubPath, isSameSite, normalizeAuditUrl } from "@/audit/url";

describe("audit URL normalisation", () => {
  it("lowercases the host, strips fragments, queries, default ports and index files, and keeps the site's trailing slash in the fetch URL", () => {
    expect(normalizeAuditUrl("HTTPS://WWW.Example.co.uk:443/Services/Roofing/?utm=1#top")?.url).toBe("https://www.example.co.uk/Services/Roofing/");
    expect(normalizeAuditUrl("http://example.co.uk/index.html")?.url).toBe("http://example.co.uk/");
    expect(normalizeAuditUrl("http://example.co.uk//about//")?.url).toBe("http://example.co.uk/about/");
    expect(normalizeAuditUrl("/contact", "https://example.co.uk/services/")?.url).toBe("https://example.co.uk/contact");
    expect(normalizeAuditUrl("https://example.co.uk/a")?.key).toBe("example.co.uk/a");
    expect(normalizeAuditUrl("https://example.co.uk/a")?.key).toBe(normalizeAuditUrl("http://EXAMPLE.co.uk/a?x=1")?.key);
  });

  it("gives slash and no-slash variants the same key and path, so identity, dedupe and classification never depend on the slash", () => {
    const variants = ["https://example.co.uk/x", "https://example.co.uk/x/", "https://example.co.uk/x/?utm=1#top", "https://EXAMPLE.co.uk/X/", "http://example.co.uk/x//"];
    for (const variant of variants) {
      const normalized = normalizeAuditUrl(variant);
      expect(normalized?.key, variant).toBe("example.co.uk/x");
      expect(normalized?.path.toLowerCase(), variant).toBe("/x");
    }
    expect(normalizeAuditUrl("https://example.co.uk/x/")?.url).toBe("https://example.co.uk/x/");
    expect(normalizeAuditUrl("https://example.co.uk/x")?.url).toBe("https://example.co.uk/x");
    // Query strings and fragments are still removed from the fetch URL.
    expect(normalizeAuditUrl("https://example.co.uk/x/?utm=1#top")?.url).toBe("https://example.co.uk/x/");
    // Root and index files still resolve to "/".
    for (const root of ["https://example.co.uk", "https://example.co.uk/", "https://example.co.uk/index.html", "https://example.co.uk/index.php", "https://example.co.uk//"]) {
      expect(normalizeAuditUrl(root)?.url, root).toBe("https://example.co.uk/");
      expect(normalizeAuditUrl(root)?.key, root).toBe("example.co.uk/");
      expect(normalizeAuditUrl(root)?.path, root).toBe("/");
    }
  });

  it("rejects non-http schemes, credentials and empty hosts", () => {
    expect(normalizeAuditUrl("mailto:a@b.c")).toBeNull();
    expect(normalizeAuditUrl("javascript:void(0)")).toBeNull();
    expect(normalizeAuditUrl("ftp://example.co.uk/file")).toBeNull();
    expect(normalizeAuditUrl("https://user:pass@example.co.uk/")).toBeNull();
    expect(normalizeAuditUrl("not a url")).toBeNull();
  });

  it("applies the same-site rule on the registrable domain, ignoring www and trailing slashes", () => {
    expect(isSameSite("https://www.example.co.uk/x", "example.co.uk")).toBe(true);
    expect(isSameSite("https://www.example.co.uk/x/", "example.co.uk")).toBe(true);
    expect(isSameSite("http://example.co.uk", "example.co.uk")).toBe(true);
    expect(isSameSite("https://blog.example.co.uk/x", "example.co.uk")).toBe(false);
    expect(isSameSite("https://facebook.com/example", "example.co.uk")).toBe(false);
    expect(isSameSite("https://example.co.uk.evil.com/", "example.co.uk")).toBe(false);
  });

  it("skips binaries, feeds, admin, auth, commerce, search, tags and pagination", () => {
    for (const path of ["/brochure.pdf", "/logo.png", "/style.css", "/app.js", "/feed", "/wp-admin/", "/wp-login.php", "/login", "/account/orders", "/cart", "/checkout/step-1", "/search", "/tag/roofing", "/category/news", "/page/2", "/author/bob", "/calendar", "/events/2026/03"]) {
      expect(isCrawlablePath(path), path).toBe(false);
    }
    for (const path of ["/", "/services/roof-repairs", "/contact-us", "/about", "/areas-we-cover/uxbridge", "/reviews"]) {
      expect(isCrawlablePath(path), path).toBe(true);
    }
  });

  it("classifies page roles deterministically from the path", () => {
    expect(classifyPageRole("/")).toBe("homepage");
    expect(classifyPageRole("/contact-us")).toBe("contact");
    expect(classifyPageRole("/get-a-quote")).toBe("contact");
    expect(classifyPageRole("/book")).toBe("contact");
    expect(classifyPageRole("/about-us")).toBe("about");
    expect(classifyPageRole("/our-team")).toBe("about");
    expect(classifyPageRole("/testimonials")).toBe("testimonials");
    expect(classifyPageRole("/reviews")).toBe("testimonials");
    expect(classifyPageRole("/case-studies")).toBe("testimonials");
    expect(classifyPageRole("/areas-we-cover/uxbridge")).toBe("location");
    expect(classifyPageRole("/roofers-in-hayes")).toBe("location");
    expect(classifyPageRole("/services/flat-roofing")).toBe("service");
    expect(classifyPageRole("/gutter-repairs")).toBe("service");
    expect(classifyPageRole("/gallery")).toBe("gallery");
    expect(classifyPageRole("/roofing-gallery")).toBe("gallery");
    expect(classifyPageRole("/our-work")).toBe("gallery");
    expect(classifyPageRole("/blog/some-post")).toBe("blog");
    expect(classifyPageRole("/blog/how-to-book")).toBe("blog");
    expect(classifyPageRole("/news")).toBe("blog");
    expect(classifyPageRole("/2024/05/new-roof-tips")).toBe("blog");
    expect(classifyPageRole("/privacy-policy")).toBe("other");
    expect(classifyPageRole("/uxbridge")).toBe("other"); // path alone is not enough; classify.ts uses page evidence
  });

  it("recognises service-area hub paths", () => {
    expect(isLocationHubPath("/areas-we-cover")).toBe(true);
    expect(isLocationHubPath("/locations")).toBe(true);
    expect(isLocationHubPath("/areas-we-cover/uxbridge")).toBe(true); // contains the hub segment; the leaf is still a location page
    expect(isLocationHubPath("/uxbridge")).toBe(false);
    expect(isLocationHubPath(null)).toBe(false);
  });

  it("prioritises homepage, services, locations, contact, about, testimonials, gallery, blog, then everything else", () => {
    const order = ["/blog/post", "/gallery", "/testimonials", "/about", "/contact", "/areas/uxbridge", "/services/roofing", "/"].sort((a, b) => crawlPriority(a, "link") - crawlPriority(b, "link"));
    expect(order).toEqual(["/", "/services/roofing", "/areas/uxbridge", "/contact", "/about", "/testimonials", "/gallery", "/blog/post"]);
    expect(crawlPriority("/services/x", "sitemap")).toBeLessThan(crawlPriority("/services/x", "link"));
    expect(crawlPriority("/services/a/b/c", "link")).toBeGreaterThan(crawlPriority("/services/a", "link"));
  });

  it("lets a navigation role hint raise, but never lower, a path's priority", () => {
    expect(crawlPriority("/uxbridge", "sitemap", "location")).toBeLessThan(crawlPriority("/privacy-policy", "sitemap"));
    expect(crawlPriority("/uxbridge", "sitemap", "location")).toBeLessThan(crawlPriority("/uxbridge", "sitemap"));
    // A hinted location page ranks with path-classified location pages (same role band), still behind services.
    expect(Math.floor(crawlPriority("/uxbridge", "sitemap", "location"))).toBe(Math.floor(crawlPriority("/areas/uxbridge", "sitemap")) - 1); // depth 1 vs 2
    expect(crawlPriority("/uxbridge", "sitemap", "location")).toBeGreaterThan(crawlPriority("/services/roofing", "sitemap"));
    expect(crawlPriority("/services/roofing", "link", "other")).toBe(crawlPriority("/services/roofing", "link"));
    expect(crawlPriority("/services/roofing", "link", null)).toBe(crawlPriority("/services/roofing", "link"));
  });
});
