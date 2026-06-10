/** Strip markdown code fences and any prose around the outermost JSON value. */
export function extractJson(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) text = fenced[1].trim();

  // Fall back to the outermost array/object if the model added prose.
  const firstBracket = text.search(/[[{]/);
  if (firstBracket > 0) {
    const open = text[firstBracket];
    const close = open === "[" ? "]" : "}";
    const lastClose = text.lastIndexOf(close);
    if (lastClose > firstBracket) {
      text = text.slice(firstBracket, lastClose + 1);
    }
  }
  return text;
}

export function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(extractJson(raw)) as T;
  } catch {
    return null;
  }
}

export function clamp01(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
