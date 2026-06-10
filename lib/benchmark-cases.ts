// Test-case line format shared by the benchmark page and its docs.
// One case per line:  diagnosis | flag <clause #>   or   diagnosis | clear
// e.g. "Tooth extraction | flag 5"  /  "Appendicitis | clear"
// Alternatives are slash-separated: "Alcohol intoxication injury | flag 6/11"

export interface BenchmarkCaseInput {
  diagnosis: string;
  expectFlag: boolean;
  expectClause?: string;
}

export function parseCaseLines(text: string): {
  cases: BenchmarkCaseInput[];
  errors: string[];
} {
  const cases: BenchmarkCaseInput[] = [];
  const errors: string[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const [diagnosisPart, expectPart, ...rest] = line.split("|");
    const diagnosis = diagnosisPart?.trim();
    const expectation = expectPart?.trim().toLowerCase();

    if (!diagnosis || !expectation || rest.length > 0) {
      errors.push(line);
      continue;
    }

    if (expectation === "clear") {
      cases.push({ diagnosis, expectFlag: false });
      continue;
    }

    const flagMatch = expectation.match(/^flag(?:\s+([\d/\s]+))?$/);
    if (!flagMatch) {
      errors.push(line);
      continue;
    }
    const expectClause = flagMatch[1]?.replace(/\s+/g, "");
    cases.push({
      diagnosis,
      expectFlag: true,
      ...(expectClause ? { expectClause } : {}),
    });
  }

  return { cases, errors };
}

export const SAMPLE_BENCHMARK_CASES = `Cosmetic surgery (rhinoplasty) | flag 4
Tooth extraction | flag 5
HIV positive / AIDS | flag 6
Alcohol intoxication injury | flag 6/11
Congenital heart disease | flag 7
Major depressive disorder | flag 17
Generalised anxiety disorder | flag 17
Appendicitis | clear`;
