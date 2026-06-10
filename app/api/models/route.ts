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
 * What the Azure resource(s) actually serve, so the UI can warn about
 * catalog entries with no matching deployment (Azure 404s on those).
 * Checks both the primary AZURE_OPENAI_* and the optional secondary
 * AZURE_OPENAI_2_* resource. Best-effort: null when Azure isn't configured
 * or every listing fails.
 */
async function listAzureDeployments(): Promise<string[] | null> {
  if (!providerConfigured("azure")) return null;

  const lists = await Promise.all(
    (["AZURE_OPENAI", "AZURE_OPENAI_2"] as const).map((prefix) =>
      listResourceDeployments(prefix)
    )
  );
  const merged = [...new Set(lists.flat().filter((d): d is string => !!d))];
  return lists.every((l) => l === null) ? null : merged;
}

async function listResourceDeployments(
  prefix: "AZURE_OPENAI" | "AZURE_OPENAI_2"
): Promise<string[] | null> {
  const apiKey = process.env[`${prefix}_API_KEY`];
  const endpoint = process.env[`${prefix}_ENDPOINT`];
  const resourceName = process.env[`${prefix}_RESOURCE_NAME`];
  const base = endpoint
    ? endpoint.replace(/\/+$/, "").replace(/\/openai$/, "")
    : resourceName
      ? `https://${resourceName}.openai.azure.com`
      : null;
  if (!apiKey || !base) return null;

  try {
    // NOT /openai/v1/models — that returns the deployable model CATALOG
    // (hundreds of entries), not this resource's deployments.
    const res = await fetch(
      `${base}/openai/deployments?api-version=2023-03-15-preview`,
      {
        headers: { "api-key": apiKey },
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      }
    );
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
