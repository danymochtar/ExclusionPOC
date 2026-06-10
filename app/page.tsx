"use client";

import { useMemo, useRef, useState } from "react";
import {
  BookOpenText,
  Download,
  FileText,
  FlaskConical,
  ListChecks,
  Loader2,
  ScanSearch,
  ShieldAlert,
  Upload,
} from "lucide-react";

import type {
  AssessmentResult,
  AssessorDecision,
  ExclusionClause,
} from "@/lib/types";
import { SAMPLE_DIAGNOSES, SAMPLE_POLICY_TEXT } from "@/lib/sample-data";
import { buildAssessorNote, downloadText } from "@/lib/assessor-note";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ClauseCard } from "@/components/clause-card";
import { ResultCard } from "@/components/result-card";

export default function Home() {
  const [policyText, setPolicyText] = useState("");
  const [clauses, setClauses] = useState<ExclusionClause[]>([]);
  const [diagnosesText, setDiagnosesText] = useState("");
  const [results, setResults] = useState<AssessmentResult[]>([]);
  const [decisions, setDecisions] = useState<
    Record<string, AssessorDecision>
  >({});

  const [extracting, setExtracting] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [assessing, setAssessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const clauseById = useMemo(
    () => new Map(clauses.map((c) => [c.id, c])),
    [clauses]
  );
  const diagnoses = useMemo(
    () => [
      ...new Set(
        diagnosesText
          .split("\n")
          .map((d) => d.trim())
          .filter(Boolean)
      ),
    ],
    [diagnosesText]
  );

  async function callApi<T>(url: string, init: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error ?? `Request to ${url} failed (${res.status}).`);
    }
    return data as T;
  }

  async function handlePdfUpload(file: File) {
    setError(null);
    setExtracting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { text } = await callApi<{ text: string }>("/api/extract", {
        method: "POST",
        body: formData,
      });
      setPolicyText(text);
      setClauses([]);
      setResults([]);
      setDecisions({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF extraction failed.");
    } finally {
      setExtracting(false);
    }
  }

  async function handleIngest() {
    setError(null);
    setIngesting(true);
    try {
      const { clauses } = await callApi<{ clauses: ExclusionClause[] }>(
        "/api/ingest",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ policyText }),
        }
      );
      setClauses(clauses);
      setResults([]);
      setDecisions({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Policy ingestion failed.");
    } finally {
      setIngesting(false);
    }
  }

  async function handleAssess() {
    setError(null);
    setAssessing(true);
    try {
      const { results } = await callApi<{ results: AssessmentResult[] }>(
        "/api/assess",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clauses, diagnoses }),
        }
      );
      setResults(results);
      setDecisions({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assessment failed.");
    } finally {
      setAssessing(false);
    }
  }

  function handleExport() {
    downloadText(
      "assessor-note.txt",
      buildAssessorNote(results, clauses, decisions)
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldAlert className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Exclusion Flag
            </h1>
            <p className="text-sm text-muted-foreground">
              Flags possible policy exclusions for review — it does not decide
              claims.
            </p>
          </div>
        </div>
        <Badge variant="secondary">Proof of concept</Badge>
      </header>

      {error && (
        <Alert variant="destructive" className="mt-6">
          <ShieldAlert />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        {/* Left panel: policy + rulebook */}
        <section className="space-y-6 lg:col-span-5">
          <Badge variant="secondary" className="font-normal">
            Set up once per policy
          </Badge>
          <div>
            <StepHeading
              step={1}
              icon={<FileText className="size-4" />}
              title="Policy exclusion wording"
              subtitle="Upload the policy's exclusion pages as a PDF, or paste the text — the list of things the policy doesn't cover."
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handlePdfUpload(file);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={extracting}
                onClick={() => fileInputRef.current?.click()}
              >
                {extracting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Upload />
                )}
                Upload PDF
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPolicyText(SAMPLE_POLICY_TEXT);
                  setClauses([]);
                  setResults([]);
                  setDecisions({});
                  setError(null);
                }}
              >
                <FlaskConical />
                Use sample policy
              </Button>
            </div>
            <Textarea
              className="mt-3 min-h-44 font-mono text-xs"
              placeholder="…or paste the exclusion wording here"
              value={policyText}
              onChange={(e) => {
                setPolicyText(e.target.value);
                // The rulebook no longer matches the edited wording.
                setClauses([]);
                setResults([]);
                setDecisions({});
              }}
            />
            <Button
              className="mt-3 w-full"
              disabled={!policyText.trim() || ingesting}
              onClick={handleIngest}
            >
              {ingesting ? (
                <Loader2 className="animate-spin" />
              ) : (
                <BookOpenText />
              )}
              {ingesting ? "Reading the policy…" : "Read the policy"}
            </Button>
          </div>

          <div>
            <StepHeading
              step={2}
              icon={<ListChecks className="size-4" />}
              title="Check what the app understood"
              subtitle={
                clauses.length > 0
                  ? `${clauses.length} exclusion rules found. Each card is one rule, in the policy's own words — check them before assessing.`
                  : "The exclusion rules found in the policy will appear here as cards."
              }
            />
            {clauses.length === 0 ? (
              <EmptyHint>
                Nothing here yet. Load the policy wording above and click
                &ldquo;Read the policy&rdquo;.
              </EmptyHint>
            ) : (
              <div className="mt-3 max-h-[42rem] space-y-3 overflow-y-auto pr-1">
                {clauses.map((clause) => (
                  <ClauseCard key={clause.id} clause={clause} />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Right panel: diagnoses + results */}
        <section className="space-y-6 lg:col-span-7">
          <Badge variant="secondary" className="font-normal">
            Repeats for every claim
          </Badge>
          <div>
            <StepHeading
              step={3}
              icon={<ScanSearch className="size-4" />}
              title="Assess diagnoses"
              subtitle="Type the patient's conditions, one per line. Each is checked against every rule from the policy."
            />
            <div className="mt-3 flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDiagnosesText(SAMPLE_DIAGNOSES.join("\n"))}
              >
                <FlaskConical />
                Load samples
              </Button>
            </div>
            <Textarea
              className="mt-3 min-h-36"
              placeholder={"Major depressive disorder\nTooth extraction\nAppendicitis"}
              value={diagnosesText}
              onChange={(e) => setDiagnosesText(e.target.value)}
            />
            <Button
              className="mt-3 w-full"
              disabled={clauses.length === 0 || diagnoses.length === 0 || assessing}
              onClick={handleAssess}
            >
              {assessing ? <Loader2 className="animate-spin" /> : <ScanSearch />}
              {assessing
                ? `Checking ${diagnoses.length} condition${diagnoses.length === 1 ? "" : "s"}…`
                : clauses.length === 0
                  ? "Read the policy first"
                  : "Check against the policy"}
            </Button>
          </div>

          {results.length > 0 && (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <StepHeading
                  step={4}
                  icon={<ShieldAlert className="size-4" />}
                  title="Flags for review"
                  subtitle="Each alert shows which policy rule it matched and why. You make the final call."
                />
                <Button variant="outline" size="sm" onClick={handleExport}>
                  <Download />
                  Export assessor note
                </Button>
              </div>
              <div className="mt-3 space-y-3">
                {results.map((result, i) => (
                  <ResultCard
                    key={`${i}-${result.diagnosis}`}
                    result={result}
                    clauseById={clauseById}
                    decision={decisions[result.diagnosis]}
                    onDecide={(decision) =>
                      setDecisions((prev) => {
                        const next = { ...prev };
                        if (decision) next[result.diagnosis] = decision;
                        else delete next[result.diagnosis];
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function StepHeading({
  step,
  icon,
  title,
  subtitle,
}: {
  step: number;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-card text-xs font-semibold">
        {step}
      </div>
      <div>
        <h2 className="flex items-center gap-1.5 font-semibold">
          {icon}
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
