"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
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
  applyGoldenAnswers,
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
  expectFlag?: boolean;
  expectClause?: string;
  status: string;
  citedClauses: string[];
  exceptionNoted: boolean;
  flagCorrect: boolean | null;
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
  flaggedCount: number;
  flagAccuracy: number | null;
  citationAccuracy: number | null;
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

type SortKey =
  | "label"
  | "clauseCount"
  | "flaggedCount"
  | "flagAccuracy"
  | "citationAccuracy"
  | "exceptionsCaught"
  | "time"
  | "estCostUsd";

const SORT_VALUE: Record<SortKey, (run: ModelRun) => number | string | null> = {
  label: (r) => r.model.label.toLowerCase(),
  clauseCount: (r) => r.clauseCount,
  flaggedCount: (r) => r.flaggedCount,
  flagAccuracy: (r) => r.flagAccuracy,
  citationAccuracy: (r) => r.citationAccuracy,
  exceptionsCaught: (r) => r.exceptionsCaught,
  time: (r) => r.ingestMs + r.assessMs,
  estCostUsd: (r) => r.estCostUsd,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
async function postJson(url: string, body: unknown): Promise<any> {
  // Retry once on network-level failures (fetch rejects with TypeError —
  // e.g. Safari's "Load failed" on flaky mobile connections). API errors
  // (4xx/5xx) are not retried.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`);
      return data;
    } catch (err) {
      if (attempt < 1 && err instanceof TypeError) continue;
      throw err;
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export default function BenchmarkPage() {
  const [policyText, setPolicyText] = useState(SAMPLE_POLICY_TEXT);
  const [casesText, setCasesText] = useState(SAMPLE_BENCHMARK_CASES);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [azureDeployments, setAzureDeployments] = useState<string[] | null>(
    null
  );
  const [azureSecondary, setAzureSecondary] = useState<{
    keySet: boolean;
    deployments: string[];
  } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<RunState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

  // Completed runs sort by the chosen column; pending/running/failed rows
  // keep their original order at the bottom.
  const sortedRuns = useMemo(() => {
    if (!sort) return runs;
    const value = SORT_VALUE[sort.key];
    return [...runs].sort((a, b) => {
      if (!a.run || !b.run) return a.run ? -1 : b.run ? 1 : 0;
      const va = value(a.run);
      const vb = value(b.run);
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return 0;
    });
  }, [runs, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev?.key === key
        ? prev.dir === 1
          ? { key, dir: -1 }
          : null
        : { key, dir: 1 }
    );
  }

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then((data) => {
        const list: ModelOption[] = data.models ?? [];
        setModels(list);
        setAzureDeployments(data.azureDeployments ?? null);
        setAzureSecondary(data.azureSecondary ?? null);
        // Preselect one balanced-tier model per provider for a quick start.
        setSelected(
          new Set(list.filter((m) => m.tier === "balanced").map((m) => m.id))
        );
      })
      .catch(() => setModels([]));
  }, []);

  // Azure 404s on catalog entries with no matching deployment — warn upfront.
  const undeployedAzure = useMemo(() => {
    if (!azureDeployments) return [];
    const deployed = new Set(azureDeployments.map((d) => d.toLowerCase()));
    return models.filter(
      (m) =>
        m.provider === "azure" && !deployed.has(m.id.split("/")[1].toLowerCase())
    );
  }, [models, azureDeployments]);

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

    // Two short requests per model (read policy, then check conditions)
    // instead of one long one — mobile browsers abort fetches around 60s.
    // Results stream into the table as each model finishes.
    for (const model of chosen) {
      setRuns((prev) =>
        prev.map((r) =>
          r.modelId === model.id ? { ...r, status: "running" } : r
        )
      );
      try {
        const ingestStart = Date.now();
        const ingested = await postJson("/api/ingest", {
          policyText,
          modelId: model.id,
        });
        const ingestMs = Date.now() - ingestStart;

        const data = await postJson("/api/benchmark", {
          modelId: model.id,
          cases: applyGoldenAnswers(parsed.cases),
          clauses: ingested.clauses,
          ingest: {
            ms: ingestMs,
            usage: ingested.usage,
            servedModel: ingested.servedModel,
          },
        });
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
            title="Test conditions"
            subtitle="The patient conditions to test, one per line. Every model checks the same list."
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCasesText(SAMPLE_BENCHMARK_CASES)}
            >
              <FlaskConical />
              Load sample cases
            </Button>
          </div>
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
          <p className="mt-1 text-xs text-muted-foreground">
            The built-in sample conditions are graded automatically against a
            stored answer key (the models never see it). To grade your own
            conditions, add the correct answer after the condition —{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              Tooth extraction | flag 5
            </code>{" "}
            means &ldquo;should be flagged under rule 5&rdquo;,{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              Appendicitis | clear
            </code>{" "}
            means &ldquo;should not be flagged&rdquo;.
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
            const undeployed = undeployedAzure.some((u) => u.id === m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                className={cn(
                  "cursor-pointer rounded-lg border px-3 py-1.5 text-sm shadow-sm transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card hover:bg-accent",
                  undeployed && "border-amber-300"
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
                {undeployed && (
                  <span
                    className={cn(
                      "ml-1.5 text-xs",
                      active ? "text-amber-200" : "text-amber-600"
                    )}
                  >
                    not deployed in Azure
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {azureDeployments && (
          <p className="mt-2 text-xs text-muted-foreground">
            Azure deployments on your resource:{" "}
            {azureDeployments.length > 0
              ? azureDeployments.slice(0, 12).join(", ") +
                (azureDeployments.length > 12
                  ? ` +${azureDeployments.length - 12} more`
                  : "")
              : "none found"}
            {undeployedAzure.length > 0 &&
              " — models marked amber will fail until deployed in Azure AI Foundry (Models + endpoints → Deploy model)."}
          </p>
        )}
        {azureSecondary && (
          <p className="mt-1 text-xs text-muted-foreground">
            Second Azure resource:{" "}
            {!azureSecondary.keySet
              ? "endpoint set but AZURE_OPENAI_2_API_KEY is missing."
              : azureSecondary.deployments.length === 0
                ? "endpoint + key set, but AZURE_OPENAI_2_DEPLOYMENTS is empty — nothing routes to it. Set it to the deployment name(s), e.g. model-router."
                : `routing ${azureSecondary.deployments.join(", ")} to it.`}
          </p>
        )}
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
                  <SortHeader label="Model" k="label" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Rules found" k="clauseCount" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Flagged" k="flaggedCount" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Flag accuracy" k="flagAccuracy" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Citation accuracy" k="citationAccuracy" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Exceptions caught" k="exceptionsCaught" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Time" k="time" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Est. cost" k="estCostUsd" sort={sort} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {sortedRuns.map((r) => (
                  <tr key={r.modelId} className="border-b last:border-0">
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{r.label}</span>
                      <ServedByNote run={r.run} />
                    </td>
                    {r.status === "done" && r.run ? (
                      <>
                        <td className="px-4 py-2.5">{r.run.clauseCount}</td>
                        <td className="px-4 py-2.5 tabular-nums">
                          {r.run.flaggedCount}/{r.run.rows.length}
                        </td>
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
                      <td colSpan={7} className="px-4 py-2.5 text-muted-foreground">
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

function SortHeader({
  label,
  k,
  sort,
  onSort,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 } | null;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === k;
  return (
    <th className="px-4 py-2.5 font-medium">
      <button
        type="button"
        onClick={() => onSort(k)}
        className="flex cursor-pointer items-center gap-1 hover:text-foreground"
      >
        {label}
        {active ? (
          sort.dir === 1 ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
      </button>
    </th>
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
                      {row.expectFlag === undefined
                        ? "—"
                        : row.expectFlag
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
                      {row.flagCorrect === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Mark ok={row.flagCorrect} />
                      )}
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

function Pct({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-muted-foreground">— (no marking key)</span>;
  }
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
