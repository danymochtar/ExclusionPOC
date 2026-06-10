import { createAzure } from "@ai-sdk/azure";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, type LanguageModel } from "ai";

/**
 * Thin provider wrapper so the LLM is swappable via env vars.
 *
 *   AI_PROVIDER=azure (default)
 *     AZURE_OPENAI_RESOURCE_NAME, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT
 *   AI_PROVIDER=anthropic
 *     ANTHROPIC_API_KEY, ANTHROPIC_MODEL
 */
export function getModel(): LanguageModel {
  const provider = (process.env.AI_PROVIDER ?? "azure").toLowerCase();

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
  });
  return text;
}
