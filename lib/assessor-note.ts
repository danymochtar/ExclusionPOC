import type {
  AssessmentResult,
  AssessorDecision,
  ExclusionClause,
} from "./types";

const STATUS_LABEL: Record<AssessmentResult["status"], string> = {
  excluded: "EXCLUSION FOUND — VERIFY",
  likely: "POSSIBLE EXCLUSION",
  review: "NEEDS HUMAN REVIEW",
  not_excluded: "NO EXCLUSION FOUND",
};

const DECISION_LABEL: Record<AssessorDecision["action"], string> = {
  confirm: "Exclusion confirmed by assessor",
  override: "Overridden by assessor",
  info: "More information requested",
};

export function buildAssessorNote(
  results: AssessmentResult[],
  clauses: ExclusionClause[],
  decisions: Record<string, AssessorDecision> = {}
): string {
  const clauseById = new Map(clauses.map((c) => [c.id, c]));
  const lines: string[] = [
    "EXCLUSION SCREENING NOTE (decision support — not a claims decision)",
    `Generated: ${new Date().toISOString()}`,
    `Diagnoses screened: ${results.length}`,
    "",
  ];

  for (const result of results) {
    lines.push(
      `• ${result.diagnosis} — ${STATUS_LABEL[result.status]} (${Math.round(
        result.overallConfidence * 100
      )}% confidence)`
    );
    for (const match of result.matches) {
      const clause = clauseById.get(match.clauseId);
      lines.push(
        `    ${match.clauseNumber}${clause ? ` (${clause.title})` : ""}: ${
          match.rationale
        }`
      );
      if (match.exceptionNote) {
        lines.push(
          `    ⚠ Exception — may still be covered: ${match.exceptionNote}`
        );
      }
    }
    const decision = decisions[result.diagnosis];
    lines.push(
      decision
        ? `    Assessor: ${DECISION_LABEL[decision.action]}${
            decision.reason ? ` — "${decision.reason}"` : ""
          }`
        : "    Assessor: not yet reviewed"
    );
    lines.push("");
  }

  lines.push(
    "Decision support only — final assessment is made by a qualified assessor."
  );
  return lines.join("\n");
}

export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
