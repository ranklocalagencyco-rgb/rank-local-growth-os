// Explicit thresholds for the deterministic audit rules (audit-rules/v3). Documented in docs/AUDIT_RULES.md.
// Lengths are UTF-16 code units of the whitespace-collapsed text; word counts are visible-text tokens containing a letter or digit.

/** `title_too_short` fires below this many characters. */
export const TITLE_MIN_CHARS = 20;
/** `title_too_long` fires above this many characters. Pixel width is not measured. */
export const TITLE_MAX_CHARS = 70;
/** `meta_description_too_short` fires below this many characters. */
export const META_DESCRIPTION_MIN_CHARS = 50;
/** `meta_description_too_long` fires above this many characters. */
export const META_DESCRIPTION_MAX_CHARS = 160;
/** `thin_page` fires below this many visible words on server-rendered pages that are not contact or gallery pages. */
export const THIN_PAGE_MIN_WORDS = 150;

/** Per-page evidence caps. When a cap is hit the page records `linksTruncated` and link-coverage rules are suppressed. */
export const MAX_STORED_LINKS_PER_PAGE = 150;
export const MAX_NAP_PHONES = 10;
export const MAX_NAP_EMAILS = 5;
export const MAX_NAP_POSTCODES = 5;
export const MAX_NAP_ADDRESS_CANDIDATES = 5;
export const MAX_NAP_NAMES = 5;
export const MAX_NAP_LOCALITIES = 10;
export const MAX_SOCIAL_LINKS = 10;
export const MAX_H2_TEXT = 15;
export const MAX_BREADCRUMB_ITEMS = 10;
