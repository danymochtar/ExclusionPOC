// Model catalog + router. Server-only (reads env) except for the types and
// the public shape exposed via /api/models.

export type Provider = "azure" | "anthropic" | "google";
export type ModelTier = "flagship" | "balanced" | "budget";

export interface ModelEntry {
  id: string; // registry id used by the UI, e.g. "anthropic/claude-opus-4-8"
  provider: Provider;
  model: string; // provider model id (or Azure deployment name)
  label: string;
  tier: ModelTier;
  priceIn: number; // USD per 1M input tokens (indicative)
  priceOut: number; // USD per 1M output tokens (indicative)
}

export const MODEL_CATALOG: ModelEntry[] = [
  // Azure OpenAI — `model` is used as the deployment name unless
  // AZURE_OPENAI_DEPLOYMENT overrides it (single-deployment setups).
  // model-router auto-selects an underlying GPT model per request; its real
  // cost varies with whatever model it routes to (prices below are
  // indicative, based on it mostly choosing mini-tier models).
  { id: "azure/model-router", provider: "azure", model: "model-router", label: "Azure Model Router (auto-picks GPT)", tier: "balanced", priceIn: 0.25, priceOut: 2 },
  { id: "azure/gpt-5.4", provider: "azure", model: "gpt-5.4", label: "GPT-5.4 (Azure)", tier: "flagship", priceIn: 2.5, priceOut: 15 },
  { id: "azure/gpt-5.4-mini", provider: "azure", model: "gpt-5.4-mini", label: "GPT-5.4 mini (Azure)", tier: "balanced", priceIn: 0.75, priceOut: 4.5 },
  { id: "azure/gpt-5.4-nano", provider: "azure", model: "gpt-5.4-nano", label: "GPT-5.4 nano (Azure)", tier: "budget", priceIn: 0.2, priceOut: 1.25 },
  // Anthropic
  { id: "anthropic/claude-opus-4-8", provider: "anthropic", model: "claude-opus-4-8", label: "Claude Opus 4.8", tier: "flagship", priceIn: 5, priceOut: 25 },
  { id: "anthropic/claude-sonnet-4-6", provider: "anthropic", model: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", tier: "balanced", priceIn: 3, priceOut: 15 },
  { id: "anthropic/claude-haiku-4-5", provider: "anthropic", model: "claude-haiku-4-5", label: "Claude Haiku 4.5", tier: "budget", priceIn: 1, priceOut: 5 },
  // Google Gemini
  { id: "google/gemini-3.1-pro-preview", provider: "google", model: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", tier: "flagship", priceIn: 4, priceOut: 18 },
  { id: "google/gemini-3.5-flash", provider: "google", model: "gemini-3.5-flash", label: "Gemini 3.5 Flash", tier: "balanced", priceIn: 1.5, priceOut: 9 },
  { id: "google/gemini-3.1-flash-lite", provider: "google", model: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", tier: "budget", priceIn: 0.25, priceOut: 1.5 },
];

const PROVIDER_KEY_ENV: Record<Provider, string> = {
  azure: "AZURE_OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

export function providerConfigured(provider: Provider): boolean {
  if (provider === "azure") {
    return Boolean(
      process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_OPENAI_2_API_KEY
    );
  }
  return Boolean(process.env[PROVIDER_KEY_ENV[provider]]);
}

/**
 * Azure deployments can be split across two resources: the primary
 * AZURE_OPENAI_* pair and an optional secondary AZURE_OPENAI_2_* pair.
 * AZURE_OPENAI_2_DEPLOYMENTS (comma-separated deployment names) says which
 * deployments live on the secondary resource.
 */
export function onSecondaryAzure(model: string): boolean {
  return (process.env.AZURE_OPENAI_2_DEPLOYMENTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(model.toLowerCase());
}

export function entryConfigured(entry: ModelEntry): boolean {
  if (entry.provider !== "azure") return providerConfigured(entry.provider);
  return onSecondaryAzure(entry.model)
    ? Boolean(process.env.AZURE_OPENAI_2_API_KEY)
    : Boolean(process.env.AZURE_OPENAI_API_KEY);
}

/** Catalog entries usable with the API keys currently configured. */
export function availableModels(): ModelEntry[] {
  return MODEL_CATALOG.filter(entryConfigured);
}

export function findModel(id: string): ModelEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

export type Phase = "ingest" | "assess";

// Tier preference per phase: ingestion is accuracy-critical and runs once
// per policy; assessment runs per claim, so cost matters more.
const PHASE_TIERS: Record<Phase, ModelTier[]> = {
  ingest: ["flagship", "balanced", "budget"],
  assess: ["balanced", "budget", "flagship"],
};

const PROVIDER_ORDER: Provider[] = ["anthropic", "azure", "google"];

/**
 * Resolve which model to run for a phase. An explicit modelId wins;
 * "auto"/undefined routes by phase across the configured providers.
 * Returns undefined when nothing is configured (caller falls back to the
 * env-driven default in lib/ai.ts).
 */
export function routeModel(phase: Phase, modelId?: string): ModelEntry | undefined {
  if (modelId && modelId !== "auto") {
    const entry = findModel(modelId);
    if (!entry || !entryConfigured(entry)) {
      throw new ModelNotAvailableError(modelId);
    }
    return entry;
  }
  const available = availableModels();
  for (const tier of PHASE_TIERS[phase]) {
    for (const provider of PROVIDER_ORDER) {
      const candidates = available.filter(
        (m) => m.tier === tier && m.provider === provider
      );
      // AZURE_OPENAI_DEPLOYMENT names a deployment known to exist — prefer
      // its catalog entry, since Azure 404s on undeployed models.
      const entry =
        candidates.find(
          (m) =>
            m.provider === "azure" &&
            m.model === process.env.AZURE_OPENAI_DEPLOYMENT
        ) ?? candidates[0];
      if (entry) return entry;
    }
  }
  return undefined;
}

export class ModelNotAvailableError extends Error {
  constructor(modelId: string) {
    super(`Model "${modelId}" is not available (unknown id or its provider's API key is not configured).`);
    this.name = "ModelNotAvailableError";
  }
}
