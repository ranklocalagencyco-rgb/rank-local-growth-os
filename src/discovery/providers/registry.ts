import { getRuntimeConfig } from "@/config/env";
import { getServerSecrets } from "@/config/server-env";
import { DiscoveryProviderError, type DiscoveryProvider, type DiscoveryProviderName } from "@/discovery/provider";
import { DataForSeoDiscoveryProvider } from "@/discovery/providers/dataforseo";
import { GOOGLE_PLACES_ATTRIBUTION, GooglePlacesDiscoveryProvider } from "@/discovery/providers/google-places";

// Provider selection. DISCOVERY_PROVIDER picks the adapter (dataforseo by default); only the
// selected adapter's credentials are required, so a Google key is optional unless google_places is chosen.
// DATAFORSEO_MODE picks the DataForSEO execution mode (standard queue by default, priority, or live).

export type DiscoveryProviderReadiness = {
  provider: DiscoveryProviderName;
  configured: boolean;
  missing: string[];
};

function missingSecrets(provider: DiscoveryProviderName, secrets: ReturnType<typeof getServerSecrets>): string[] {
  switch (provider) {
    case "dataforseo":
      return [...(secrets.dataForSeoLogin ? [] : ["DATAFORSEO_LOGIN"]), ...(secrets.dataForSeoPassword ? [] : ["DATAFORSEO_PASSWORD"])];
    case "google_places":
      return secrets.googlePlacesApiKey ? [] : ["GOOGLE_PLACES_API_KEY"];
  }
}

/** Reports whether the configured provider can run, without exposing any secret values. */
export function getDiscoveryProviderReadiness(): DiscoveryProviderReadiness {
  const provider = getRuntimeConfig().discoveryProvider;
  const missing = missingSecrets(provider, getServerSecrets());
  return { provider, configured: missing.length === 0, missing };
}

/** Attribution text that must accompany displayed content from the given provider, or null when none is required. */
export function discoveryProviderAttribution(provider: string): string | null {
  return provider === "google_places" ? GOOGLE_PLACES_ATTRIBUTION : null;
}

export function getDiscoveryProvider(): DiscoveryProvider {
  const config = getRuntimeConfig();
  const provider = config.discoveryProvider;
  const secrets = getServerSecrets();
  const missing = missingSecrets(provider, secrets);
  if (missing.length > 0) {
    throw new DiscoveryProviderError(`${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not configured`, "not_configured", false);
  }

  switch (provider) {
    case "dataforseo":
      return new DataForSeoDiscoveryProvider({ login: secrets.dataForSeoLogin!, password: secrets.dataForSeoPassword!, mode: config.dataForSeoMode, depth: config.dataForSeoMapsDepth, locationCode: config.dataForSeoLocationCode });
    case "google_places":
      return new GooglePlacesDiscoveryProvider({ apiKey: secrets.googlePlacesApiKey!, searchProfile: config.discoveryEnrichmentMode === "inline" ? "inline" : "minimal" });
  }
}
