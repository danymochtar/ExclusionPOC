import { createAzure } from "@ai-sdk/azure";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, type LanguageModel } from "ai";

/**
 * Thin provider wrapper so the LLM is swappable via env vars.
 *
 *   AI_PROVIDER=azure
 *     AZURE_OPENAI_RESOURCE_NAME, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT
 *   AI_PROVIDER=anthropic
 *     ANTHROPIC_API_KEY, ANTHROPIC_MODEL
 *
 * If AI_PROVIDER is unset, the provider is inferred from which API key is
 * configured (Azure wins if both are present).
 */
export function getModel(): LanguageModel {
  const provider = (process.env.AI_PROVIDER ?? detectProvider()).toLowerCase();

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
    return anthropic(process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6");
  }

  const azure = createAzure({
    resourceName: requireEnv("AZURE_OPENAI_RESOURCE_NAME"),
    apiKey: requireEnv("AZURE_OPENAI_API_KEY"),
    apiVersion: process.env.AZURE_OPENAI_API_VERSION,
  });
  return azure(process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o");
}

function detectProvider(): "azure" | "anthropic" {
  if (process.env.AZURE_OPENAI_API_KEY) return "azure";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
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

export async function complete(system: string, prompt: string): Promise<string> {
  const { text } = await generateText({
    model: getModel(),
    system,
    prompt,
    temperature: 0,
    // A full rulebook with verbatim clause text can exceed the 4096-token
    // default some providers fall back to, which truncates the JSON.
    maxOutputTokens: 16_384,
  });
  return text;
}
