import { NextResponse } from "next/server";
import { complete } from "@/lib/ai";
import { INGESTION_SYSTEM_PROMPT } from "@/lib/prompts";
import { safeParse } from "@/lib/json";
import type { ExclusionCategory, ExclusionClause } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const CATEGORIES: ExclusionCategory[] = [
  "diagnosis",
  "temporal",
  "circumstantial",
  "other",
];

export async function POST(req: Request) {
  let policyText: unknown;
  try {
    ({ policyText } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof policyText !== "string" || !policyText.trim()) {
    return NextResponse.json(
      { error: "Body must include a non-empty 'policyText' string." },
      { status: 400 }
    );
  }

  try {
    const raw = await complete(INGESTION_SYSTEM_PROMPT, policyText);
    const parsed = safeParse<Partial<ExclusionClause>[]>(raw);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return NextResponse.json(
        { error: "Could not parse exclusion clauses from the model response." },
        { status: 502 }
      );
    }

    const clauses: ExclusionClause[] = parsed.map((c, i) => ({
      id: toStableId(c.number, i),
      number: str(c.number) || `Clause ${i + 1}`,
      title: str(c.title) || "Untitled exclusion",
      category: CATEGORIES.includes(c.category as ExclusionCategory)
        ? (c.category as ExclusionCategory)
        : "other",
      triggerConcepts: strArray(c.triggerConcepts),
      icdHints: strArray(c.icdHints),
      exceptions: strArray(c.exceptions),
      rawText: str(c.rawText),
    }));

    return NextResponse.json({ clauses });
  } catch (err) {
    console.error("ingest failed", err);
    const message =
      err instanceof Error && err.message.startsWith("Missing required")
        ? err.message
        : "Policy ingestion failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function toStableId(number: unknown, index: number): string {
  const slug = str(number)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `clause-${index + 1}`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : [];
}
