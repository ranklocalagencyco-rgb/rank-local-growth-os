import { describe, expect, it } from "vitest";

import { classifyPage, parseHeadingPattern, roleFromSectionLabel, slugify, type ClassificationInput } from "@/audit/classify";

// Fixtures mirror the live target (scroofinguxbridge.co.uk): single-segment location URLs whose only signals are the
// H1 ("Roofers in Uxbridge"), the title, the JSON-LD breadcrumb and the homepage navigation parent ("Areas We Cover").

function input(overrides: Partial<ClassificationInput> = {}): ClassificationInput {
  return { path: "/uxbridge", via: "sitemap", title: null, h1Text: [], breadcrumbNames: [], schemaTypes: ["WebPage", "Organization", "BreadcrumbList"], inbound: null, ...overrides };
}

describe("multi-signal page classification", () => {
  it("classifies /uxbridge-style pages as location from the H1 'X in PLACE' pattern when the place matches the path", () => {
    for (const [path, h1] of [["/uxbridge", "Roofers in Uxbridge"], ["/ruislip", "Roofers in Ruislip"], ["/gerrards-cross", "Roofers in Gerrards Cross"], ["/buckinghamshire", "Roofers in Buckinghamshire"]]) {
      const result = classifyPage(input({ path, h1Text: [h1], title: `Roofers | ${h1.replace("Roofers in ", "")} | SC Roofing` }));
      expect(result.role, path).toBe("location");
      expect(result.signals, path).toEqual([`h1_in_place:${path.slice(1)}`]);
      expect(result.locality, path).toBe(h1.replace("Roofers in ", ""));
      expect(result.headingPattern, path).toMatchObject({ source: "h1", subject: "Roofers", preposition: "in" });
    }
  });

  it("falls back to the title pattern, then breadcrumb parent, then homepage navigation parent", () => {
    expect(classifyPage(input({ title: "Roofing services in Uxbridge", h1Text: ["Welcome"] }))).toMatchObject({ role: "location", signals: ["title_in_place:uxbridge"], locality: "Uxbridge" });
    expect(classifyPage(input({ h1Text: ["Welcome"], breadcrumbNames: ["Home", "Areas We Cover", "Uxbridge"] }))).toMatchObject({ role: "location", signals: ["breadcrumb_parent:areas-we-cover"], locality: "Uxbridge" });
    expect(classifyPage(input({ h1Text: ["Welcome"], breadcrumbNames: ["Home", "Uxbridge"], inbound: { anchors: ["Uxbridge"], navParent: "Areas We Cover" } }))).toMatchObject({ role: "location", signals: ["nav_parent:areas-we-cover"], locality: "Uxbridge" });
    expect(classifyPage(input({ path: "/condensation-control", h1Text: ["Welcome"], inbound: { anchors: ["Condensation Control"], navParent: "Services" } }))).toMatchObject({ role: "service", signals: ["nav_parent:services"] });
    expect(classifyPage(input({ path: "/latest", h1Text: ["Latest"], inbound: { anchors: ["Latest"], navParent: "News" } }))).toMatchObject({ role: "blog" });
    expect(classifyPage(input({ path: "/recent-jobs", h1Text: ["Recent jobs"], breadcrumbNames: ["Home", "Portfolio", "Recent jobs"] }))).toMatchObject({ role: "gallery" });
  });

  it("does not treat an ordinary single-segment page as a location without a positive signal", () => {
    expect(classifyPage(input({ path: "/privacy-policy", title: "Privacy Policy | SC Roofing", h1Text: ["Privacy Policy"], breadcrumbNames: ["Home", "Privacy Policy"] }))).toMatchObject({ role: "other", signals: [] });
    expect(classifyPage(input({ path: "/faq", title: "FAQ | SC Roofing", h1Text: ["Frequently asked questions"], inbound: { anchors: ["FAQ"], navParent: null } }))).toMatchObject({ role: "other" });
    expect(classifyPage(input({ path: "/photos-2019", title: "Photos 2019", h1Text: ["Photos from 2019"] }))).toMatchObject({ role: "other" });
    // "in PLACE" where the place does not match the path is not a location page for that path.
    expect(classifyPage(input({ path: "/company", h1Text: ["Roofers in Uxbridge since 1990"] }))).toMatchObject({ role: "about", signals: ["path:about"] });
    expect(classifyPage(input({ path: "/welcome", h1Text: ["Roofers in Uxbridge"] }))).toMatchObject({ role: "other" });
    expect(classifyPage(input({ path: "/history", h1Text: ["Roofers in Uxbridge since 1990"] }))).toMatchObject({ role: "about" });
  });

  it("recognises service pages from 'SERVICE in PLACE' headings and records service + location combinations", () => {
    const combo = classifyPage(input({ path: "/velux", h1Text: ["Velux Windows in Uxbridge and Hillingdon"] }));
    expect(combo).toMatchObject({ role: "service", signals: ["h1_service_in_place:velux-windows"], service: "Velux Windows" });
    expect(combo.headingPattern?.places).toEqual(["Uxbridge", "Hillingdon"]);
    const pathService = classifyPage(input({ path: "/new-roofs", h1Text: ["New Roofs in Uxbridge and Hillingdon"] }));
    expect(pathService).toMatchObject({ role: "service", signals: ["path:service"], service: "New Roofs" });
    expect(pathService.headingPattern?.places).toEqual(["Uxbridge", "Hillingdon"]);
    expect(classifyPage(input({ path: "/loft", h1Text: ["Loft Conversions across Harrow, Pinner & Ruislip"] }))).toMatchObject({ role: "service", service: "Loft Conversions" });
  });

  it("recognises 'PLACE <trade>' headings for the matching path", () => {
    expect(classifyPage(input({ path: "/hayes", h1Text: ["Hayes Roofing Specialists"] }))).toMatchObject({ role: "location", signals: ["h1_place_first:hayes"], locality: "Hayes" });
    expect(classifyPage(input({ path: "/gerrards-cross", h1Text: ["Gerrards Cross Roofers"] }))).toMatchObject({ role: "location", locality: "Gerrards Cross" });
    expect(classifyPage(input({ path: "/hayes", h1Text: ["Hayes Team Photo"] }))).toMatchObject({ role: "other" });
  });

  it("keeps path keyword rules ahead of content signals and honours schema page types", () => {
    expect(classifyPage(input({ path: "/contact-us", h1Text: ["Roofers in Uxbridge"] }))).toMatchObject({ role: "contact", signals: ["path:contact"] });
    expect(classifyPage(input({ path: "/gallery", h1Text: ["Gallery"] }))).toMatchObject({ role: "gallery", signals: ["path:gallery"] });
    expect(classifyPage(input({ path: "/areas-we-cover", h1Text: ["Areas We Cover"] }))).toMatchObject({ role: "location", signals: ["path:location"], locality: null });
    expect(classifyPage(input({ path: "/2024-roundup", h1Text: ["Our 2024 roundup"], schemaTypes: ["BlogPosting", "WebPage"] }))).toMatchObject({ role: "blog", signals: ["schema:BlogPosting"] });
    expect(classifyPage(input({ path: "/reach-us", h1Text: ["Reach us"], schemaTypes: ["ContactPage"] }))).toMatchObject({ role: "contact", signals: ["schema:ContactPage"] });
    expect(classifyPage(input({ path: "/", h1Text: ["Roofers in Uxbridge"] }))).toMatchObject({ role: "homepage", signals: ["homepage"] });
    expect(classifyPage(input({ path: "/anything", via: "homepage" }))).toMatchObject({ role: "homepage" });
  });

  it("parses heading patterns deterministically and prefers the split that matches the path", () => {
    expect(parseHeadingPattern("Roofing for Landlords in Uxbridge", "h1", "uxbridge")).toMatchObject({ subject: "Roofing for Landlords", preposition: "in", places: ["Uxbridge"] });
    expect(parseHeadingPattern("Roofing for Landlords in Uxbridge", "h1", null)).toMatchObject({ subject: "Roofing", preposition: "for", places: ["Landlords in Uxbridge"] });
    expect(parseHeadingPattern("Roofers in Uxbridge, Hillingdon & Hayes.", "h1")).toMatchObject({ places: ["Uxbridge", "Hillingdon", "Hayes"] });
    expect(parseHeadingPattern("Welcome", "h1")).toBeNull();
    expect(parseHeadingPattern("In Uxbridge", "h1")).toBeNull();
    expect(parseHeadingPattern(null, "h1")).toBeNull();
  });

  it("maps section labels and slugs deterministically", () => {
    expect(roleFromSectionLabel("Areas We Cover")).toBe("location");
    expect(roleFromSectionLabel("Service Areas")).toBe("location");
    expect(roleFromSectionLabel("Our Services")).toBe("service");
    expect(roleFromSectionLabel("News & Blog")).toBe("blog");
    expect(roleFromSectionLabel("Portfolio")).toBe("gallery");
    expect(roleFromSectionLabel("About")).toBeNull();
    expect(roleFromSectionLabel(null)).toBeNull();
    expect(slugify("Gerrards Cross")).toBe("gerrards-cross");
    expect(slugify("  Saint-Étienne's Roofers & Co. ")).toBe("saint-etiennes-roofers-and-co");
  });
});
