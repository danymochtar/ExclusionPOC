import { TriangleAlert } from "lucide-react";

import type {
  AssessmentResult,
  AssessorDecision,
  ExclusionClause,
} from "@/lib/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { ConfidenceBar } from "@/components/confidence-bar";
import { AssessorDecisionBar } from "@/components/assessor-decision";
import { cn } from "@/lib/utils";

const STATUS_EDGE: Record<AssessmentResult["status"], string> = {
  excluded: "border-l-red-500",
  likely: "border-l-amber-500",
  review: "border-l-blue-500",
  not_excluded: "border-l-emerald-500",
};

export function ResultCard({
  result,
  clauseById,
  decision,
  onDecide,
}: {
  result: AssessmentResult;
  clauseById: Map<string, ExclusionClause>;
  decision?: AssessorDecision;
  onDecide: (decision: AssessorDecision | undefined) => void;
}) {
  return (
    <Card className={cn("border-l-4", STATUS_EDGE[result.status])}>
      <CardHeader className="p-4 pb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">{result.diagnosis}</p>
          <StatusBadge status={result.status} />
        </div>
        <ConfidenceBar value={result.overallConfidence} />
      </CardHeader>
      <CardContent className="p-4">
        {result.matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {result.status === "not_excluded"
              ? "None of the policy's exclusion rules appear to apply to this condition."
              : "The app could not point to a specific policy rule — please review this one manually."}
          </p>
        ) : (
          <ul className="space-y-3">
            {result.matches.map((match) => {
              const clause = clauseById.get(match.clauseId);
              return (
                <li
                  key={match.clauseId}
                  className="rounded-lg border bg-muted/40 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {match.clauseNumber}
                      {clause ? ` — ${clause.title}` : ""}
                    </p>
                    <ConfidenceBar value={match.confidence} />
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {match.rationale}
                  </p>
                  {match.exceptionNote && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        <span className="font-medium">
                          Exception — may still be covered:{" "}
                        </span>
                        {match.exceptionNote}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <AssessorDecisionBar decision={decision} onDecide={onDecide} />
      </CardContent>
    </Card>
  );
}
