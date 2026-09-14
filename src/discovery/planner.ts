import type { DiscoverySearchQuery } from "@/discovery/provider";

export type SearchPlan = {
  queries: Array<Pick<DiscoverySearchQuery, "category" | "location" | "countryCode">>;
  maxProviderRequests: number;
  maxCandidates: number;
};

export type PlanInput = {
  categories: string[];
  locations: string[];
  countryCode: string;
  maxProviderRequests: number;
  maxCandidates: number;
};

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Category × location grid. Deterministic ordering so retries produce identical plans. */
export function planSearches(input: PlanInput): SearchPlan {
  const categories = unique(input.categories);
  const locations = unique(input.locations);
  const queries: SearchPlan["queries"] = [];
  for (const location of locations) {
    for (const category of categories) {
      queries.push({ category, location, countryCode: input.countryCode });
    }
  }
  return { queries, maxProviderRequests: Math.max(1, input.maxProviderRequests), maxCandidates: Math.max(1, input.maxCandidates) };
}
