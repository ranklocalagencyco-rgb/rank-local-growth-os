import { describe, expect, it } from "vitest";

import { classifyPageRole, crawlPriority, isCrawlablePath, isSameSite, normalizeAuditUrl } from "@/audit/url";

describe("audit URL normalisation", () => {
  it("lowercases the host, strips fragments, queries, default ports, index files and trailing slashes", () => {
    expect(normalizeAuditUrl("HTTPS://WWW.Example.co.uk:443/Services/Roofing/?utm=1#top")?.url).toBe("https://www.example.co.uk/Services/Roofing");
    expect(normalizeAuditUrl("http://example.co.uk/index.html")?.url).toBe("http://example.co.uk/");
    expect(normalizeAuditUrl("http://example.co.uk//about//")?.url).toBe("http://example.co.uk/about");
    expect(normalizeAuditUrl("/contact", "https://example.co.uk/services/")?.url).toBe("https://example.co.uk/contact");
    expect(normalizeAuditUrl("https://example.co.uk/a")?.key).toBe("example.co.uk/a");
    expect(normalizeAuditUrl("https://example.co.uk/a")?.key).toBe(normalizeAuditUrl("http://EXAMPLE.co.uk/a?x=1")?.key);
  });

  it("rejects non-http schemes, credentials and empty hosts", () => {
    expect(normalizeAuditUrl("mailto:a@b.c")).toBeNull();
    expect(normalizeAuditUrl("javascript:void(0)")).toBeNull();
    expect(normalizeAuditUrl("ftp://example.co.uk/file")).toBeNull();
    expect(normalizeAuditUrl("https://user:pass@example.co.uk/")).toBeNull();
    expect(normalizeAuditUrl("not a url")).toBeNull();
  });

  it("applies the same-site rule on the registrable domain, ignoring www", () => {
    expect(isSameSite("https://www.example.co.uk/x", "example.co.uk")).toBe(true);
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
    expect(classifyPageRole("/about-us")).toBe("about");
    expect(classifyPageRole("/our-team")).toBe("about");
    expect(classifyPageRole("/testimonials")).toBe("testimonials");
    expect(classifyPageRole("/reviews")).toBe("testimonials");
    expect(classifyPageRole("/areas-we-cover/uxbridge")).toBe("location");
    expect(classifyPageRole("/roofers-in-hayes")).toBe("location");
    expect(classifyPageRole("/services/flat-roofing")).toBe("service");
    expect(classifyPageRole("/gutter-repairs")).toBe("service");
    expect(classifyPageRole("/blog/some-post")).toBe("other");
    expect(classifyPageRole("/privacy-policy")).toBe("other");
  });

  it("prioritises homepage, services, locations, contact, about, testimonials, then everything else", () => {
    const order = ["/blog/post", "/testimonials", "/about", "/contact", "/areas/uxbridge", "/services/roofing", "/"].sort((a, b) => crawlPriority(a, "link") - crawlPriority(b, "link"));
    expect(order).toEqual(["/", "/services/roofing", "/areas/uxbridge", "/contact", "/about", "/testimonials", "/blog/post"]);
    expect(crawlPriority("/services/x", "sitemap")).toBeLessThan(crawlPriority("/services/x", "link"));
    expect(crawlPriority("/services/a/b/c", "link")).toBeGreaterThan(crawlPriority("/services/a", "link"));
  });
});
