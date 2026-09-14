import { NextResponse } from "next/server";

import { getHealthStatus } from "@/server/health";

export function GET() {
  return NextResponse.json(getHealthStatus());
}
