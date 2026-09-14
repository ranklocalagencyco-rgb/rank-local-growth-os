import type { Campaign } from "@/db/types";

export type SearchUnit = { category: string; location: string };

export type DiscoveryCursor = {
  unitIndex: number;
  pageToken: string | null;
  pagesFetched: number;
};

export const INITIAL_CURSOR: DiscoveryCursor = { unitIndex: 0, pageToken: null, pagesFetched: 0 };

function cleanList(values: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(trimmed);
  }
  return cleaned;
}

/** Cartesian product of campaign categories and locations, trimmed and de-duplicated. */
export function buildSearchUnits(campaign: Pick<Campaign, "target_categories" | "target_locations">): SearchUnit[] {
  const categories = cleanList(campaign.target_categories);
  const locations = cleanList(campaign.target_locations);
  const units: SearchUnit[] = [];
  for (const location of locations) {
    for (const category of categories) {
      units.push({ category, location });
    }
  }
  return units;
}

export function parseCursor(value: unknown): DiscoveryCursor {
  if (!value || typeof value !== "object") return { ...INITIAL_CURSOR };
  const record = value as Record<string, unknown>;
  const unitIndex = typeof record.unitIndex === "number" && Number.isInteger(record.unitIndex) && record.unitIndex >= 0 ? record.unitIndex : 0;
  const pageToken = typeof record.pageToken === "string" && record.pageToken ? record.pageToken : null;
  const pagesFetched = typeof record.pagesFetched === "number" && Number.isInteger(record.pagesFetched) && record.pagesFetched >= 0 ? record.pagesFetched : 0;
  return { unitIndex, pageToken, pagesFetched };
}

export function isCursorFinished(cursor: DiscoveryCursor, unitCount: number): boolean {
  return cursor.unitIndex >= unitCount;
}

/**
 * Advances the cursor after one page has been fetched for the current unit.
 * Moves to the next unit when the provider has no further page or the page cap is reached.
 */
export function advanceCursor(cursor: DiscoveryCursor, nextPageToken: string | null, maxPagesPerUnit: number): { cursor: DiscoveryCursor; unitCompleted: boolean } {
  const pagesFetched = cursor.pagesFetched + 1;
  if (nextPageToken && pagesFetched < maxPagesPerUnit) {
    return { cursor: { unitIndex: cursor.unitIndex, pageToken: nextPageToken, pagesFetched }, unitCompleted: false };
  }
  return { cursor: { unitIndex: cursor.unitIndex + 1, pageToken: null, pagesFetched: 0 }, unitCompleted: true };
}
