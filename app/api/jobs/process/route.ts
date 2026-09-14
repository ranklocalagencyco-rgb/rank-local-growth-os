import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getRuntimeConfig } from "@/config/env";
import { runJobBatch } from "@/jobs/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = getRuntimeConfig().jobsWorkerSecret;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Cron/worker trigger: processes one bounded batch so no single request runs a whole discovery. */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await runJobBatch(`http:${process.pid}`, 3);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Job processing failed" }, { status: 500 });
  }
}
