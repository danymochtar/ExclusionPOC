import { NextResponse } from "next/server";
import {
  assessOne,
  ingestPolicy,
  isConfigError,
  IngestParseError,
  reviewFallback,
} from "@/lib/pipeline";
import { findModel, ModelNotAvailableError, providerConfigured } from "@/lib/models";
import { describeLLMError, type CompletionUsage } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_CASES = 25;
const MAX_POLICY_CHARS = 100_000;

interface BenchmarkCase {
  diagnosis: string;
  expectFlag?: boolean; // undefined = no answer key; compared but not scored
  expectClause?: string; // e.g. "17" or "6/11" for alternatives
}

export interface BenchmarkCaseRow {
  diagnosis: string;
  expectFlag?: boolean;
  expectClause?: string;
  status: string;
  citedClauses: string[];
  exceptionNoted: boolean;
  flagCorrect: boolean | null; // null = no answer key
  citationCorrect: boolean | null; // null = not applicable
  confidence: number;
  failed: boolean; // call failed and degraded to review
  servedBy?: string; // actual model that served the call (router deployments)
}

export async function POST(req: Request) {
  let body: { modelId?: unknown; policyText?: unknown; cases?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.modelId !== "string") {
    return NextResponse.json(
      { error: "Body must include a 'modelId' string." },
      { status: 400 }
    );
  }
  const spec = findModel(body.modelId);
  if (!spec || !providerConfigured(spec.provider)) {
    return NextResponse.json(
      { error: new ModelNotAvailableError(body.modelId).message },
      { status: 400 }
    );
  }

  if (
    typeof body.policyText !== "string" ||
    !body.policyText.trim() ||
    body.policyText.length > MAX_POLICY_CHARS
  ) {
    return NextResponse.json(
      { error: "Body must include a non-empty 'policyText' string (max 100k chars)." },
      { status: 400 }
    );
  }

  const cases = parseCases(body.cases);
  if (!cases) {
    return NextResponse.json(
      {
        error:
          "Body must include 'cases': [{diagnosis, expectFlag, expectClause?}] (1-25 entries).",
      },
      { status: 400 }
    );
  }

  const usages: CompletionUsage[] = [];
  const servedTally = new Map<string, number>();
  const tally = (servedModel?: string) => {
    if (servedModel) {
      servedTally.set(servedModel, (servedTally.get(servedModel) ?? 0) + 1);
    }
  };

  try {
    // Phase 1: ingest the policy once.
    const ingestStart = Date.now();
    const {
      clauses,
      usage: ingestUsage,
      servedModel: ingestServedBy,
    } = await ingestPolicy(body.policyText, spec);
    const ingestMs = Date.now() - ingestStart;
    usages.push(ingestUsage);
    tally(ingestServedBy);

    // Phase 2: assess every case; isolate per-case failures.
    const assessStart = Date.now();
    const settled = await Promise.allSettled(
      cases.map((c) => assessOne(clauses, c.diagnosis, spec))
    );
    const assessMs = Date.now() - assessStart;

    const rows: BenchmarkCaseRow[] = settled.map((s, i) => {
      const c = cases[i];
      const failed = s.status === "rejected";
      if (failed) console.error(`benchmark assess failed: "${c.diagnosis}"`, (s as PromiseRejectedResult).reason);
      const value = failed
        ? null
        : (s as PromiseFulfilledResult<Awaited<ReturnType<typeof assessOne>>>).value;
      const result = value?.result ?? reviewFallback(c.diagnosis);
      if (value) {
        usages.push(value.usage);
        tally(value.servedModel);
      }

      const flagged = result.status !== "not_excluded";
      const citedClauses = result.matches.map((m) => m.clauseNumber);
      const citationCorrect =
        c.expectFlag && c.expectClause
          ? flagged && citesExpected(citedClauses, c.expectClause)
          : null;

      return {
        diagnosis: c.diagnosis,
        expectFlag: c.expectFlag,
        expectClause: c.expectClause,
        status: result.status,
        citedClauses,
        exceptionNoted: result.matches.some((m) => Boolean(m.exceptionNote)),
        flagCorrect:
          c.expectFlag === undefined ? null : flagged === c.expectFlag,
        citationCorrect,
        confidence: result.overallConfidence,
        failed,
        ...(value?.servedModel ? { servedBy: value.servedModel } : {}),
      };
    });

    const scoredRows = rows.filter((r) => r.flagCorrect !== null);
    const citationRows = rows.filter((r) => r.citationCorrect !== null);
    const inputTokens = usages.reduce((s, u) => s + u.inputTokens, 0);
    const outputTokens = usages.reduce((s, u) => s + u.outputTokens, 0);

    return NextResponse.json({
      model: { id: spec.id, label: spec.label, provider: spec.provider },
      clauseCount: clauses.length,
      ingestMs,
      assessMs,
      flaggedCount: rows.filter((r) => r.status !== "not_excluded").length,
      // Accuracy is only computable for cases that carry an answer key.
      flagAccuracy:
        scoredRows.length === 0
          ? null
          : ratio(scoredRows.filter((r) => r.flagCorrect).length, scoredRows.length),
      citationAccuracy:
        citationRows.length === 0
          ? null
          : ratio(
              citationRows.filter((r) => r.citationCorrect).length,
              citationRows.length
            ),
      exceptionsCaught: rows.filter((r) => r.exceptionNoted).length,
      avgConfidence: ratio(
        rows.reduce((s, r) => s + r.confidence, 0),
        rows.length
      ),
      failedCalls: rows.filter((r) => r.failed).length,
      // Which models actually served the calls — for router deployments
      // this reveals the router's picks (e.g. {"gpt-5-mini": 7, ...}).
      servedModels: Object.fromEntries(servedTally),
      ingestServedBy: ingestServedBy ?? null,
      usage: { inputTokens, outputTokens },
      estCostUsd:
        (inputTokens * spec.priceIn + outputTokens * spec.priceOut) / 1_000_000,
      rows,
    });
  } catch (err) {
    if (err instanceof IngestParseError) {
      return NextResponse.json(
        { error: `${spec.label}: ${err.message}` },
        { status: 502 }
      );
    }
    console.error(`benchmark failed for ${spec.id}`, err);
    const cause = describeLLMError(err);
    return NextResponse.json(
      {
        error: isConfigError(err)
          ? err.message
          : `Benchmark run failed for ${spec.label}.${cause ? ` ${cause}` : ""}`,
      },
      { status: 500 }
    );
  }
}

function parseCases(raw: unknown): BenchmarkCase[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CASES) {
    return null;
  }
  const cases: BenchmarkCase[] = [];
  for (const item of raw) {
    const c = item as BenchmarkCase;
    if (
      !c ||
      typeof c !== "object" ||
      typeof c.diagnosis !== "string" ||
      !c.diagnosis.trim() ||
      (c.expectFlag !== undefined && typeof c.expectFlag !== "boolean")
    ) {
      return null;
    }
    cases.push({
      diagnosis: c.diagnosis.trim(),
      ...(c.expectFlag !== undefined ? { expectFlag: c.expectFlag } : {}),
      ...(typeof c.expectClause === "string" && c.expectClause.trim()
        ? { expectClause: c.expectClause.trim() }
        : {}),
    });
  }
  return cases;
}

/** "6/11" means clause 6 OR 11 is an acceptable citation. */
function citesExpected(citedClauses: string[], expectClause: string): boolean {
  const accepted = expectClause
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  const citedNumbers = citedClauses.flatMap((c) => c.match(/\d+/g) ?? []);
  return accepted.some((a) => citedNumbers.includes(a));
}

function ratio(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}
