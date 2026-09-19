import type { AuditDiscoveredVia, AuditPageRole } from "@/db/types";
import { classifyPageRole, TRADE_KEYWORD_PATTERN } from "@/audit/url";

// Multi-signal, deterministic page-role classification (audit-crawler/v3). Pure functions, no I/O, no LLM
// (ai/rules/no-llm-in-crawler.md). Every decision records the signal that produced it so the stored role is auditable.

/** Inbound context for one URL, gathered from the homepage's links before the page itself is fetched. */
export type InboundLinkContext = { anchors: string[]; navParent: string | null };

export type ClassificationInput = {
  path: string | null;
  via: AuditDiscoveredVia;
  title: string | null;
  h1Text: string[];
  breadcrumbNames: string[];
  schemaTypes: string[];
  inbound: InboundLinkContext | null;
};

/** "<subject> <preposition> <place>[ and <place>]" parsed from a heading or title. */
export type HeadingPattern = { source: "h1" | "title"; subject: string; preposition: string; places: string[] };

export type Classification = {
  role: AuditPageRole;
  /** Ordered list of the rules that fired, e.g. `path:service`, `h1_in_place:uxbridge`, `nav_parent:areas-we-cover`. */
  signals: string[];
  /** Locality resolved for a location page (the place whose slug matched the path), else null. */
  locality: string | null;
  /** Service subject resolved for a service page from its heading pattern, else null. */
  service: string | null;
  headingPattern: HeadingPattern | null;
};

const PREPOSITIONS = new Set(["in", "near", "around", "across", "covering", "serving", "for", "throughout"]);
const PLACE_SPLIT = /\s*(?:,|&|\band\b)\s*/i;

const LOCATION_LABEL = /\b(?:areas?\s+(?:we\s+)?(?:cover|covered|serve|served)|service\s+areas?|locations?|areas\s+served|where\s+we\s+work|coverage|towns?\s+we\s+cover|places\s+we\s+cover)\b/i;
const SERVICE_LABEL = /\b(?:services?|what\s+we\s+do|solutions)\b/i;
const BLOG_LABEL = /\b(?:blog|news|articles?|guides?|insights)\b/i;
const GALLERY_LABEL = /\b(?:gallery|galleries|portfolio|our\s+work|projects?)\b/i;

const SCHEMA_ROLE: [RegExp, AuditPageRole][] = [
  [/^(?:BlogPosting|Article|NewsArticle|TechArticle)$/i, "blog"],
  [/^ContactPage$/i, "contact"],
  [/^AboutPage$/i, "about"],
  [/^ImageGallery$/i, "gallery"],
  [/^Service$/i, "service"],
];

/** Lowercase ASCII slug: diacritics stripped, punctuation removed, whitespace → `-`. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function lastSegment(path: string | null): string | null {
  if (!path) return null;
  const segments = path.split("/").filter(Boolean);
  return segments.length ? segments[segments.length - 1].toLowerCase() : null;
}

function cleanPlace(value: string): string {
  return value.replace(/[.!?:;]+$/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Parses "X in PLACE[, PLACE and PLACE]" from a heading. When `segment` is given, the split at the preposition whose
 * place (or subject) slug matches the path segment is preferred; otherwise the first preposition wins.
 */
export function parseHeadingPattern(text: string | null, source: HeadingPattern["source"], segment: string | null = null): HeadingPattern | null {
  if (!text) return null;
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (words.length < 3) return null;
  const candidates: HeadingPattern[] = [];
  for (let index = 1; index < words.length - 1; index += 1) {
    if (!PREPOSITIONS.has(words[index].toLowerCase())) continue;
    const subject = cleanPlace(words.slice(0, index).join(" "));
    const places = words.slice(index + 1).join(" ").split(PLACE_SPLIT).map(cleanPlace).filter(Boolean);
    if (!subject || places.length === 0) continue;
    candidates.push({ source, subject, preposition: words[index].toLowerCase(), places });
  }
  if (candidates.length === 0) return null;
  if (segment) {
    const matching = candidates.find((candidate) => candidate.places.some((place) => slugify(place) === segment) || slugMatchesSegment(candidate.subject, segment));
    if (matching) return matching;
  }
  return candidates[0];
}

function slugMatchesSegment(value: string, segment: string): boolean {
  const slug = slugify(value);
  return slug.length > 0 && (slug === segment || slug.startsWith(`${segment}-`) || segment === `${slug}-area`);
}

function placeMatchingSegment(pattern: HeadingPattern | null, segment: string | null): string | null {
  if (!pattern || !segment) return null;
  return pattern.places.find((place) => slugify(place) === segment || segment === `${slugify(place)}-area`) ?? null;
}

/** Role implied by a navigation or breadcrumb parent label, or null when the label is not a recognised section. */
export function roleFromSectionLabel(label: string | null | undefined): AuditPageRole | null {
  if (!label) return null;
  if (LOCATION_LABEL.test(label)) return "location";
  if (SERVICE_LABEL.test(label)) return "service";
  if (BLOG_LABEL.test(label)) return "blog";
  if (GALLERY_LABEL.test(label)) return "gallery";
  return null;
}

/** Deterministic multi-signal classification. Path keywords win; content signals only decide otherwise-unclassified paths. */
export function classifyPage(input: ClassificationInput): Classification {
  const signals: string[] = [];
  const path = input.path ?? "/";
  const segment = lastSegment(path);
  const h1 = input.h1Text.find((text) => text.trim().length > 0) ?? null;
  const headingPattern = parseHeadingPattern(h1, "h1", segment) ?? parseHeadingPattern(input.title, "title", segment);
  const matchedPlace = placeMatchingSegment(headingPattern, segment);
  const done = (role: AuditPageRole, locality: string | null = null, service: string | null = null): Classification => ({ role, signals, locality, service, headingPattern });

  if (input.via === "homepage" || path === "/" || path === "") {
    signals.push("homepage");
    return done("homepage");
  }

  const pathRole = classifyPageRole(path);
  if (pathRole !== "other") {
    signals.push(`path:${pathRole}`);
    if (pathRole === "location") return done("location", matchedPlace ?? headingPattern?.places[0] ?? null);
    if (pathRole === "service") return done("service", null, headingPattern && slugMatchesSegment(headingPattern.subject, segment ?? "") ? headingPattern.subject : null);
    return done(pathRole);
  }

  for (const type of input.schemaTypes) {
    for (const [pattern, role] of SCHEMA_ROLE) {
      if (pattern.test(type)) {
        signals.push(`schema:${type}`);
        return done(role);
      }
    }
  }

  if (headingPattern && segment) {
    if (matchedPlace) {
      signals.push(`${headingPattern.source}_in_place:${slugify(matchedPlace)}`);
      return done("location", matchedPlace);
    }
    if (slugMatchesSegment(headingPattern.subject, segment)) {
      signals.push(`${headingPattern.source}_service_in_place:${slugify(headingPattern.subject)}`);
      return done("service", null, headingPattern.subject);
    }
  }

  if (h1 && segment) {
    const words = h1.replace(/\s+/g, " ").trim().split(" ");
    for (let take = 1; take <= 3 && take < words.length; take += 1) {
      const place = words.slice(0, take).join(" ");
      const remainder = words.slice(take).join(" ");
      if (slugify(place) === segment && TRADE_KEYWORD_PATTERN.test(remainder)) {
        signals.push(`h1_place_first:${segment}`);
        return done("location", place);
      }
    }
  }

  if (input.breadcrumbNames.length >= 2) {
    const parent = input.breadcrumbNames[input.breadcrumbNames.length - 2];
    const role = roleFromSectionLabel(parent);
    if (role) {
      signals.push(`breadcrumb_parent:${slugify(parent)}`);
      return done(role, role === "location" ? input.breadcrumbNames[input.breadcrumbNames.length - 1] : null);
    }
  }

  const navRole = roleFromSectionLabel(input.inbound?.navParent);
  if (navRole && input.inbound?.navParent) {
    signals.push(`nav_parent:${slugify(input.inbound.navParent)}`);
    return done(navRole, navRole === "location" ? input.inbound.anchors[0] ?? null : null);
  }

  return done("other");
}
