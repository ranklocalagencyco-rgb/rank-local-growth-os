import { z } from "zod";

// Server-only secrets. Never import this module from a client component.
// Values are read from process.env at call time so they are never inlined into browser bundles.

const serverSecretsSchema = z.object({
  dataForSeoLogin: z.string().min(1).optional(),
  dataForSeoPassword: z.string().min(1).optional(),
  googlePlacesApiKey: z.string().min(1).optional(),
  /** Optional: PageSpeed Insights works without a key; a key is recommended for frequent automated use. */
  pageSpeedApiKey: z.string().min(1).optional(),
  jobRunnerSecret: z.string().min(16).optional(),
});

export type ServerSecrets = z.infer<typeof serverSecretsSchema>;

function optionalEnvironmentValue(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

export function parseServerSecrets(environment: NodeJS.ProcessEnv = process.env): ServerSecrets {
  if (typeof window !== "undefined") {
    throw new Error("Server secrets must not be accessed from browser code");
  }

  return serverSecretsSchema.parse({
    dataForSeoLogin: optionalEnvironmentValue(environment.DATAFORSEO_LOGIN),
    dataForSeoPassword: optionalEnvironmentValue(environment.DATAFORSEO_PASSWORD),
    googlePlacesApiKey: optionalEnvironmentValue(environment.GOOGLE_PLACES_API_KEY),
    pageSpeedApiKey: optionalEnvironmentValue(environment.PAGESPEED_API_KEY),
    jobRunnerSecret: optionalEnvironmentValue(environment.JOB_RUNNER_SECRET),
  });
}

export function getServerSecrets(): ServerSecrets {
  return parseServerSecrets();
}
