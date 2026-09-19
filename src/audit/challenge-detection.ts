import { load } from "cheerio";

// Deterministic detection of bot-challenge / browser-verification / interstitial documents served with HTTP 2xx (RL-067).
// Pure: fixed patterns and thresholds over the HTML and counts the crawler already extracted. No LLM (ai/rules/no-llm-in-crawler.md),
// no network, and nothing here tries to pass, solve or evade a challenge: the crawler recognises that the response is not the
// website, records why, and stops. Rule table and limitations: docs/AUDIT_RULES.md §7.

export const CHALLENGE_DETECTOR_VERSION = "challenge-detector/v1";

/** Structural gate for heuristic rules: a challenge document has almost no visible text and no site navigation. */
export const CHALLENGE_MAX_WORDS = 80;
export const CHALLENGE_MAX_INTERNAL_LINKS = 2;
/** "Tiny" document: nothing but the interstitial message. */
export const CHALLENGE_TINY_MAX_WORDS = 20;

export type ChallengeKind = "bot_challenge" | "access_block" | "interstitial";
/** Fixed by rule, never a probability. Only `high` excludes a page or blocks a run. */
export type ChallengeConfidence = "high" | "medium" | "low";
export type ChallengeRule = "strong_marker" | "title_tiny_document" | "title_corroborated" | "phrase_weak_marker" | "title_only";

export type ChallengeDetection = {
  detected: boolean;
  kind: ChallengeKind | null;
  confidence: ChallengeConfidence | null;
  rule: ChallengeRule | null;
  /** Vendor family of the first strong marker, when one matched. */
  markerFamily: string | null;
  /** Signal codes that matched, e.g. `title:one_moment_please`, `marker:cloudflare:cf_chl_opt`, `structure:tiny_document`. */
  signals: string[];
  detectorVersion: string;
};

export type ChallengeDetectionInput = { html: string; title: string | null; wordCount: number; internalLinkCount: number; h1Count: number };

/** Provenance stored at `evidence_json.challenge` and, for a blocked homepage, `site_summary_json.challenge`. Never contains HTML. */
export type ChallengeEvidence = ChallengeDetection & { url: string; httpStatus: number | null; title: string | null; wordCount: number; internalLinkCount: number; h1Count: number; detectedAt: string };

type Marker = { code: string; family: string; pattern: RegExp };

/**
 * Challenge-only internals: identifiers a vendor emits in its challenge or block document and nowhere else. One match is decisive
 * without the structural gate, because some vendor documents carry more text or links than the gate allows.
 * Deliberately NOT here because vendors also inject them into ordinary pages: Cloudflare's `/cdn-cgi/challenge-platform/…/scripts/jsd/`
 * (JavaScript detections), Imperva's bare `/_Incapsula_Resource?SWJIYLWA=…` sensor, PerimeterX `_pxAppId`, DataDome `tags.js`,
 * and Turnstile's runtime `cf-chl-widget-*` ids.
 */
const STRONG_MARKERS: Marker[] = [
  { code: "cf_chl_opt", family: "cloudflare", pattern: /_cf_chl_opt/ },
  { code: "cf_chl_token", family: "cloudflare", pattern: /cf[-_]chl[-_](?!widget)/i },
  { code: "cf_challenge_orchestrate", family: "cloudflare", pattern: /\/cdn-cgi\/challenge-platform\/[^"'\s]*\/orchestrate\//i },
  { code: "cf_challenge_error_text", family: "cloudflare", pattern: /challenge-error-text/i },
  { code: "sucuri_cloudproxy_js", family: "sucuri", pattern: /sucuri_cloudproxy_js/i },
  { code: "incapsula_incident", family: "imperva", pattern: /_Incapsula_Resource\?CWUDNSAI|Incapsula incident ID/i },
  { code: "datadome_captcha_delivery", family: "datadome", pattern: /captcha-delivery\.com/i },
  { code: "perimeterx_captcha", family: "perimeterx", pattern: /\bpx-captcha\b/i },
  { code: "siteground_sgcaptcha", family: "siteground", pattern: /\/\.well-known\/sgcaptcha\//i },
];

/** Seen on challenge documents and on ordinary pages alike. Never decisive alone; at most corroboration inside the structural gate. */
const WEAK_MARKERS: Marker[] = [
  { code: "cf_challenge_platform_path", family: "cloudflare", pattern: /\/cdn-cgi\/challenge-platform\//i },
  { code: "turnstile_widget", family: "cloudflare", pattern: /\bcf-turnstile\b|challenges\.cloudflare\.com\/turnstile/i },
  { code: "recaptcha_widget", family: "google", pattern: /\bg-recaptcha\b|google\.com\/recaptcha|recaptcha\.net\/recaptcha/i },
  { code: "hcaptcha_widget", family: "hcaptcha", pattern: /\bh-captcha\b|hcaptcha\.com\/1\/api\.js/i },
  { code: "meta_refresh", family: "generic", pattern: /<meta[^>]+http-equiv\s*=\s*["']?refresh/i },
];

type Phrase = { code: string; kind: ChallengeKind; pattern: RegExp };

/** Whole-title matches (after normalisation). A title that merely contains one of these is not a signal. */
const STRONG_TITLES: Phrase[] = [
  { code: "just_a_moment", kind: "interstitial", pattern: /^just a moment$/ },
  { code: "one_moment_please", kind: "interstitial", pattern: /^one moment,? please$/ },
  { code: "checking_your_browser", kind: "bot_challenge", pattern: /^checking your browser(?: before accessing .+)?$/ },
  { code: "verify_you_are_human", kind: "bot_challenge", pattern: /^(?:verify|verifying) (?:that )?you are (?:a )?human$/ },
  { code: "human_verification", kind: "bot_challenge", pattern: /^human verification$/ },
  { code: "attention_required_cloudflare", kind: "bot_challenge", pattern: /^attention required! \| cloudflare$/ },
  { code: "security_check", kind: "bot_challenge", pattern: /^security check(?: required)?$/ },
  { code: "ddos_guard", kind: "bot_challenge", pattern: /^ddos-guard$/ },
  { code: "robot_check", kind: "bot_challenge", pattern: /^(?:robot check|are you a robot\??|bot verification)$/ },
];

/** Recorded for provenance only: ordinary holding and error pages use these titles too, so they never decide anything. */
const WEAK_TITLES: Phrase[] = [
  { code: "please_wait", kind: "interstitial", pattern: /^please wait$/ },
  { code: "access_denied", kind: "access_block", pattern: /^access denied$/ },
];

/** Verification wording in the document text (scripts and styles removed, <noscript> kept: several vendors put the message there). */
const BODY_PHRASES: Phrase[] = [
  { code: "checking_your_browser", kind: "bot_challenge", pattern: /checking (?:if the site connection is secure|your browser)/ },
  { code: "verify_you_are_human", kind: "bot_challenge", pattern: /(?:verify|verifying|confirm) (?:that )?you are (?:a )?human/ },
  { code: "enable_javascript_and_cookies", kind: "bot_challenge", pattern: /enable javascript and cookies to continue/ },
  { code: "review_security_of_connection", kind: "bot_challenge", pattern: /needs to review the security of your connection/ },
  { code: "complete_security_check", kind: "bot_challenge", pattern: /complete the security check/ },
  { code: "request_being_verified", kind: "bot_challenge", pattern: /your request is being verified/ },
  { code: "browser_will_redirect", kind: "interstitial", pattern: /your browser will (?:be )?redirect/ },
  { code: "not_a_robot", kind: "bot_challenge", pattern: /(?:you are|you're|i am|i'm) not a (?:robot|bot)/ },
];

const NOT_DETECTED: ChallengeDetection = { detected: false, kind: null, confidence: null, rule: null, markerFamily: null, signals: [], detectorVersion: CHALLENGE_DETECTOR_VERSION };

/** Lowercased, whitespace-collapsed, typographic apostrophes/ellipses folded, trailing dots dropped: "One moment, please..." → "one moment, please". */
export function normalizeChallengeTitle(title: string | null): string {
  return (title ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/…/g, "...").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
}

function documentText(html: string): string {
  const $ = load(html);
  const clone = $("body").clone();
  clone.find("script, style, template, svg").remove();
  // <noscript> is parsed as raw text, so its markup would otherwise reach the phrase patterns as tags.
  return clone.text().replace(/<[^>]+>/g, " ").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Decision table (first match wins):
 *   1. any strong marker                                                  → high   (no structural gate)
 *   2. gate + strong title + tiny document (≤20 words, 0 internal links, no H1) → high
 *   3. gate + strong title + (body phrase or weak marker)                 → high
 *   4. gate + body phrase + weak marker                                   → medium (recorded, never blocks)
 *   5. gate + strong title alone                                          → low    (recorded, never blocks)
 * Everything else, including any weak marker, weak title, body phrase or low word count on its own: not detected.
 */
export function detectChallengePage(input: ChallengeDetectionInput): ChallengeDetection {
  const strong = STRONG_MARKERS.filter((marker) => marker.pattern.test(input.html));
  const gate = input.wordCount <= CHALLENGE_MAX_WORDS && input.internalLinkCount <= CHALLENGE_MAX_INTERNAL_LINKS;
  // Heuristic signals are only read inside the gate, so an ordinary page never pays for a second parse or collects stray signals.
  if (strong.length === 0 && !gate) return NOT_DETECTED;

  const normalizedTitle = normalizeChallengeTitle(input.title);
  const strongTitle = STRONG_TITLES.find((title) => title.pattern.test(normalizedTitle)) ?? null;
  const weakTitle = WEAK_TITLES.find((title) => title.pattern.test(normalizedTitle)) ?? null;
  const weak = gate ? WEAK_MARKERS.filter((marker) => marker.pattern.test(input.html)) : [];
  const text = gate ? documentText(input.html) : "";
  const phrases = gate ? BODY_PHRASES.filter((phrase) => phrase.pattern.test(text)) : [];
  const tiny = gate && input.wordCount <= CHALLENGE_TINY_MAX_WORDS && input.internalLinkCount === 0 && input.h1Count === 0;

  let rule: ChallengeRule | null = null;
  let confidence: ChallengeConfidence | null = null;
  if (strong.length > 0) [rule, confidence] = ["strong_marker", "high"];
  else if (strongTitle && tiny) [rule, confidence] = ["title_tiny_document", "high"];
  else if (strongTitle && (phrases.length > 0 || weak.length > 0)) [rule, confidence] = ["title_corroborated", "high"];
  else if (phrases.length > 0 && weak.length > 0) [rule, confidence] = ["phrase_weak_marker", "medium"];
  else if (strongTitle) [rule, confidence] = ["title_only", "low"];
  if (!rule || !confidence) return NOT_DETECTED;

  const signals = [
    ...strong.map((marker) => `marker:${marker.family}:${marker.code}`),
    ...(strongTitle ? [`title:${strongTitle.code}`] : []),
    ...(weakTitle ? [`title_weak:${weakTitle.code}`] : []),
    ...phrases.map((phrase) => `text:${phrase.code}`),
    ...weak.map((marker) => `marker_weak:${marker.family}:${marker.code}`),
    ...(gate ? [tiny ? "structure:tiny_document" : "structure:low_content_no_navigation"] : []),
  ];
  const verification = strong.length > 0 || phrases.some((phrase) => phrase.kind === "bot_challenge") || strongTitle?.kind === "bot_challenge";
  const kind: ChallengeKind = verification ? "bot_challenge" : weakTitle?.kind === "access_block" ? "access_block" : "interstitial";
  return { detected: true, kind, confidence, rule, markerFamily: strong[0]?.family ?? null, signals, detectorVersion: CHALLENGE_DETECTOR_VERSION };
}

/** Only a high-confidence detection changes crawler behaviour (page excluded; a homepage blocks the run). */
export function isBlockingChallenge(detection: Pick<ChallengeDetection, "detected" | "confidence"> | null | undefined): boolean {
  return Boolean(detection && detection.detected && detection.confidence === "high");
}

/** Reads a stored detection back from `evidence_json.challenge` / `site_summary_json.challenge`. Null for rows without one. */
export function readChallengeEvidence(value: unknown): ChallengeEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<ChallengeEvidence>;
  if (record.detected !== true || (record.confidence !== "high" && record.confidence !== "medium" && record.confidence !== "low")) return null;
  return {
    detected: true,
    kind: record.kind === "bot_challenge" || record.kind === "access_block" || record.kind === "interstitial" ? record.kind : null,
    confidence: record.confidence,
    rule: typeof record.rule === "string" ? record.rule : null,
    markerFamily: typeof record.markerFamily === "string" ? record.markerFamily : null,
    signals: Array.isArray(record.signals) ? record.signals.filter((signal): signal is string => typeof signal === "string") : [],
    detectorVersion: typeof record.detectorVersion === "string" ? record.detectorVersion : "",
    url: typeof record.url === "string" ? record.url : "",
    httpStatus: typeof record.httpStatus === "number" ? record.httpStatus : null,
    title: typeof record.title === "string" ? record.title : null,
    wordCount: typeof record.wordCount === "number" ? record.wordCount : 0,
    internalLinkCount: typeof record.internalLinkCount === "number" ? record.internalLinkCount : 0,
    h1Count: typeof record.h1Count === "number" ? record.h1Count : 0,
    detectedAt: typeof record.detectedAt === "string" ? record.detectedAt : "",
  };
}
