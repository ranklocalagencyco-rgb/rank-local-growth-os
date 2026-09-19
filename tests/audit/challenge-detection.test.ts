import { describe, expect, it } from "vitest";

import { CHALLENGE_DETECTOR_VERSION, CHALLENGE_MAX_INTERNAL_LINKS, CHALLENGE_MAX_WORDS, detectChallengePage, isBlockingChallenge, normalizeChallengeTitle, readChallengeEvidence, type ChallengeDetection } from "@/audit/challenge-detection";
import { extractPageEvidence } from "@/audit/extract";
import { challengeTitleOnRealPage, challengeTitleTinyBody, cloudflareChallenge, cookieConsentPage, largeChallengeWithStrongMarker, lowTitleOnlyPage, maintenancePage, mediumVerificationPage, pleaseWaitInBodyCopy, scRoofingInterstitial, spaShell, sparseTradeHomepage, sucuriVerification, tinyTurnstileForm, wordpressHomepage } from "./fixtures/challenge-pages";

// RL-067 challenge detector. Inputs are produced by the real extractor, exactly as the crawler calls the detector.

const url = "https://example-roofing.co.uk/";
function detect(html: string): ChallengeDetection & { words: number; links: number } {
  const evidence = extractPageEvidence(html, url, "example-roofing.co.uk");
  return { ...detectChallengePage({ html, title: evidence.title, wordCount: evidence.wordCount, internalLinkCount: evidence.internalLinkCount, h1Count: evidence.h1Count }), words: evidence.wordCount, links: evidence.internalLinkCount };
}

describe("challenge detector: must detect (high confidence, blocking)", () => {
  it("detects the SC Roofing-style 'One moment, please...' interstitial from title and structure alone, with no vendor marker", () => {
    const result = detect(scRoofingInterstitial);
    expect(result).toMatchObject({ detected: true, confidence: "high", rule: "title_tiny_document", kind: "bot_challenge", markerFamily: null, detectorVersion: CHALLENGE_DETECTOR_VERSION, words: 8, links: 0 });
    expect(result.signals).toEqual(["title:one_moment_please", "text:request_being_verified", "structure:tiny_document"]);
    expect(isBlockingChallenge(result)).toBe(true);
  });

  it("detects a Cloudflare managed challenge by its internals even though the page has an H1", () => {
    const result = detect(cloudflareChallenge);
    expect(result).toMatchObject({ detected: true, confidence: "high", rule: "strong_marker", kind: "bot_challenge", markerFamily: "cloudflare" });
    expect(result.signals).toEqual(expect.arrayContaining(["marker:cloudflare:cf_chl_opt", "marker:cloudflare:cf_challenge_orchestrate", "marker:cloudflare:cf_challenge_error_text", "title:just_a_moment"]));
  });

  it("detects a browser-verification page by a known vendor internal", () => {
    expect(detect(sucuriVerification)).toMatchObject({ detected: true, confidence: "high", rule: "strong_marker", markerFamily: "sucuri" });
  });

  it("detects a challenge title on a tiny document with no navigation and no H1", () => {
    const result = detect(challengeTitleTinyBody);
    expect(result).toMatchObject({ detected: true, confidence: "high", rule: "title_tiny_document", kind: "bot_challenge" });
    expect(result.signals).toContain("structure:tiny_document");
  });

  it("detects a challenge title corroborated by verification wording when the document is small but not tiny", () => {
    const html = `<html><head><title>Security check</title></head><body><h1>example-roofing.co.uk</h1><p>Please complete the security check to access the website. This helps us keep automated traffic away from the site and takes only a few seconds of your time today.</p></body></html>`;
    expect(detect(html)).toMatchObject({ detected: true, confidence: "high", rule: "title_corroborated" });
  });

  it("a strong vendor marker is decisive without the structural gate: >80 words and >2 internal links still block", () => {
    const result = detect(largeChallengeWithStrongMarker);
    expect(result.words).toBeGreaterThan(CHALLENGE_MAX_WORDS);
    expect(result.links).toBeGreaterThan(CHALLENGE_MAX_INTERNAL_LINKS);
    expect(result).toMatchObject({ detected: true, confidence: "high", rule: "strong_marker", markerFamily: "datadome" });
    expect(result.signals).toEqual(["marker:datadome:datadome_captcha_delivery"]);
    expect(isBlockingChallenge(result)).toBe(true);
  });

  it.each([
    ["Cloudflare cf_chl token", '<form id="challenge-form" action="/?__cf_chl_f_tk=REDACTED" method="POST"></form>', "cloudflare"],
    ["Imperva incident iframe", '<iframe src="/_Incapsula_Resource?CWUDNSAI=9&xinfo=REDACTED"></iframe>Request unsuccessful. Incapsula incident ID: REDACTED', "imperva"],
    ["PerimeterX captcha container", '<div id="px-captcha"></div>', "perimeterx"],
    ["SiteGround captcha redirect", '<meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F">', "siteground"],
  ])("recognises the challenge-only internal: %s", (_name, fragment, family) => {
    const padded = `<html><head><title>example</title></head><body>${fragment}<p>${"ordinary words ".repeat(60)}</p><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a></body></html>`;
    expect(detect(padded)).toMatchObject({ detected: true, confidence: "high", rule: "strong_marker", markerFamily: family });
  });
});

describe("challenge detector: must not detect", () => {
  it.each([
    ["a sparse but real trade homepage", sparseTradeHomepage],
    ["a WordPress homepage with Cloudflare's JavaScript-detection script and a Turnstile form", wordpressHomepage],
    ["a client-rendered SPA shell", spaShell],
    ["a maintenance page", maintenancePage],
    ["a content page containing 'please wait' and 'one moment' in its copy", pleaseWaitInBodyCopy],
    ["a cookie-consent page", cookieConsentPage],
    ["a near-empty form page whose only signal is a CAPTCHA widget", tinyTurnstileForm],
    ["a real page with navigation and 300 words that uses a challenge phrase as its title", challengeTitleOnRealPage],
  ])("does not detect %s", (_name, html) => {
    const result = detect(html);
    expect(result).toMatchObject({ detected: false, confidence: null, rule: null, kind: null, signals: [] });
    expect(isBlockingChallenge(result)).toBe(false);
  });

  it("leaves the SPA shell to the rendering classifier", () => {
    expect(extractPageEvidence(spaShell, url, "example-roofing.co.uk").renderingMode).toBe("client_rendered_likely");
  });

  it("never treats a single weak signal as a detection: low word count, weak title, weak marker, meta refresh or body phrase alone", () => {
    const tiny = (title: string, body: string, head = "") => `<html><head><title>${title}</title>${head}</head><body>${body}</body></html>`;
    expect(detect(tiny("Acme Roofing", "<p>Hello.</p>")).detected).toBe(false);
    expect(detect(tiny("Please wait", "<p>Loading the brochure.</p>")).detected).toBe(false);
    expect(detect(tiny("Access denied", "<p>You do not have permission.</p>")).detected).toBe(false);
    expect(detect(tiny("Acme Roofing", "<p>Moved.</p>", '<meta http-equiv="refresh" content="0;url=/home">')).detected).toBe(false);
    expect(detect(tiny("Acme Roofing", '<div class="h-captcha"></div>')).detected).toBe(false);
    expect(detect(tiny("Acme Roofing", "<p>Tick the box to confirm you are human.</p>")).detected).toBe(false);
    // Turnstile's runtime widget id is not a challenge internal.
    expect(detect(tiny("Acme Roofing", '<input type="hidden" id="cf-chl-widget-abc12_response" name="cf-turnstile-response">')).detected).toBe(false);
    // Imperva's ordinary sensor script is injected into real pages.
    expect(detect(tiny("Acme Roofing", '<script src="/_Incapsula_Resource?SWJIYLWA=REDACTED"></script>')).detected).toBe(false);
  });
});

describe("challenge detector: below-blocking confidence", () => {
  it("medium: verification wording plus a weak marker is recorded but never blocks", () => {
    const result = detect(mediumVerificationPage);
    expect(result).toMatchObject({ detected: true, confidence: "medium", rule: "phrase_weak_marker", kind: "bot_challenge" });
    expect(result.signals).toEqual(["text:verify_you_are_human", "marker_weak:google:recaptcha_widget", "structure:tiny_document"]);
    expect(isBlockingChallenge(result)).toBe(false);
  });

  it("low: a challenge title alone inside the gate is evidence only", () => {
    const result = detect(lowTitleOnlyPage);
    expect(result).toMatchObject({ detected: true, confidence: "low", rule: "title_only", kind: "interstitial" });
    expect(isBlockingChallenge(result)).toBe(false);
  });
});

describe("challenge detector: helpers", () => {
  it("normalises titles to whole-phrase comparisons", () => {
    expect(normalizeChallengeTitle("  One moment,   please...  ")).toBe("one moment, please");
    expect(normalizeChallengeTitle("Just a moment…")).toBe("just a moment");
    expect(normalizeChallengeTitle(null)).toBe("");
  });

  it("is deterministic: the same document always yields the same result", () => {
    expect(detect(cloudflareChallenge)).toEqual(detect(cloudflareChallenge));
  });

  it("reads stored provenance back and rejects anything that is not a detection", () => {
    const stored = { ...detect(scRoofingInterstitial), url, httpStatus: 200, title: "One moment, please...", wordCount: 8, internalLinkCount: 0, h1Count: 0, detectedAt: "2026-09-19T10:00:00.000Z" };
    expect(readChallengeEvidence(stored)).toMatchObject({ detected: true, confidence: "high", rule: "title_tiny_document", title: "One moment, please...", wordCount: 8 });
    expect(readChallengeEvidence(undefined)).toBeNull();
    expect(readChallengeEvidence({ detected: false })).toBeNull();
    expect(readChallengeEvidence({ detected: true, confidence: "certain" })).toBeNull();
    expect(isBlockingChallenge(null)).toBe(false);
  });
});
