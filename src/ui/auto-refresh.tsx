"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches server data while a background run is active so the page reflects worker progress. */
export function AutoRefresh({ active, intervalMs = 5000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
  return null;
}
