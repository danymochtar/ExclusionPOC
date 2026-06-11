import { createAzure } from "@ai-sdk/azure";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  APICallError,
  RetryError,
  gateway,
  generateText,
  type LanguageModel,
} from "ai";
import {
  DEFAULT_GATEWAY_MODELS,
  onSecondaryAzure,
  type ModelEntry,
  type Provider,
} from "@/lib/models";

/**
 * Thin provider wrapper so the LLM is swappable.
 *
 * Called with a registry entry (from lib/models.ts) it builds that exact
 * provider/model. Called bare it falls back to env-driven config:
 *
 *   AI_PROVIDER=azure
 *     AZURE_OPENAI_API_KEY, plus either AZURE_OPENAI_ENDPOINT (full URL, e.g.
 *     https://my-resource.cognitiveservices.azure.com) or
 *     AZURE_OPENAI_RESOURCE_NAME; AZURE_OPENAI_DEPLOYMENT
 *   AI_PROVIDER=anthropic
 *     ANTHROPIC_API_KEY, ANTHROPIC_MODEL
 *   AI_PROVIDER=google
 *     GOOGLE_GENERATIVE_AI_API_KEY, GOOGLE_MODEL
 *
 * If AI_PROVIDER is unset, the provider is inferred from which API key is
 * configured (Azure first, then Anthropic, then Google).
 */
export function getModel(spec?: Pick<ModelEntry, "provider" | "model">): LanguageModel {
  const provider = spec
    ? spec.provider
    : ((process.env.AI_PROVIDER ?? detectProvider()).toLowerCase() as Provider);

  if (provider === "anthropic") {
    // baseURL supports gateways/proxies; some inject auth, so the key is
    // only required when no gateway is configured.
    const baseURL = process.env.ANTHROPIC_BASE_URL;
    const anthropic = createAnthropic({
      baseURL: baseURL ? `${baseURL.replace(/\/$/, "")}/v1` : undefined,
      apiKey: baseURL
        ? process.env.ANTHROPIC_API_KEY ?? "unused"
        : requireEnv("ANTHROPIC_API_KEY"),
    });
    return anthropic(spec?.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8");
  }

  if (provider === "google") {
    const google = createGoogleGenerativeAI({
      apiKey: requireEnv("GOOGLE_GENERATIVE_AI_API_KEY"),
    });
    return google(spec?.model ?? process.env.GOOGLE_MODEL ?? "gemini-3.5-flash");
  }

  if (provider === "gateway") {
    // Vercel AI Gateway — the provider reads AI_GATEWAY_API_KEY itself;
    // model ids are "creator/model" (https://vercel.com/ai-gateway/models).
    requireEnv("AI_GATEWAY_API_KEY");
    const fallback = (process.env.AI_GATEWAY_MODELS ?? DEFAULT_GATEWAY_MODELS)
      .split(",")[0]
      .trim();
    return gateway(spec?.model ?? fallback);
  }

  // Azure deployments are named per resource; spec.model is used as the
  // deployment name, with the env var as the single-deployment fallback.
  const deployment =
    spec?.model ?? process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5.4-mini";
  const azure = createAzure({
    ...azureConfigFor(deployment),
    apiVersion: process.env.AZURE_OPENAI_API_VERSION,
  });
  // Use chat completions rather than the default Responses API — some
  // deployments (notably model-router) don't support Responses.
  return azure.chat(deployment);
}

/**
 * Resolve the endpoint + key for an Azure deployment. Deployments listed in
 * AZURE_OPENAI_2_DEPLOYMENTS use the secondary AZURE_OPENAI_2_* resource;
 * everything else uses the primary AZURE_OPENAI_* pair. Endpoints accept a
 * full URL (Foundry style, cognitiveservices.azure.com or openai.azure.com)
 * or a bare resource name mapping to https://{name}.openai.azure.com.
 */
function azureConfigFor(deployment: string): (
  | { baseURL: string }
  | { resourceName: string }
) & { apiKey: string } {
  const secondary = onSecondaryAzure(deployment);
  const prefix = secondary ? "AZURE_OPENAI_2" : "AZURE_OPENAI";
  const apiKey = requireEnv(`${prefix}_API_KEY`);

  const endpoint = process.env[`${prefix}_ENDPOINT`];
  if (endpoint) {
    const trimmed = endpoint.replace(/\/+$/, "");
    return {
      baseURL: trimmed.endsWith("/openai") ? trimmed : `${trimmed}/openai`,
      apiKey,
    };
  }
  const resourceName = process.env[`${prefix}_RESOURCE_NAME`];
  if (!resourceName) {
    throw new Error(
      `Missing required environment variable ${prefix}_ENDPOINT (full URL) or ${prefix}_RESOURCE_NAME. See .env.example.`
    );
  }
  return { resourceName, apiKey };
}

function detectProvider(): Provider {
  if (process.env.AZURE_OPENAI_API_KEY) return "azure";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "google";
  if (process.env.AI_GATEWAY_API_KEY) return "gateway";
  return "azure";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`
    );
  }
  return value;
}

/**
 * Human-readable cause for a failed LLM call, safe to show in the UI
 * (status + provider error body excerpt — no headers/keys).
 */
export function describeLLMError(err: unknown): string | null {
  // Retried failures (429s, 5xx, timeouts) arrive wrapped in RetryError.
  if (RetryError.isInstance(err)) {
    return describeLLMError(err.lastError) ?? `Retries exhausted: ${err.reason}`;
  }
  if (APICallError.isInstance(err)) {
    const body =
      typeof err.responseBody === "string"
        ? err.responseBody.slice(0, 300)
        : err.message;
    let host = "";
    try {
      host = ` from ${new URL(err.url).host}`;
    } catch {
      // no usable URL on the error
    }
    return `Provider returned ${err.statusCode ?? "an error"}${host}: ${body}`;
  }
  if (err instanceof Error && err.name === "AbortError") {
    return "The request timed out.";
  }
  return null;
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export async function complete(
  system: string,
  prompt: string,
  spec?: Pick<ModelEntry, "provider" | "model">
): Promise<{ text: string; usage: CompletionUsage; servedModel?: string }> {
  const { text, usage, response } = await generateText({
    model: getModel(spec),
    system,
    prompt,
    temperature: 0,
    // A full rulebook with verbatim clause text can exceed the 4096-token
    // default some providers fall back to, which truncates the JSON.
    maxOutputTokens: 16_384,
  });
  return {
    text,
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    },
    // The model that actually served the call — for router deployments this
    // is the underlying model the router picked, not the deployment name.
    servedModel: response?.modelId,
  };
}
