import { describe, expect, it } from "vitest";
import { load } from "cheerio";

import { extractNapEvidence, normalizeUkPhone } from "@/audit/nap";
import { extractSchemaEvidence } from "@/audit/schema";

// Deterministic NAP and schema extraction. Fixture mirrors the live target's footer/header layout.

const page = `<!doctype html><html><head><title>Roofers | Uxbridge and Hillingdon | SC Roofing</title>
<meta property="og:site_name" content="SC Roofing">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"WebPage","@id":"https://x.co.uk/#webpage","breadcrumb":{"@id":"https://x.co.uk/#breadcrumb"}},
 {"@type":"BreadcrumbList","@id":"https://x.co.uk/#breadcrumb","itemListElement":[{"@type":"ListItem","position":2,"name":"Uxbridge"},{"@type":"ListItem","position":1,"name":"Home","item":"https://x.co.uk/"}]},
 {"@type":"Organization","@id":"https://x.co.uk/#organization","name":"SC Roofing","logo":{"@type":"ImageObject","url":"https://x.co.uk/logo.png"},"sameAs":["https://www.facebook.com/scroofing"]}
]}</script>
</head><body>
<header><a href="/"><img class="site-logo" src="/logo.png" alt="SC Roofing"></a><a href="tel:07956%20311218">07956 311218</a><a href="tel:01895%20221704">01895 221704</a><a href="mailto:scroofing@btinternet.com?subject=Hi">Email us</a></header>
<main><h1>Roofers in Uxbridge</h1><p>Call us on 07539 573208 or +44 (0)1895 221704 for a quote. Not a phone: 12345.</p>
<form><input name="name"><input type="email" name="email"><button>Send</button></form>
<img src="/img/hero@2x.png" alt="hero"></main>
<footer><div class="contact"><p>Contact</p><p>07956 311218 07539 573208 01895 221704</p><p>scroofing@btinternet.com</p><p class="address">Montrose, Mead Close, Denham, Buckinghamshire, UB9 5AZ</p><p>Review us on Google</p></div>
<p>© 2024 SC Roofing. All rights reserved.</p></footer></body></html>`;

describe("NAP evidence", () => {
  const $ = load(page);
  const nap = extractNapEvidence($);

  it("collects phones from tel links and text with provenance, normalised to national digits", () => {
    expect(nap.phones.map((phone) => phone.digits)).toEqual(["07956311218", "01895221704", "07539573208"]);
    expect(nap.phones[0]).toMatchObject({ raw: "07956 311218", sources: ["tel_link", "text:header", "text:footer"] });
    expect(nap.phones[1].sources).toEqual(["tel_link", "text:header", "text:footer", "text:main"]);
    expect(nap.phones[2].sources).toEqual(["text:footer", "text:main"]);
    expect(normalizeUkPhone("+44 (0)1895 221704")).toBe("01895221704");
    expect(normalizeUkPhone("+441895221704")).toBe("01895221704");
    expect(normalizeUkPhone("12345")).toBeNull();
    expect(normalizeUkPhone("1895221704")).toBeNull();
  });

  it("collects emails from mailto links and text, ignoring image-like tokens", () => {
    expect(nap.emails).toEqual([{ value: "scroofing@btinternet.com", sources: ["mailto_link", "text:footer"] }]);
  });

  it("collects UK postcodes and the deepest element holding an address with a postcode", () => {
    expect(nap.postcodes).toEqual([{ value: "UB9 5AZ", sources: ["text:footer"] }]);
    expect(nap.addressCandidates).toEqual([{ text: "Montrose, Mead Close, Denham, Buckinghamshire, UB9 5AZ", postcode: "UB9 5AZ", source: "text:footer" }]);
  });

  it("prefers <address> elements and requires at least two comma-separated parts for text candidates", () => {
    const withAddress = extractNapEvidence(load(`<body><address>1 High St<br>Uxbridge<br>UB8 1AA</address><footer><p>Postcode only UB8 1AA</p></footer></body>`));
    expect(withAddress.addressCandidates).toEqual([{ text: "1 High St Uxbridge UB8 1AA", postcode: "UB8 1AA", source: "address_element" }]);
    const none = extractNapEvidence(load(`<body><p>Hello world</p></body>`));
    expect(none).toMatchObject({ phones: [], emails: [], postcodes: [], addressCandidates: [], businessNames: [], hasContactForm: false });
  });

  it("collects business name signals with provenance and detects a contact form", () => {
    expect(nap.businessNames).toEqual([{ value: "SC Roofing", source: "og_site_name" }]);
    const noOg = extractNapEvidence(load(`<body><header><img class="logo" src="/logo.png" alt="A&B Roofing Ltd"></header><footer>© 2024 A&B Roofing Ltd. All rights reserved.</footer></body>`));
    expect(noOg.businessNames).toEqual([{ value: "A&B Roofing Ltd", source: "copyright" }]);
    expect(nap.hasContactForm).toBe(true);
  });
});

describe("schema evidence", () => {
  const parse = (html: string) => {
    const $ = load(html);
    const documents = $('script[type="application/ld+json"]').map((_, element) => JSON.parse($(element).text())).get();
    return extractSchemaEvidence(documents, $);
  };

  it("reads Organization details and breadcrumb names ordered by position from a Yoast-style @graph", () => {
    const schema = parse(page);
    expect(schema.localBusiness).toBeNull();
    expect(schema.organization).toEqual({ name: "SC Roofing", telephone: null, address: null, sameAs: ["https://www.facebook.com/scroofing"], logo: true });
    expect(schema.breadcrumbNames).toEqual(["Home", "Uxbridge"]);
    expect(schema).toMatchObject({ aggregateRating: null, reviewCount: 0, hasService: false });
  });

  it("reads a complete LocalBusiness subtype with address, geo, areaServed, sameAs and ratings, resolving @id references", () => {
    const schema = parse(`<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
      {"@type":"PostalAddress","@id":"#addr","streetAddress":"1 High St","addressLocality":"Uxbridge","addressRegion":"Greater London","postalCode":"UB8 1AA","addressCountry":{"@type":"Country","name":"GB"}},
      {"@type":["RoofingContractor","LocalBusiness"],"name":"A&B Roofing","telephone":"+44 1895 123456","address":{"@id":"#addr"},"areaServed":[{"@type":"City","name":"Uxbridge"},"Hillingdon"],"geo":{"@type":"GeoCoordinates","latitude":"51.54","longitude":-0.47},"sameAs":"https://facebook.com/ab","openingHoursSpecification":[],"priceRange":"££",
       "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.9","reviewCount":37},"review":[{"@type":"Review"},{"@type":"Review"}]},
      {"@type":"Service","name":"Roof repairs"}
    ]}</script>`);
    expect(schema.localBusiness).toEqual({ types: ["RoofingContractor", "LocalBusiness"], name: "A&B Roofing", telephone: "+44 1895 123456", address: { streetAddress: "1 High St", addressLocality: "Uxbridge", addressRegion: "Greater London", postalCode: "UB8 1AA", addressCountry: "GB" }, areaServed: ["Uxbridge", "Hillingdon"], geo: { latitude: 51.54, longitude: -0.47 }, sameAs: ["https://facebook.com/ab"], openingHours: true, priceRange: true });
    expect(schema.aggregateRating).toEqual({ ratingValue: 4.9, ratingCount: 37 });
    expect(schema.reviewCount).toBe(2);
    expect(schema.hasService).toBe(true);
    expect(schema.organization).toBeNull();
  });

  it("reports an incomplete LocalBusiness faithfully and falls back to microdata and HTML breadcrumbs", () => {
    const incomplete = parse(`<script type="application/ld+json">{"@type":"Plumber","name":"P","address":"12 Some Road"}</script>`);
    expect(incomplete.localBusiness).toMatchObject({ types: ["Plumber"], name: "P", telephone: null, address: { streetAddress: "12 Some Road", addressLocality: null, postalCode: null }, areaServed: [], geo: null, sameAs: [] });
    const micro = parse(`<div itemscope itemtype="https://schema.org/LocalBusiness"><span itemprop="name">Micro Ltd</span><span itemprop="telephone">01895 000000</span><div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress"><span itemprop="streetAddress">2 Road</span><span itemprop="addressLocality">Hayes</span><span itemprop="postalCode">UB3 1AA</span></div></div>
      <nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li>»</li><li><a href="/areas">Areas We Cover</a></li><li>Hayes</li></ol></nav>`);
    expect(micro.localBusiness).toMatchObject({ types: ["LocalBusiness"], name: "Micro Ltd", telephone: "01895 000000", address: { streetAddress: "2 Road", addressLocality: "Hayes", postalCode: "UB3 1AA" } });
    expect(micro.breadcrumbNames).toEqual(["Home", "Areas We Cover", "Hayes"]);
    expect(parse("<p>nothing</p>")).toEqual({ localBusiness: null, organization: null, aggregateRating: null, reviewCount: 0, hasService: false, breadcrumbNames: [] });
  });
});
