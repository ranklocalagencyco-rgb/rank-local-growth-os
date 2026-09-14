import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getRuntimeConfig } from "@/config/env";
import type { Database } from "@/db/types";

export async function createClient() {
  const cookieStore = await cookies();
  const config = getRuntimeConfig();

  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    throw new Error("Supabase public environment variables are not configured");
  }

  return createServerClient<Database>(config.supabaseUrl, config.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot always mutate response cookies; middleware refreshes sessions.
        }
      },
    },
  });
}