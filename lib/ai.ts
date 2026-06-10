import { createAzure } from "@ai-sdk/azure";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { APICallError, RetryError, generateText, type LanguageModel } from "ai";
import type { ModelEntry, Provider } from "@/lib/models";

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

  const azure = createAzure({
    ...azureBase(),
    apiKey: requireEnv("AZURE_OPENAI_API_KEY"),
    apiVersion: process.env.AZURE_OPENAI_API_VERSION,
  });
  // Azure deployments are named per resource; spec.model is used as the
  // deployment name, with the env var as the single-deployment fallback.
  // Use chat completions rather than the default Responses API — some
  // deployments (notably model-router) don't support Responses.
  return azure.chat(
    spec?.model ?? process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5.4-mini"
  );
}

/**
 * Azure accepts either a full endpoint URL (AI Foundry style, e.g.
 * https://my-resource.cognitiveservices.azure.com) or a bare resource name
 * that maps to https://{name}.openai.azure.com.
 */
function azureBase(): { baseURL: string } | { resourceName: string } {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (endpoint) {
    const trimmed = endpoint.replace(/\/+$/, "");
    return {
      baseURL: trimmed.endsWith("/openai") ? trimmed : `${trimmed}/openai`,
    };
  }
  const resourceName = process.env.AZURE_OPENAI_RESOURCE_NAME;
  if (!resourceName) {
    throw new Error(
      "Missing required environment variable AZURE_OPENAI_ENDPOINT (full URL) or AZURE_OPENAI_RESOURCE_NAME. See .env.example."
    );
  }
  return { resourceName };
}

function detectProvider(): Provider {
  if (process.env.AZURE_OPENAI_API_KEY) return "azure";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "google";
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
    return `Provider returned ${err.statusCode ?? "an error"}: ${body}`;
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
