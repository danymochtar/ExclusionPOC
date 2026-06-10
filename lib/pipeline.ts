// Shared ingest/assess core used by /api/ingest, /api/assess and
// /api/benchmark. Server-only.

import { complete, type CompletionUsage } from "@/lib/ai";
import { ASSESSMENT_SYSTEM_PROMPT, INGESTION_SYSTEM_PROMPT } from "@/lib/prompts";
import { clamp01, safeParse } from "@/lib/json";
import type { ModelEntry } from "@/lib/models";
import type {
  AssessmentResult,
  ClauseMatch,
  ExclusionCategory,
  ExclusionClause,
  MatchStatus,
} from "@/lib/types";

const CATEGORIES: ExclusionCategory[] = [
  "diagnosis",
  "temporal",
  "circumstantial",
  "other",
];

const STATUSES: MatchStatus[] = ["excluded", "likely", "review", "not_excluded"];

export class IngestParseError extends Error {
  constructor() {
    super("Could not parse exclusion clauses from the model response.");
    this.name = "IngestParseError";
  }
}

export async function ingestPolicy(
  policyText: string,
  spec?: ModelEntry
): Promise<{ clauses: ExclusionClause[]; usage: CompletionUsage }> {
  const { text, usage } = await complete(INGESTION_SYSTEM_PROMPT, policyText, spec);
  const parsed = safeParse<Partial<ExclusionClause>[]>(text);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new IngestParseError();
  }

  // Policies often contain several numbered lists (e.g. Claim Exclusions
  // 1-20 and Sanctions Exclusions 1-3), so slugs of the clause numbers can
  // collide — every id must stay unique or matches cite the wrong clause.
  const seenIds = new Map<string, number>();
  const clauses: ExclusionClause[] = parsed.map((c, i) => ({
    id: dedupeId(toStableId(c.number, i), seenIds),
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

  return { clauses, usage };
}

export async function assessOne(
  clauses: ExclusionClause[],
  diagnosis: string,
  spec?: ModelEntry
): Promise<{ result: AssessmentResult; usage: CompletionUsage }> {
  const prompt = `Exclusion clauses:\n${JSON.stringify(
    clauses,
    null,
    2
  )}\n\nPatient diagnosis: ${diagnosis}`;

  const { text, usage } = await complete(ASSESSMENT_SYSTEM_PROMPT, prompt, spec);
  const parsed = safeParse<Partial<AssessmentResult>>(text);

  // On parse failure, fall back to "review" so a human always looks at it.
  if (!parsed || typeof parsed !== "object") {
    return { result: reviewFallback(diagnosis), usage };
  }

  const knownIds = new Set(clauses.map((c) => c.id));
  const numberById = new Map(clauses.map((c) => [c.id, c.number]));

  const matches: ClauseMatch[] = (Array.isArray(parsed.matches)
    ? parsed.matches
    : []
  )
    // Never let the model cite a clause we didn't provide.
    .filter((m) => m && typeof m.clauseId === "string" && knownIds.has(m.clauseId))
    .map((m) => ({
      clauseId: m.clauseId,
      clauseNumber:
        typeof m.clauseNumber === "string" && m.clauseNumber.trim()
          ? m.clauseNumber
          : numberById.get(m.clauseId) ?? m.clauseId,
      confidence: clamp01(m.confidence),
      rationale: typeof m.rationale === "string" ? m.rationale : "",
      ...(typeof m.exceptionNote === "string" && m.exceptionNote.trim()
        ? { exceptionNote: m.exceptionNote }
        : {}),
    }));

  let status: MatchStatus = STATUSES.includes(parsed.status as MatchStatus)
    ? (parsed.status as MatchStatus)
    : "review";
  if (status !== "not_excluded" && matches.length === 0) {
    // A flag with no citable clause is not actionable — send to review.
    status = "review";
  }

  return {
    result: {
      diagnosis,
      status,
      matches,
      overallConfidence: clamp01(parsed.overallConfidence),
    },
    usage,
  };
}

export function reviewFallback(diagnosis: string): AssessmentResult {
  return {
    diagnosis,
    status: "review",
    matches: [],
    overallConfidence: 0,
  };
}

export function isConfigError(err: unknown): err is Error {
  return err instanceof Error && err.message.startsWith("Missing required");
}

function dedupeId(id: string, seen: Map<string, number>): string {
  const count = (seen.get(id) ?? 0) + 1;
  seen.set(id, count);
  return count === 1 ? id : `${id}-${count}`;
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
