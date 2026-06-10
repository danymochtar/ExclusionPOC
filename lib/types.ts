export type ExclusionCategory =
  | "diagnosis"
  | "temporal"
  | "circumstantial"
  | "other";

export interface ExclusionClause {
  id: string; // stable id, e.g. "claim-17"
  number: string; // human label, e.g. "Claim Exclusion 17"
  title: string; // short label, e.g. "Mental / nervous disorders"
  category: ExclusionCategory;
  triggerConcepts: string[]; // e.g. ["depression","anxiety","neurosis","mental disorder"]
  icdHints?: string[]; // optional, e.g. ["F32","F40-F48"]
  exceptions: string[]; // carve-outs, e.g. ["except as necessitated by injury"]
  rawText: string; // verbatim clause
}

export type MatchStatus = "excluded" | "likely" | "review" | "not_excluded";

export interface ClauseMatch {
  clauseId: string;
  clauseNumber: string;
  confidence: number; // 0..1
  rationale: string; // plain-language, cites the clause
  exceptionNote?: string; // present if a carve-out may apply
}

export interface AssessmentResult {
  diagnosis: string;
  status: MatchStatus;
  matches: ClauseMatch[]; // empty if not_excluded
  overallConfidence: number; // 0..1
}
