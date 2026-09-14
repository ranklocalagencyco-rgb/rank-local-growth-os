import { getRuntimeConfig } from "@/config/env";

export function getHealthStatus() {
  const config = getRuntimeConfig();

  return {
    status: "ok" as const,
    appEnv: config.appEnv,
    sendMode: config.sendMode,
    databaseConfigured: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
    timestamp: new Date().toISOString(),
  };
}
