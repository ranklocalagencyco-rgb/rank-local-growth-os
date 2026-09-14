import { getRuntimeConfig } from "@/config/env";
import { getServerSecrets } from "@/config/server-env";
import { DiscoveryProviderError, type DiscoveryProvider, type DiscoveryProviderName } from "@/discovery/provider";
import { GooglePlacesDiscoveryProvider } from "@/discovery/providers/google-places";

export type DiscoveryProviderReadiness = {
  provider: DiscoveryProviderName;
  configured: boolean;
  missing: string[];
};

/** Reports whether the configured provider can run, without exposing any secret values. */
export function getDiscoveryProviderReadiness(): DiscoveryProviderReadiness {
  const provider = getRuntimeConfig().discoveryProvider;
  const secrets = getServerSecrets();

  switch (provider) {
    case "google_places": {
      const missing = secrets.googlePlacesApiKey ? [] : ["GOOGLE_PLACES_API_KEY"];
      return { provider, configured: missing.length === 0, missing };
    }
  }
}

export function getDiscoveryProvider(): DiscoveryProvider {
  const provider = getRuntimeConfig().discoveryProvider;
  const secrets = getServerSecrets();

  switch (provider) {
    case "google_places": {
      if (!secrets.googlePlacesApiKey) {
        throw new DiscoveryProviderError("GOOGLE_PLACES_API_KEY is not configured", "not_configured", false);
      }
      return new GooglePlacesDiscoveryProvider({ apiKey: secrets.googlePlacesApiKey });
    }
  }
}
