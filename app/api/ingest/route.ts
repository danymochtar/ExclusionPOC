import { NextResponse } from "next/server";
import { ingestPolicy, isConfigError, IngestParseError } from "@/lib/pipeline";
import { ModelNotAvailableError, routeModel } from "@/lib/models";
import { describeLLMError } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_POLICY_CHARS = 100_000;

export async function POST(req: Request) {
  let policyText: unknown;
  let modelId: unknown;
  try {
    ({ policyText, modelId } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof policyText !== "string" || !policyText.trim()) {
    return NextResponse.json(
      { error: "Body must include a non-empty 'policyText' string." },
      { status: 400 }
    );
  }
  if (policyText.length > MAX_POLICY_CHARS) {
    return NextResponse.json(
      {
        error: `Policy text is too long (max ${MAX_POLICY_CHARS.toLocaleString()} characters). Paste only the exclusions section.`,
      },
      { status: 413 }
    );
  }

  try {
    const spec = routeModel(
      "ingest",
      typeof modelId === "string" ? modelId : undefined
    );
    const { clauses, usage, servedModel } = await ingestPolicy(
      policyText,
      spec
    );
    return NextResponse.json({
      clauses,
      usage,
      servedModel: servedModel ?? null,
      modelUsed: spec ? { id: spec.id, label: spec.label } : null,
    });
  } catch (err) {
    if (err instanceof ModelNotAvailableError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof IngestParseError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("ingest failed", err);
    const cause = describeLLMError(err);
    return NextResponse.json(
      {
        error: isConfigError(err)
          ? err.message
          : `Policy ingestion failed.${cause ? ` ${cause}` : ""}`,
      },
      { status: 500 }
    );
  }
}
