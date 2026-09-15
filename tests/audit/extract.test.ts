import { describe, expect, it } from "vitest";

import { extractPageEvidence } from "@/audit/extract";

const html = `<!doctype html><html lang="en-GB"><head>
<title> A&amp;B Roofing | Roofers in Uxbridge </title>
<meta name="description" content="Family roofers covering Uxbridge and Hillingdon.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index, follow">
<link rel="canonical" href="/">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"RoofingContractor","name":"A&B Roofing"},{"@type":"WebSite"},{"@type":["BreadcrumbList","Thing"]},{"@type":"FAQPage","mainEntity":[{"@type":"Question","acceptedAnswer":{"@type":"Answer"}}]}]}</script>
<script type="application/ld+json">{ not json</script>
</head><body>
<header><a href="/" class="logo">Home</a><nav><a href="/services/flat-roofing">Flat roofing</a><a href="/services/flat-roofing/">Flat roofing again</a><a href="/services/flat-roofing?ref=nav#top">Flat roofing query</a><a href="/areas/uxbridge">Uxbridge</a><a href="/contact-us">Contact</a><a href="/wp-admin/">Admin</a><a href="/brochure.pdf">Brochure</a></nav></header>
<main><h1>Roofers in Uxbridge</h1><h2>Services</h2><h2>Areas</h2>
<p>We fix roofs. Call <a href="tel:+441895123456">01895 123456</a> or <a href="mailto:hello@example.co.uk">email us</a>.</p>
<a class="btn btn-primary" href="/contact-us">Get a free quote</a>
<button>Request a callback</button>
<a href="https://www.facebook.com/abroofing">Facebook</a><a href="https://checkatrade.com/abroofing">Checkatrade</a><a href="HTTPS://WWW.example.co.uk/about">About</a>
<div itemscope itemtype="https://schema.org/LocalBusiness"><span itemprop="name">A&B</span></div>
<form action="/enquiry" method="post"><input name="email"><button type="submit">Send enquiry</button></form>
<script>var x = "many words words words words";</script><style>.a{}</style>
</main></body></html>`;

describe("deterministic evidence extraction", () => {
  const evidence = extractPageEvidence(html, "https://www.example.co.uk/", "example.co.uk");

  it("extracts metadata, headings, robots, canonical, lang and viewport", () => {
    expect(evidence.title).toBe("A&B Roofing | Roofers in Uxbridge");
    expect(evidence.metaDescription).toBe("Family roofers covering Uxbridge and Hillingdon.");
    expect(evidence.h1Count).toBe(1);
    expect(evidence.h1Text).toEqual(["Roofers in Uxbridge"]);
    expect(evidence.h2Count).toBe(2);
    expect(evidence.canonicalUrl).toBe("https://www.example.co.uk/");
    expect(evidence.metaRobots).toBe("index, follow");
    expect(evidence).toMatchObject({ noindex: false, nofollow: false, lang: "en-GB", hasViewport: true });
  });

  it("counts words from visible text only", () => {
    expect(evidence.wordCount).toBeGreaterThan(20);
    expect(evidence.wordCount).toBeLessThan(60);
  });

  it("classifies internal and external links, deduplicates normalised URLs and excludes non-crawlable paths from the frontier", () => {
    expect(evidence.internalLinks).toEqual(["https://www.example.co.uk/", "https://www.example.co.uk/services/flat-roofing", "https://www.example.co.uk/areas/uxbridge", "https://www.example.co.uk/contact-us", "https://www.example.co.uk/about"]);
    expect(evidence.internalLinkCount).toBe(7); // + admin + pdf counted as internal but not crawlable
    expect(evidence.externalLinkCount).toBe(2);
    expect(evidence.externalHosts).toEqual(["facebook.com", "checkatrade.com"]);
    expect(evidence.telLinkCount).toBe(1);
    expect(evidence.mailtoLinkCount).toBe(1);
  });

  it("counts forms and obvious calls to action", () => {
    expect(evidence.formCount).toBe(1);
    expect(evidence.ctaCount).toBeGreaterThanOrEqual(3);
    expect(evidence.ctaSamples).toEqual(expect.arrayContaining(["Get a free quote", "Request a callback"]));
  });

  it("parses JSON-LD graphs and microdata into schema types, tolerating malformed blocks", () => {
    expect(evidence.jsonLdCount).toBe(2);
    expect(evidence.jsonLdParseErrors).toBe(1);
    expect(evidence.schemaTypes).toEqual(["Answer", "BreadcrumbList", "FAQPage", "LocalBusiness", "Question", "RoofingContractor", "Thing", "WebSite"]);
    expect(evidence.hasStructuredData).toBe(true);
    expect(evidence.hasLocalBusinessSchema).toBe(true);
  });

  it("handles malformed and empty HTML without throwing", () => {
    const broken = extractPageEvidence("<html><head><title>Broken</title><body><h1>One<h1>Two<p>text<a href='/x'>x", "https://example.co.uk/p", "example.co.uk");
    expect(broken.title).toBe("Broken");
    expect(broken.h1Count).toBe(2);
    expect(broken.internalLinks).toEqual(["https://example.co.uk/x"]);
    const empty = extractPageEvidence("", "https://example.co.uk/", "example.co.uk");
    expect(empty).toMatchObject({ title: null, h1Count: 0, wordCount: 0, internalLinks: [], schemaTypes: [], hasStructuredData: false, hasViewport: false });
  });

  it("detects noindex/nofollow and the none directive", () => {
    expect(extractPageEvidence('<meta name="robots" content="NOINDEX,nofollow">', "https://example.co.uk/", "example.co.uk")).toMatchObject({ noindex: true, nofollow: true });
    expect(extractPageEvidence('<meta name="googlebot" content="none">', "https://example.co.uk/", "example.co.uk")).toMatchObject({ noindex: true, nofollow: true });
  });
});
