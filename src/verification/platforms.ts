/**
 * Domains that host third-party profiles rather than an owned business website.
 * A provider website hint pointing here is recorded as a social/directory profile, not an official site.
 */
const PLATFORM_DOMAINS = [
  "facebook.com", "fb.com", "fb.me", "instagram.com", "twitter.com", "x.com", "linkedin.com", "tiktok.com", "youtube.com", "pinterest.com",
  "yell.com", "checkatrade.com", "trustatrader.com", "mybuilder.com", "ratedpeople.com", "bark.com", "thomsonlocal.com", "cylex-uk.co.uk",
  "192.com", "scoot.co.uk", "freeindex.co.uk", "hotfrog.co.uk", "yelp.com", "yelp.co.uk", "trustpilot.com", "nextdoor.co.uk", "nextdoor.com",
  "business.site", "google.com", "goo.gl", "g.page", "linktr.ee", "wa.me", "whatsapp.com", "bookings.gettimely.com", "booksy.com", "treatwell.co.uk",
];

export function isPlatformDomain(domain: string | null): boolean {
  if (!domain) return false;
  return PLATFORM_DOMAINS.some((platform) => domain === platform || domain.endsWith(`.${platform}`));
}
