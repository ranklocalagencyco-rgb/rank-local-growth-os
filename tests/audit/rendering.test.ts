import { describe, expect, it } from "vitest";

import { APP_SHELL_MAX_WORDS, classifyRenderingMode, extractPageEvidence, type RenderingSignals } from "@/audit/extract";
import { ALL_FINDING_CODES, CONTENT_DEPENDENT_PAGE_CODES, CONTENT_DEPENDENT_SITE_CODES, crossPageFindings, FINDING_TEXT, pageFindings, renderingModeOf, siteFindings, type PageForRules, type SiteSummary } from "@/audit/findings";
import { findingLabel, findingSummary } from "@/domain/audit";

// Deterministic app-shell detection and its effect on findings. No JavaScript is executed anywhere in this path.

const viteShell = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BS Roof Services - Professional Roofing Solutions</title><meta name="description" content="Expert roofing services for residential and commercial properties.">
<script type="module" crossorigin src="/assets/index-BQ3hONTC.js"></script><link rel="stylesheet" crossorigin href="/assets/index-Ck2p9x1D.css"></head>
<body><div id="root"></div></body></html>`;

const nextShell = `<html><head><title>App</title><script src="/_next/static/chunks/main-app-8f3a1c2d.js" defer></script></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">{"props":{}}</script></body></html>`;

const sparseServerPage = `<html><head><title>Opening hours</title></head><body><p>Open 8am to 5pm, Monday to Friday.</p></body></html>`;

const sparseWithAnalytics = `<html><head><title>Thanks</title><script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script></head><body><p>Thanks, we will call you back.</p><a href="/">Home</a></body></html>`;

const hydratedServerPage = `<html><head><title>Roofers</title><script type="module" src="/assets/index-abc123.js"></script></head><body><div id="root"><h1>Roofers in Uxbridge</h1><p>${"word ".repeat(80)}</p><a href="/services">Services</a><a href="/contact">Contact</a><a href="/about">About</a></div></body></html>`;

function page(overrides: Partial<PageForRules> = {}): PageForRules {
  return { id: "p1", requested_url: "https://example.co.uk/", final_url: "https://example.co.uk/", path: "/", page_role: "homepage", fetch_ok: true, fetch_error: null, http_status: 200, content_type: "text/html; charset=utf-8", discovered_via: "link", discovered_from: null, title: "T", meta_description: "D", h1_count: 0, h1_text: [], h2_count: 0, canonical_url: null, meta_robots: null, noindex: false, has_viewport: true, word_count: 300, redirect_count: 0, json_ld_count: 0, schema_types: [], has_structured_data: false, evidence_json: {}, ...overrides };
}

const summary: SiteSummary = { homepageUrl: "https://example.co.uk/", homepageFinalUrl: "https://example.co.uk/", homepageHttps: true, homepageStatus: 200, homepageRedirectChain: [], robotsTxtReachable: true, robotsDisallowAll: false, sitemapReachable: false, sitemapUrlsDiscovered: 0, sitemapUrlsSameSite: 0, pagesCrawled: 1, pagesFailed: 0, servicePagesFound: 0, locationPagesFound: 0, contactPageFound: false, aboutPageFound: false, testimonialsPageFound: false, pagesWithLocalBusinessSchema: 0, schemaTypesSeen: [], brokenInternalLinks: 0, clientRenderedPages: 1, homepageRenderingMode: "client_rendered_likely", renderedContentEvaluated: false };

const shellSignals: RenderingSignals = { wordCount: 0, headingCount: 0, linkCount: 0, formCount: 0, scriptCount: 1, moduleScriptCount: 1, appBundleScriptCount: 1, emptyAppRoot: true };

describe("rendering mode classification", () => {
  it("classifies a Vite/React app shell as client_rendered_likely with the signals recorded", () => {
    const evidence = extractPageEvidence(viteShell, "https://www.bsroofingservice.co.uk/", "bsroofingservice.co.uk");
    expect(evidence.renderingMode).toBe("client_rendered_likely");
    expect(evidence.renderingSignals).toEqual({ wordCount: 0, headingCount: 0, linkCount: 0, formCount: 0, scriptCount: 1, moduleScriptCount: 1, appBundleScriptCount: 1, emptyAppRoot: true });
    expect(evidence.title).toBe("BS Roof Services - Professional Roofing Solutions");
  });

  it("classifies a Next.js shell with an empty mount point and a bundled chunk as client_rendered_likely", () => {
    const evidence = extractPageEvidence(nextShell, "https://example.co.uk/", "example.co.uk");
    expect(evidence.renderingMode).toBe("client_rendered_likely");
    expect(evidence.renderingSignals).toMatchObject({ moduleScriptCount: 0, appBundleScriptCount: 1, emptyAppRoot: true, wordCount: 0 });
  });

  it("does not classify ordinary sparse server-rendered pages as client rendered", () => {
    expect(extractPageEvidence(sparseServerPage, "https://example.co.uk/hours", "example.co.uk").renderingMode).toBe("server_rendered");
    expect(extractPageEvidence(sparseWithAnalytics, "https://example.co.uk/thanks", "example.co.uk").renderingMode).toBe("server_rendered");
    expect(extractPageEvidence("<html><body><p>no title, no h1</p></body></html>", "https://example.co.uk/x", "example.co.uk").renderingMode).toBe("server_rendered");
  });

  it("treats a bundle-hydrated page that already has server-rendered content as server rendered", () => {
    const evidence = extractPageEvidence(hydratedServerPage, "https://example.co.uk/", "example.co.uk");
    expect(evidence.renderingMode).toBe("server_rendered");
    expect(evidence.renderingSignals).toMatchObject({ moduleScriptCount: 1, appBundleScriptCount: 1, emptyAppRoot: false });
    expect(evidence.renderingSignals.wordCount).toBeGreaterThan(APP_SHELL_MAX_WORDS);
  });

  it("requires every signal group to agree; one signal alone never classifies a shell", () => {
    expect(classifyRenderingMode(shellSignals)).toBe("client_rendered_likely");
    expect(classifyRenderingMode({ ...shellSignals, moduleScriptCount: 0, appBundleScriptCount: 0, emptyAppRoot: false })).toBe("server_rendered");
    expect(classifyRenderingMode({ ...shellSignals, wordCount: APP_SHELL_MAX_WORDS + 1 })).toBe("server_rendered");
    expect(classifyRenderingMode({ ...shellSignals, headingCount: 1 })).toBe("server_rendered");
    expect(classifyRenderingMode({ ...shellSignals, linkCount: 3 })).toBe("server_rendered");
    expect(classifyRenderingMode({ ...shellSignals, formCount: 1 })).toBe("server_rendered");
    expect(classifyRenderingMode(shellSignals, true)).toBe("unknown");
    expect(extractPageEvidence("", "https://example.co.uk/", "example.co.uk").renderingMode).toBe("unknown");
  });

  it("reads the stored rendering mode from page evidence and defaults to unknown for pre-v2 rows", () => {
    expect(renderingModeOf({ evidence_json: { renderingMode: "client_rendered_likely" } })).toBe("client_rendered_likely");
    expect(renderingModeOf({ evidence_json: { renderingMode: "server_rendered" } })).toBe("server_rendered");
    expect(renderingModeOf({ evidence_json: {} })).toBe("unknown");
    expect(renderingModeOf({ evidence_json: { renderingMode: "whatever" } })).toBe("unknown");
  });
});

describe("findings for a client-rendered shell", () => {
  const shell = page({ evidence_json: { renderingMode: "client_rendered_likely", renderingSignals: shellSignals } });

  it("suppresses content-dependent page rules but keeps head-level rules such as missing_canonical", () => {
    const codes = pageFindings(shell).map((finding) => finding.code);
    for (const code of CONTENT_DEPENDENT_PAGE_CODES) expect(codes).not.toContain(code);
    expect(codes).toContain("missing_canonical");
    expect(pageFindings(page({ ...shell, title: null, has_viewport: false })).map((finding) => finding.code)).toEqual(["missing_title", "missing_canonical", "missing_viewport"]);
  });

  it("still evaluates the same page rules when the page is server rendered or the mode is unknown", () => {
    expect(pageFindings(page({ evidence_json: { renderingMode: "server_rendered" } })).map((finding) => finding.code)).toEqual(["missing_h1", "missing_canonical", "no_structured_data"]);
    expect(pageFindings(page()).map((finding) => finding.code)).toEqual(["missing_h1", "missing_canonical", "no_structured_data"]);
  });

  it("emits client_rendered_site with the classification evidence instead of content-dependent site rules, and keeps sitemap_missing", () => {
    const findings = siteFindings(summary, [shell]);
    const codes = findings.map((finding) => `${finding.code}:${finding.severity}`);
    expect(codes).toEqual(["client_rendered_site:info", "sitemap_missing:low"]);
    for (const code of CONTENT_DEPENDENT_SITE_CODES) expect(codes.join(" ")).not.toContain(code);
    const site = findings[0];
    expect(site.scope).toBe("site");
    expect(site.evidence).toMatchObject({ pagesCrawled: 1, clientRenderedPages: 1, homepageRenderingMode: "client_rendered_likely", renderedContentEvaluated: false, signals: shellSignals, notEvaluated: [...CONTENT_DEPENDENT_PAGE_CODES, ...CONTENT_DEPENDENT_SITE_CODES] });
  });

  it("keeps HTTP-level site rules alongside the client-rendered finding", () => {
    const codes = siteFindings({ ...summary, homepageHttps: false, robotsTxtReachable: false }, [shell]).map((finding) => finding.code);
    expect(codes).toEqual(["homepage_not_https", "client_rendered_site", "robots_txt_missing", "sitemap_missing"]);
  });

  it("does not raise client_rendered_site when the homepage is server rendered, even if another page is a shell", () => {
    const home = page({ evidence_json: { renderingMode: "server_rendered" }, h1_count: 1, schema_types: ["RoofingContractor"] });
    const widget = page({ id: "p2", path: "/booking", page_role: "other", evidence_json: { renderingMode: "client_rendered_likely" } });
    const codes = siteFindings({ ...summary, homepageRenderingMode: "server_rendered", renderedContentEvaluated: true }, [home, widget]).map((finding) => finding.code);
    expect(codes).not.toContain("client_rendered_site");
    expect(codes).toContain("no_contact_page_detected");
  });
});

describe("finding text catalogue", () => {
  it("has a non-empty static title and summary for every finding code the rules can emit", () => {
    const emitted = new Set<string>();
    const worst = page({ title: null, meta_description: null, h1_count: 0, canonical_url: null, noindex: true, has_viewport: false });
    for (const finding of pageFindings(worst)) emitted.add(finding.code);
    for (const finding of pageFindings(page({ h1_count: 2, h1_text: ["a", "b"] }))) emitted.add(finding.code);
    for (const finding of pageFindings(page({ http_status: 404, discovered_from: "https://example.co.uk/" }))) emitted.add(finding.code);
    for (const finding of siteFindings({ ...summary, homepageHttps: false, robotsTxtReachable: false, homepageRenderingMode: "server_rendered", renderedContentEvaluated: true }, [page({ evidence_json: { renderingMode: "server_rendered" } })])) emitted.add(finding.code);
    for (const finding of siteFindings(summary, [page({ evidence_json: { renderingMode: "client_rendered_likely" } })])) emitted.add(finding.code);
    // audit-rules/v3: page thresholds, redirects, duplicates, homepage coverage, NAP and schema completeness.
    const v3 = (overrides: Partial<PageForRules>, evidence: Record<string, unknown> = {}) => page({ evidence_json: { evidenceVersion: 3, renderingMode: "server_rendered", ...evidence }, ...overrides });
    for (const finding of pageFindings(v3({ title: "Tiny", meta_description: "d", word_count: 5, h1_count: 1, h1_text: [] }, { titleLength: 4, metaDescriptionLength: 1, h1EmptyCount: 1 }))) emitted.add(finding.code);
    for (const finding of pageFindings(v3({ title: "t".repeat(80), meta_description: "m".repeat(200) }, { titleLength: 80, metaDescriptionLength: 200 }))) emitted.add(finding.code);
    for (const finding of pageFindings(v3({ requested_url: "http://example.co.uk/x", final_url: "https://example.co.uk/x", path: "/x", redirect_count: 1, discovered_via: "link" }))) emitted.add(finding.code);
    const home = v3({ id: "h", page_role: "homepage", title: "Same", meta_description: "Same meta" }, { links: [{ url: "https://example.co.uk/elsewhere", text: "x", region: "nav", group: null }] });
    const location = v3({ id: "l", requested_url: "https://example.co.uk/uxbridge", final_url: "https://example.co.uk/uxbridge", path: "/uxbridge", page_role: "location", title: "Same", meta_description: "Same meta" });
    const service = v3({ id: "s", requested_url: "https://example.co.uk/roofing", final_url: "https://example.co.uk/roofing", path: "/roofing", page_role: "service" });
    const evaluated: SiteSummary = { ...summary, homepageRenderingMode: "server_rendered", renderedContentEvaluated: true, evidenceVersion: 3 };
    for (const finding of crossPageFindings([home, location, service], evaluated)) emitted.add(finding.code);
    const nap = { phones: [], emails: [], postcodes: [], addressCandidates: [], businessNames: [], localities: [], pagesWithPhone: 0, pagesWithEmail: 0, pagesWithAddressCandidate: 0, pagesEvaluated: 1 };
    const schema = { localBusinessPages: 1, organizationPages: 0, localBusinessTypes: ["RoofingContractor"], hasName: true, hasTelephone: false, hasAddress: false, addressLocality: null, areaServed: [], hasGeo: false, sameAs: [], hasAggregateRating: false, reviewCount: 0, localBusinessMissingFields: ["telephone", "address"] };
    for (const finding of siteFindings({ ...evaluated, locationPages: [], nap, schema }, [v3({ schema_types: ["RoofingContractor"] })])) emitted.add(finding.code);
    // audit-rules/v4 (RL-067): operational challenge findings, read from stored detection provenance.
    const challenge = (confidence: "high" | "medium") => ({ detected: true, kind: "bot_challenge", confidence, rule: confidence === "high" ? "strong_marker" : "phrase_weak_marker", markerFamily: null, signals: [], detectorVersion: "challenge-detector/v1", url: "https://example.co.uk/", httpStatus: 200, title: null, wordCount: 8, internalLinkCount: 0, h1Count: 0, detectedAt: "2026-09-19T10:00:00.000Z" });
    for (const finding of pageFindings(v3({}, { challenge: challenge("high") }))) emitted.add(finding.code);
    for (const finding of pageFindings(v3({}, { challenge: challenge("medium") }))) emitted.add(finding.code);
    expect([...emitted].sort()).toEqual([...ALL_FINDING_CODES].sort());
    for (const code of emitted) {
      expect(FINDING_TEXT[code].title.length).toBeGreaterThan(0);
      expect(FINDING_TEXT[code].summary.length).toBeGreaterThan(0);
    }
  });

  it("attaches the catalogue title and summary to every emitted finding", () => {
    const all = [...pageFindings(page({ title: null, canonical_url: null })), ...siteFindings(summary, [page({ evidence_json: { renderingMode: "client_rendered_likely" } })])];
    expect(all.length).toBeGreaterThan(0);
    for (const finding of all) {
      expect(finding.title).toBe(FINDING_TEXT[finding.code].title);
      expect(finding.summary).toBe(FINDING_TEXT[finding.code].summary);
    }
  });

  it("exposes the same text to the UI helpers, with a neutral fallback for unknown codes", () => {
    expect(findingLabel("client_rendered_site")).toBe(FINDING_TEXT.client_rendered_site.title);
    expect(findingSummary("sitemap_missing")).toBe(FINDING_TEXT.sitemap_missing.summary);
    expect(findingLabel("some_future_code")).toBe("some future code");
    expect(findingSummary("some_future_code")).toContain("No description");
  });
});
