import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { getServerSecrets } from "@/config/server-env";
import { runJobBatch } from "@/jobs/app-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: NextRequest): boolean {
  const secret = getServerSecrets().jobRunnerSecret;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!provided || provided.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!getServerSecrets().jobRunnerSecret) return NextResponse.json({ error: "JOB_RUNNER_SECRET is not configured" }, { status: 503 });
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 5) || 5, 1), 25);
  const timeBudgetMs = Math.min(Math.max(Number(url.searchParams.get("budgetMs") ?? 45_000) || 45_000, 1_000), 55_000);
  const workerId = request.headers.get("x-worker-id") ?? `http-${process.pid}`;

  const result = await runJobBatch({ workerId, limit, timeBudgetMs });
  if (!result) return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
