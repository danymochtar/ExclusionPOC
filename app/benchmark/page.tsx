"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  FileText,
  FlaskConical,
  ListChecks,
  Loader2,
  Play,
  X,
} from "lucide-react";

import {
  parseCaseLines,
  SAMPLE_BENCHMARK_CASES,
} from "@/lib/benchmark-cases";
import { SAMPLE_POLICY_TEXT } from "@/lib/sample-data";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { ModelOption } from "@/components/model-select";
import { cn } from "@/lib/utils";

interface CaseRow {
  diagnosis: string;
  expectFlag: boolean;
  expectClause?: string;
  status: string;
  citedClauses: string[];
  exceptionNoted: boolean;
  flagCorrect: boolean;
  citationCorrect: boolean | null;
  confidence: number;
  failed: boolean;
  servedBy?: string;
}

interface ModelRun {
  model: { id: string; label: string; provider: string };
  clauseCount: number;
  ingestMs: number;
  assessMs: number;
  flagAccuracy: number;
  citationAccuracy: number;
  exceptionsCaught: number;
  avgConfidence: number;
  failedCalls: number;
  servedModels: Record<string, number>;
  ingestServedBy: string | null;
  usage: { inputTokens: number; outputTokens: number };
  estCostUsd: number;
  rows: CaseRow[];
}

interface RunState {
  modelId: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  error?: string;
  run?: ModelRun;
}

export default function BenchmarkPage() {
  const [policyText, setPolicyText] = useState(SAMPLE_POLICY_TEXT);
  const [casesText, setCasesText] = useState(SAMPLE_BENCHMARK_CASES);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<RunState[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then((data) => {
        const list: ModelOption[] = data.models ?? [];
        setModels(list);
        // Preselect one balanced-tier model per provider for a quick start.
        setSelected(
          new Set(list.filter((m) => m.tier === "balanced").map((m) => m.id))
        );
      })
      .catch(() => setModels([]));
  }, []);

  const parsed = useMemo(() => parseCaseLines(casesText), [casesText]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleRun() {
    setError(null);
    if (parsed.errors.length > 0) {
      setError(
        `Could not read these test lines: ${parsed.errors.join(" · ")}. Use "diagnosis | flag 5" or "diagnosis | clear".`
      );
      return;
    }
    const chosen = models.filter((m) => selected.has(m.id));
    setRunning(true);
    setRuns(
      chosen.map((m) => ({ modelId: m.id, label: m.label, status: "pending" }))
    );

    // One request per model so each run fits within serverless time limits;
    // results stream into the table as each model finishes.
    for (const model of chosen) {
      setRuns((prev) =>
        prev.map((r) =>
          r.modelId === model.id ? { ...r, status: "running" } : r
        )
      );
      try {
        const res = await fetch("/api/benchmark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelId: model.id,
            policyText,
            cases: parsed.cases,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Run failed (${res.status}).`);
        setRuns((prev) =>
          prev.map((r) =>
            r.modelId === model.id ? { ...r, status: "done", run: data } : r
          )
        );
      } catch (err) {
        setRuns((prev) =>
          prev.map((r) =>
            r.modelId === model.id
              ? {
                  ...r,
                  status: "error",
                  error: err instanceof Error ? err.message : "Run failed.",
                }
              : r
          )
        );
      }
    }
    setRunning(false);
  }

  const doneRuns = runs.filter((r) => r.status === "done" && r.run);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <BarChart3 className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Model benchmark
            </h1>
            <p className="text-sm text-muted-foreground">
              Run the same policy and test conditions through each model and
              compare accuracy, speed, and cost.
            </p>
          </div>
        </div>
        <Link
          href="/"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="size-4" />
          Back to assessment
        </Link>
      </header>

      {error && (
        <Alert variant="destructive" className="mt-6">
          <X />
          <AlertTitle>Check your inputs</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <SectionHeading
            icon={<FileText className="size-4" />}
            title="Policy exclusion wording"
            subtitle="The same policy is read by every model."
          />
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setPolicyText(SAMPLE_POLICY_TEXT)}
          >
            <FlaskConical />
            Use sample policy
          </Button>
          <Textarea
            className="mt-2 min-h-40 font-mono text-xs"
            value={policyText}
            onChange={(e) => setPolicyText(e.target.value)}
          />
        </section>

        <section>
          <SectionHeading
            icon={<ListChecks className="size-4" />}
            title="Test conditions with expected answers"
            subtitle={
              <>
                One per line:{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  condition | flag 5
                </code>{" "}
                (should be flagged, citing rule 5),{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  condition | flag 6/11
                </code>{" "}
                (rule 6 or 11), or{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  condition | clear
                </code>{" "}
                (should not be flagged).
              </>
            }
          />
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setCasesText(SAMPLE_BENCHMARK_CASES)}
          >
            <FlaskConical />
            Load sample cases
          </Button>
          <Textarea
            className="mt-2 min-h-40 font-mono text-xs"
            value={casesText}
            onChange={(e) => setCasesText(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {parsed.cases.length} test case{parsed.cases.length === 1 ? "" : "s"}
            {parsed.errors.length > 0 &&
              ` · ${parsed.errors.length} line(s) not understood`}
          </p>
        </section>
      </div>

      <section className="mt-8">
        <SectionHeading
          icon={<Check className="size-4" />}
          title="Models to compare"
          subtitle={
            models.length === 0
              ? "No models available — add at least one provider API key to the deployment."
              : "Pick the models to race. Each runs the full read-policy + check-conditions pipeline."
          }
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {models.map((m) => {
            const active = selected.has(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                className={cn(
                  "cursor-pointer rounded-lg border px-3 py-1.5 text-sm shadow-sm transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card hover:bg-accent"
                )}
              >
                {m.label}
                <span
                  className={cn(
                    "ml-1.5 text-xs",
                    active ? "text-primary-foreground/70" : "text-muted-foreground"
                  )}
                >
                  ${m.priceIn}/${m.priceOut}
                </span>
              </button>
            );
          })}
        </div>
        <Button
          className="mt-4"
          disabled={
            running ||
            selected.size === 0 ||
            parsed.cases.length === 0 ||
            !policyText.trim()
          }
          onClick={handleRun}
        >
          {running ? <Loader2 className="animate-spin" /> : <Play />}
          {running
            ? "Running…"
            : `Run benchmark (${selected.size} model${selected.size === 1 ? "" : "s"})`}
        </Button>
      </section>

      {runs.length > 0 && (
        <section className="mt-8">
          <SectionHeading
            icon={<BarChart3 className="size-4" />}
            title="Results"
            subtitle="Flag accuracy = did it flag the right conditions. Citation accuracy = did it point at the right rule."
          />
          <div className="mt-3 overflow-x-auto rounded-xl border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Model</th>
                  <th className="px-4 py-2.5 font-medium">Rules found</th>
                  <th className="px-4 py-2.5 font-medium">Flag accuracy</th>
                  <th className="px-4 py-2.5 font-medium">Citation accuracy</th>
                  <th className="px-4 py-2.5 font-medium">Exceptions caught</th>
                  <th className="px-4 py-2.5 font-medium">Time</th>
                  <th className="px-4 py-2.5 font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.modelId} className="border-b last:border-0">
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{r.label}</span>
                      <ServedByNote run={r.run} />
                    </td>
                    {r.status === "done" && r.run ? (
                      <>
                        <td className="px-4 py-2.5">{r.run.clauseCount}</td>
                        <td className="px-4 py-2.5">
                          <Pct value={r.run.flagAccuracy} />
                        </td>
                        <td className="px-4 py-2.5">
                          <Pct value={r.run.citationAccuracy} />
                        </td>
                        <td className="px-4 py-2.5">{r.run.exceptionsCaught}</td>
                        <td className="px-4 py-2.5 tabular-nums">
                          {((r.run.ingestMs + r.run.assessMs) / 1000).toFixed(1)}s
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">
                          ${r.run.estCostUsd.toFixed(4)}
                        </td>
                      </>
                    ) : (
                      <td colSpan={6} className="px-4 py-2.5 text-muted-foreground">
                        {r.status === "pending" && "Waiting…"}
                        {r.status === "running" && (
                          <span className="flex items-center gap-2">
                            <Loader2 className="size-3.5 animate-spin" />
                            Reading policy and checking conditions…
                          </span>
                        )}
                        {r.status === "error" && (
                          <span className="text-destructive">{r.error}</span>
                        )}
                        {r.run?.failedCalls ? (
                          <span> · {r.run.failedCalls} call(s) failed</span>
                        ) : null}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-3">
            {doneRuns.map((r) => (
              <ModelDetail key={r.modelId} run={r.run!} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

/**
 * Which model(s) actually answered. For router deployments this reveals the
 * router's per-call picks; for fixed models it shows the exact serving
 * snapshot (e.g. a dated model version).
 */
function ServedByNote({ run }: { run?: ModelRun }) {
  if (!run) return null;
  const entries = Object.entries(run.servedModels ?? {});
  if (entries.length === 0) return null;
  return (
    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
      answered by{" "}
      {entries
        .map(([model, calls]) => `${model} ×${calls}`)
        .join(", ")}
      {run.ingestServedBy ? ` · policy read by ${run.ingestServedBy}` : ""}
    </span>
  );
}

function ModelDetail({ run }: { run: ModelRun }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="py-0">
      <CardHeader className="p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full cursor-pointer items-center justify-between gap-2 text-left"
        >
          <CardTitle className="text-sm">
            {run.model.label} — case by case
          </CardTitle>
          <ChevronDown
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </button>
      </CardHeader>
      {open && (
        <CardContent className="p-4 pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Condition</th>
                  <th className="px-2 py-2 font-medium">Expected</th>
                  <th className="px-2 py-2 font-medium">Got</th>
                  <th className="px-2 py-2 font-medium">Rules cited</th>
                  <th className="px-2 py-2 font-medium">Flag</th>
                  <th className="px-2 py-2 font-medium">Citation</th>
                  <th className="px-2 py-2 font-medium">Exception</th>
                  <th className="px-2 py-2 font-medium">Answered by</th>
                </tr>
              </thead>
              <tbody>
                {run.rows.map((row) => (
                  <tr key={row.diagnosis} className="border-b last:border-0">
                    <td className="px-2 py-2">{row.diagnosis}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {row.expectFlag
                        ? `flag${row.expectClause ? ` (rule ${row.expectClause})` : ""}`
                        : "clear"}
                    </td>
                    <td className="px-2 py-2">
                      {row.failed ? (
                        <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                          call failed → review
                        </Badge>
                      ) : (
                        row.status.replace("_", " ")
                      )}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {row.citedClauses.join(", ") || "—"}
                    </td>
                    <td className="px-2 py-2">
                      <Mark ok={row.flagCorrect} />
                    </td>
                    <td className="px-2 py-2">
                      {row.citationCorrect === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Mark ok={row.citationCorrect} />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {row.exceptionNoted ? (
                        <span className="text-amber-600">noted</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {row.servedBy ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function Pct({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span
      className={cn(
        "tabular-nums",
        pct >= 90 ? "text-emerald-600" : pct >= 70 ? "text-amber-600" : "text-red-600"
      )}
    >
      {pct}%
    </span>
  );
}

function Mark({ ok }: { ok: boolean }) {
  return ok ? (
    <Check className="size-4 text-emerald-600" />
  ) : (
    <X className="size-4 text-red-600" />
  );
}

function SectionHeading({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="flex items-center gap-1.5 font-semibold">
        {icon}
        {title}
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
