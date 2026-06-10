import { NextResponse } from "next/server";
import { availableModels } from "@/lib/models";

export const runtime = "nodejs";

export async function GET() {
  // Only catalog metadata leaves the server — never key material.
  const models = availableModels().map((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
    tier: m.tier,
    priceIn: m.priceIn,
    priceOut: m.priceOut,
  }));
  return NextResponse.json({ models, default: "auto" });
}
