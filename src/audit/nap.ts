import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";

import { MAX_NAP_ADDRESS_CANDIDATES, MAX_NAP_EMAILS, MAX_NAP_NAMES, MAX_NAP_PHONES, MAX_NAP_POSTCODES } from "@/audit/thresholds";

// Deterministic NAP (name, address, phone) evidence from one HTML document (audit-crawler/v3).
// Observed values with provenance only; no canonical NAP is inferred here (that is a later, separate step).
// Scope: UK phone and postcode formats and English copyright lines. Documented in docs/AUDIT_RULES.md.
// `domhandler` is cheerio's own node model; only its types are imported (erased at runtime).

export type NapRegion = "header" | "footer" | "main";
export type NapTextSource = `text:${NapRegion}`;

export type NapPhone = { raw: string; digits: string; sources: string[] };
export type NapEmail = { value: string; sources: string[] };
export type NapPostcode = { value: string; sources: string[] };
export type NapAddressCandidate = { text: string; postcode: string | null; source: "address_element" | NapTextSource };
export type NapBusinessName = { value: string; source: "og_site_name" | "copyright" | "logo_alt" };

export type NapEvidence = {
  phones: NapPhone[];
  emails: NapEmail[];
  postcodes: NapPostcode[];
  addressCandidates: NapAddressCandidate[];
  businessNames: NapBusinessName[];
  hasContactForm: boolean;
};

const UK_PHONE = /(?:\+44\s?\(?0?\)?[\s.-]?|\(?0)\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IMAGE_LIKE = /\.(?:png|jpe?g|gif|webp|svg|avif)$/i;
export const UK_POSTCODE = /\b([A-Za-z]{1,2}\d[A-Za-z\d]?)\s*(\d[A-Za-z]{2})\b/g;
const COPYRIGHT = /(?:©|&copy;|\(c\)|copyright)\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?)?\s*(?:by\s+)?([A-Za-z][^.|•\n]{1,60}?)(?=\s*(?:\.|\||•|–|-|all rights|$))/i;

const FOOTER_SELECTOR = "footer, [role='contentinfo'], #footer, .footer, .site-footer";
const HEADER_SELECTOR = "header, [role='banner'], #header, .header, .site-header";
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "svg", "iframe"]);

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Visible text with a space between elements. cheerio's `.text()` concatenates adjacent elements with no separator
 * ("<a>0123</a><a>4567</a>" → "01234567"), which would corrupt phone, email and postcode matching.
 */
export function spacedText(nodes: Cheerio<AnyNode>): string {
  const parts: string[] = [];
  const walk = (node: AnyNode): void => {
    if (node.type === "text") {
      parts.push(node.data);
      return;
    }
    if (node.type !== "tag" && node.type !== "root") return;
    if (node.type === "tag" && SKIP_TAGS.has(node.name.toLowerCase())) return;
    parts.push(" ");
    for (const child of node.children) walk(child);
    parts.push(" ");
  };
  nodes.each((_, node) => walk(node));
  return collapse(parts.join(""));
}

/** Normalises a UK phone to national digits (leading 0). Returns null when the digit count is not 10 or 11. */
export function normalizeUkPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("44")) digits = `0${digits.slice(2).replace(/^0/, "")}`;
  if (digits.length !== 10 && digits.length !== 11) return null;
  if (!digits.startsWith("0")) return null;
  return digits;
}

export function normalizePostcode(outward: string, inward: string): string {
  return `${outward.toUpperCase()} ${inward.toUpperCase()}`;
}

function regionText($: CheerioAPI, region: NapRegion): string {
  if (region === "footer") return spacedText($(FOOTER_SELECTOR));
  if (region === "header") return spacedText($(HEADER_SELECTOR));
  const body = $("body").clone();
  body.find(`${FOOTER_SELECTOR}, ${HEADER_SELECTOR}`).remove();
  return spacedText(body);
}

function add<T extends { sources: string[] }>(map: Map<string, T>, key: string, make: () => T, source: string, cap: number): void {
  const existing = map.get(key);
  if (existing) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
    return;
  }
  if (map.size >= cap) return;
  map.set(key, { ...make(), sources: [source] });
}

function regionOf($: CheerioAPI, element: Element): NapRegion {
  const node = $(element);
  if (node.closest(FOOTER_SELECTOR).length) return "footer";
  if (node.closest(HEADER_SELECTOR).length) return "header";
  return "main";
}

/** Extracts observed NAP values with provenance. Deterministic; DOM order is preserved. */
export function extractNapEvidence($: CheerioAPI): NapEvidence {
  const phones = new Map<string, NapPhone>();
  const emails = new Map<string, NapEmail>();
  const postcodes = new Map<string, NapPostcode>();

  $("a[href]").each((_, element) => {
    const href = ($(element).attr("href") ?? "").trim();
    const lower = href.toLowerCase();
    if (lower.startsWith("tel:")) {
      let raw = href.slice(4);
      try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
      raw = collapse(raw.split("?")[0]);
      const digits = normalizeUkPhone(raw);
      if (digits) add(phones, digits, () => ({ raw, digits, sources: [] }), "tel_link", MAX_NAP_PHONES);
    } else if (lower.startsWith("mailto:")) {
      let raw = href.slice(7).split("?")[0];
      try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
      const value = collapse(raw).toLowerCase();
      if (new RegExp(`^${EMAIL.source}$`).test(value) && !IMAGE_LIKE.test(value)) add(emails, value, () => ({ value, sources: [] }), "mailto_link", MAX_NAP_EMAILS);
    }
  });

  for (const region of ["header", "footer", "main"] as const) {
    const text = regionText($, region);
    const source: NapTextSource = `text:${region}`;
    for (const match of text.matchAll(UK_PHONE)) {
      const raw = collapse(match[0]);
      const digits = normalizeUkPhone(raw);
      if (digits) add(phones, digits, () => ({ raw, digits, sources: [] }), source, MAX_NAP_PHONES);
    }
    for (const match of text.matchAll(EMAIL)) {
      const value = match[0].toLowerCase();
      if (!IMAGE_LIKE.test(value)) add(emails, value, () => ({ value, sources: [] }), source, MAX_NAP_EMAILS);
    }
    for (const match of text.matchAll(UK_POSTCODE)) {
      const value = normalizePostcode(match[1], match[2]);
      add(postcodes, value, () => ({ value, sources: [] }), source, MAX_NAP_POSTCODES);
    }
  }

  const addressCandidates: NapAddressCandidate[] = [];
  const seenAddress = new Set<string>();
  const pushAddress = (candidate: NapAddressCandidate) => {
    const key = candidate.text.toLowerCase();
    if (seenAddress.has(key) || addressCandidates.length >= MAX_NAP_ADDRESS_CANDIDATES) return;
    seenAddress.add(key);
    addressCandidates.push(candidate);
  };
  const postcodeIn = (text: string) => new RegExp(UK_POSTCODE.source, "i").exec(text);
  $("address").each((_, element) => {
    const text = spacedText($(element));
    if (!text || text.length > 300) return;
    const match = postcodeIn(text);
    pushAddress({ text, postcode: match ? normalizePostcode(match[1], match[2]) : null, source: "address_element" });
  });
  // Deepest elements (≤200 chars) that contain a postcode and at least two comma-separated parts.
  const holders: { element: Element; text: string; postcode: string }[] = [];
  $("body *").each((_, element) => {
    if (SKIP_TAGS.has(element.name.toLowerCase()) || element.name.toLowerCase() === "address") return;
    const text = spacedText($(element));
    if (!text || text.length > 200) return;
    const match = postcodeIn(text);
    if (!match) return;
    if (text.split(",").filter((part) => part.trim()).length < 2) return;
    holders.push({ element, text, postcode: normalizePostcode(match[1], match[2]) });
  });
  for (const holder of holders) {
    const hasDeeper = holders.some((other) => other !== holder && $.contains(holder.element, other.element));
    if (hasDeeper) continue;
    pushAddress({ text: holder.text, postcode: holder.postcode, source: `text:${regionOf($, holder.element)}` });
  }

  const businessNames: NapBusinessName[] = [];
  const seenNames = new Set<string>();
  const pushName = (value: string | null | undefined, source: NapBusinessName["source"]) => {
    const clean = collapse(value ?? "");
    if (!clean || clean.length > 80 || businessNames.length >= MAX_NAP_NAMES) return;
    const key = clean.toLowerCase();
    if (seenNames.has(key)) return;
    seenNames.add(key);
    businessNames.push({ value: clean, source });
  };
  pushName($('meta[property="og:site_name" i]').attr("content"), "og_site_name");
  const copyright = COPYRIGHT.exec(regionText($, "footer"));
  if (copyright) pushName(copyright[1], "copyright");
  const logo = $(`${HEADER_SELECTOR} img[alt]`).filter((_, element) => /logo/i.test(`${$(element).attr("class") ?? ""} ${$(element).attr("src") ?? ""} ${$(element).parent().attr("class") ?? ""}`)).first();
  pushName(logo.attr("alt"), "logo_alt");

  return {
    phones: [...phones.values()],
    emails: [...emails.values()],
    postcodes: [...postcodes.values()],
    addressCandidates,
    businessNames,
    hasContactForm: $("form").filter((_, element) => $(element).find("textarea, input[type='email'], input[name*='email' i], input[name*='phone' i], input[type='tel']").length > 0).length > 0,
  };
}
