import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getRuntimeConfig } from "@/config/env";
import type { Database } from "@/db/types";

export function getSupabaseAdminClient(): SupabaseClient<Database> | null {
  const config = getRuntimeConfig();

  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    return null;
  }

  return createClient<Database>(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
