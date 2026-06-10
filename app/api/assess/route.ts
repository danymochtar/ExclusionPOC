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

const MAX_DIAGNOSES = 25;

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

  const uniqueDiagnoses = [...new Set(diagnoses.map((d) => d.trim()))];
  if (uniqueDiagnoses.length > MAX_DIAGNOSES) {
    return NextResponse.json(
      { error: `Too many diagnoses (max ${MAX_DIAGNOSES} per run).` },
      { status: 400 }
    );
  }

  // One LLM call per diagnosis; a transient failure on one must not lose the
  // rest of the batch, so failures degrade to a "review" result instead.
  const settled = await Promise.allSettled(
    uniqueDiagnoses.map((d) => assessOne(clauses as ExclusionClause[], d))
  );

  const configError = settled.find(
    (s): s is PromiseRejectedResult =>
      s.status === "rejected" &&
      s.reason instanceof Error &&
      s.reason.message.startsWith("Missing required")
  );
  if (configError) {
    return NextResponse.json(
      { error: (configError.reason as Error).message },
      { status: 500 }
    );
  }

  const results = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    console.error(`assess failed for "${uniqueDiagnoses[i]}"`, s.reason);
    return reviewFallback(uniqueDiagnoses[i]);
  });

  return NextResponse.json({ results });
}

function reviewFallback(diagnosis: string): AssessmentResult {
  return {
    diagnosis,
    status: "review",
    matches: [],
    overallConfidence: 0,
  };
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
    return reviewFallback(diagnosis);
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
