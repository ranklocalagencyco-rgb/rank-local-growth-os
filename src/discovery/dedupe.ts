import { candidateDedupeKey, type DiscoveryCandidateInput } from "@/discovery/provider";

export type DedupeResult<T> = {
  unique: T[];
  duplicates: number;
};

/**
 * Removes candidates that share a provider reference within one batch.
 * The first occurrence wins, but a later occurrence may fill in fields the first lacked.
 */
export function dedupeCandidates<T extends Pick<DiscoveryCandidateInput, "provider" | "providerRef">>(candidates: T[]): DedupeResult<T> {
  const seen = new Map<string, T>();
  let duplicates = 0;

  for (const candidate of candidates) {
    const key = candidateDedupeKey(candidate);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, candidate);
      continue;
    }
    duplicates += 1;
    seen.set(key, mergeMissingFields(existing, candidate));
  }

  return { unique: [...seen.values()], duplicates };
}

/** Splits a batch into candidates already known (by dedupe key) and genuinely new ones. */
export function partitionAgainstKnown<T extends Pick<DiscoveryCandidateInput, "provider" | "providerRef">>(candidates: T[], knownKeys: ReadonlySet<string>): { fresh: T[]; known: T[] } {
  const fresh: T[] = [];
  const known: T[] = [];
  for (const candidate of candidates) {
    (knownKeys.has(candidateDedupeKey(candidate)) ? known : fresh).push(candidate);
  }
  return { fresh, known };
}

function mergeMissingFields<T extends object>(primary: T, secondary: T): T {
  const merged: Record<string, unknown> = { ...(primary as Record<string, unknown>) };
  for (const [key, value] of Object.entries(secondary as Record<string, unknown>)) {
    const current = merged[key];
    const empty = current === null || current === undefined || current === "" || (Array.isArray(current) && current.length === 0);
    if (empty && value !== null && value !== undefined) merged[key] = value;
  }
  return merged as T;
}
