import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getRuntimeConfig } from "@/config/env";

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export function getSupabaseAdminClient(): SupabaseClient<Database> | null {
  const config = getRuntimeConfig();

  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    return null;
  }

  return createClient<Database>(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
