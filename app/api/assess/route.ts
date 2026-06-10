import { NextResponse } from "next/server";
import { complete } from "@/lib/ai";
import { ASSESSMENT_SYSTEM_PROMPT } from "@/lib/prompts";
import { clamp01, safeParse } from "@/lib/json";
import type {
  AssessmentResult,
  ClauseMatch,
  ExclusionClause,
  MatchStatus,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const STATUSES: MatchStatus[] = ["excluded", "likely", "review", "not_excluded"];

export async function POST(req: Request) {
  let body: { clauses?: unknown; diagnoses?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const clauses = body.clauses;
  const diagnoses = body.diagnoses;

  if (!Array.isArray(clauses) || clauses.length === 0) {
    return NextResponse.json(
      { error: "Body must include a non-empty 'clauses' array." },
      { status: 400 }
    );
  }
  if (
    !Array.isArray(diagnoses) ||
    diagnoses.length === 0 ||
    !diagnoses.every((d) => typeof d === "string" && d.trim() !== "")
  ) {
    return NextResponse.json(
      { error: "Body must include a non-empty 'diagnoses' string array." },
      { status: 400 }
    );
  }

  try {
    const results = await Promise.all(
      (diagnoses as string[]).map((d) =>
        assessOne(clauses as ExclusionClause[], d.trim())
      )
    );
    return NextResponse.json({ results });
  } catch (err) {
    console.error("assess failed", err);
    const message =
      err instanceof Error && err.message.startsWith("Missing required")
        ? err.message
        : "Assessment failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function assessOne(
  clauses: ExclusionClause[],
  diagnosis: string
): Promise<AssessmentResult> {
  const prompt = `Exclusion clauses:\n${JSON.stringify(
    clauses,
    null,
    2
  )}\n\nPatient diagnosis: ${diagnosis}`;

  const raw = await complete(ASSESSMENT_SYSTEM_PROMPT, prompt);
  const parsed = safeParse<Partial<AssessmentResult>>(raw);

  // On parse failure, fall back to "review" so a human always looks at it.
  if (!parsed || typeof parsed !== "object") {
    return {
      diagnosis,
      status: "review",
      matches: [],
      overallConfidence: 0,
    };
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
    diagnosis,
    status,
    matches,
    overallConfidence: clamp01(parsed.overallConfidence),
  };
}
