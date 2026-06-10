import { NextResponse } from "next/server";
import { assessOne, isConfigError, reviewFallback } from "@/lib/pipeline";
import { ModelNotAvailableError, routeModel } from "@/lib/models";
import { heartbeatJson } from "@/lib/stream";
import type { ExclusionClause } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_DIAGNOSES = 25;

export async function POST(req: Request) {
  let body: { clauses?: unknown; diagnoses?: unknown; modelId?: unknown };
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

  let spec;
  try {
    spec = routeModel(
      "assess",
      typeof body.modelId === "string" ? body.modelId : undefined
    );
  } catch (err) {
    if (err instanceof ModelNotAvailableError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // Heartbeat-streamed: many parallel checks can exceed mobile browsers'
  // ~60s fetch limit. Errors arrive as { error } in the streamed body.
  return heartbeatJson(async () => {
    // One LLM call per diagnosis; a transient failure on one must not lose
    // the rest of the batch, so failures degrade to a "review" result.
    const settled = await Promise.allSettled(
      uniqueDiagnoses.map((d) =>
        assessOne(clauses as ExclusionClause[], d, spec)
      )
    );

    const configError = settled.find(
      (s): s is PromiseRejectedResult =>
        s.status === "rejected" && isConfigError(s.reason)
    );
    if (configError) {
      throw new Error((configError.reason as Error).message);
    }

    const results = settled.map((s, i) => {
      if (s.status === "fulfilled") return s.value.result;
      console.error(`assess failed for "${uniqueDiagnoses[i]}"`, s.reason);
      return reviewFallback(uniqueDiagnoses[i]);
    });

    return {
      results,
      modelUsed: spec ? { id: spec.id, label: spec.label } : null,
    };
  });
}
