import { NextResponse } from "next/server";
import { availableModels, providerConfigured } from "@/lib/models";

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
  const azureDeployments = await listAzureDeployments();
  return NextResponse.json({ models, default: "auto", azureDeployments });
}

/**
 * What the Azure resource actually serves, so the UI can warn about catalog
 * entries with no matching deployment (Azure 404s on those). Best-effort:
 * null when Azure isn't configured or the listing fails.
 */
async function listAzureDeployments(): Promise<string[] | null> {
  if (!providerConfigured("azure")) return null;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const resourceName = process.env.AZURE_OPENAI_RESOURCE_NAME;
  const base = endpoint
    ? endpoint.replace(/\/+$/, "").replace(/\/openai$/, "")
    : resourceName
      ? `https://${resourceName}.openai.azure.com`
      : null;
  if (!base) return null;

  try {
    const res = await fetch(`${base}/openai/v1/models?api-version=v1`, {
      headers: { "api-key": process.env.AZURE_OPENAI_API_KEY! },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.data)) return null;
    return data.data
      .map((m: { id?: unknown }) => (typeof m.id === "string" ? m.id : null))
      .filter((id: string | null): id is string => id !== null);
  } catch {
    return null;
  }
}
