import { NextResponse } from "next/server";
import { ingestPolicy, isConfigError, IngestParseError } from "@/lib/pipeline";
import { ModelNotAvailableError, routeModel } from "@/lib/models";
import { describeLLMError } from "@/lib/ai";
import { heartbeatJson } from "@/lib/stream";

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

  // Heartbeat-streamed: reading a long policy can exceed mobile browsers'
  // ~60s fetch limit. Errors arrive as { error } in the streamed body.
  return heartbeatJson(async () => {
    try {
      const spec = routeModel(
        "ingest",
        typeof modelId === "string" ? modelId : undefined
      );
      const { clauses, usage, servedModel } = await ingestPolicy(
        policyText as string,
        spec
      );
      return {
        clauses,
        usage,
        servedModel: servedModel ?? null,
        modelUsed: spec ? { id: spec.id, label: spec.label } : null,
      };
    } catch (err) {
      if (err instanceof ModelNotAvailableError || err instanceof IngestParseError) {
        throw err;
      }
      console.error("ingest failed", err);
      const cause = describeLLMError(err);
      throw new Error(
        isConfigError(err)
          ? err.message
          : `Policy ingestion failed.${cause ? ` ${cause}` : ""}`
      );
    }
  });
}
