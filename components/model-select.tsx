"use client";

import { cn } from "@/lib/utils";

export interface ModelOption {
  id: string;
  label: string;
  provider: "azure" | "anthropic" | "google";
  tier: "flagship" | "balanced" | "budget";
  priceIn: number;
  priceOut: number;
}

const PROVIDER_LABEL: Record<ModelOption["provider"], string> = {
  azure: "Azure OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
};

export function ModelSelect({
  models,
  value,
  onChange,
  className,
}: {
  models: ModelOption[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const providers = [...new Set(models.map((m) => m.provider))];

  return (
    <label className={cn("flex items-center gap-2 text-sm", className)}>
      <span className="text-muted-foreground">Model:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 cursor-pointer rounded-md border border-input bg-card px-2.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="auto">Auto — route by step (recommended)</option>
        {providers.map((provider) => (
          <optgroup key={provider} label={PROVIDER_LABEL[provider]}>
            {models
              .filter((m) => m.provider === provider)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — ${m.priceIn}/${m.priceOut} per 1M tokens
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
