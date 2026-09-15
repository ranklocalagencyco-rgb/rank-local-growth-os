# Example: provider adapter skeleton

Minimal shape for a new discovery provider. Mapping is a pure exported function; all I/O is injected; errors are classified; billable requests are counted explicitly.

```ts
import { DiscoveryProviderError, type DiscoveryCandidateInput, type DiscoveryProvider, type DiscoveryProviderRetentionPolicy, type DiscoverySearchQuery, type DiscoverySearchResult } from "@/discovery/provider";

export const EXAMPLE_ATTRIBUTION = "Listings via Example Provider";

export type ExampleItem = { id?: string | null; name?: string | null; website?: string | null; phone?: string | null };

export function mapExampleItemToCandidate(item: ExampleItem, observedAt: string): DiscoveryCandidateInput | null {
  const ref = item.id?.trim();
  if (!ref) return null;
  const website = item.website?.trim() || null;
  return {
    provider: "dataforseo", // replace with the new DiscoveryProviderName once added to provider.ts and env.ts
    providerRef: ref,
    displayName: item.name?.trim() || null,
    formattedAddress: null, locality: null, postcode: null, region: null, countryCode: null,
    primaryCategory: null, categories: [],
    websiteHint: website, websiteHintState: website ? "present" : "absent",
    phoneHint: item.phone?.trim() || null,
    businessStatus: "unknown",
    attribution: EXAMPLE_ATTRIBUTION,
    observedAt,
    enrichedAt: observedAt,
  };
}

export class ExampleDiscoveryProvider implements DiscoveryProvider {
  readonly name = "dataforseo" as const; // see note above
  readonly retention: DiscoveryProviderRetentionPolicy = { referenceRetention: "indefinite", contentRetention: "expiring", attributionRequired: false, attributionText: EXAMPLE_ATTRIBUTION };
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  constructor(private readonly options: { apiKey: string; fetchImpl?: typeof fetch; now?: () => Date; baseUrl?: string }) {
    if (!options.apiKey) throw new DiscoveryProviderError("EXAMPLE_API_KEY is not configured", "not_configured", false);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }
  async searchCandidates(query: DiscoverySearchQuery): Promise<DiscoverySearchResult> {
    const response = await this.fetchImpl(`${this.options.baseUrl ?? "https://api.example.com"}/search`, { method: "POST", headers: { authorization: `Bearer ${this.options.apiKey}` }, body: JSON.stringify({ q: `${query.category} in ${query.location}`, limit: Math.min(query.pageSize ?? 50, 50) }) });
    if (response.status === 401) throw new DiscoveryProviderError("Example rejected the credentials.", "auth", false);
    if (response.status === 429) throw new DiscoveryProviderError("Example rate limit exceeded.", "quota", true);
    if (!response.ok) throw new DiscoveryProviderError(`Example is unavailable (${response.status}).`, "unavailable", response.status >= 500);
    const items = (await response.json()) as ExampleItem[];
    const observedAt = this.now().toISOString();
    return { candidates: items.map((item) => mapExampleItemToCandidate(item, observedAt)).filter((c): c is DiscoveryCandidateInput => c !== null), nextPageToken: null, requestCount: 1, costUsd: null };
  }
  async getReferenceDetails(): Promise<DiscoveryCandidateInput | null> { return null; }
}
```

Then: add the name to `DiscoveryProviderName` and the `discoveryProvider` zod enum, secrets to `server-env.ts`, a `missingSecrets` case and constructor call in `registry.ts`, `.env.example` and README entries, and tests mirroring `tests/discovery/dataforseo-provider.test.ts`.
