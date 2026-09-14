import { createBrowserClient } from "@supabase/ssr";

import { getRuntimeConfig } from "@/config/env";
import type { Database } from "@/db/types";

export function createClient() {
  const config = getRuntimeConfig();

  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    throw new Error("Supabase public environment variables are not configured");
  }

  return createBrowserClient<Database>(config.supabaseUrl, config.supabasePublishableKey);
}