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

// Phrased like provisional diagnoses on real claim lines. Includes carve-out
// cases (accidental injury versions of cosmetic/dental) and negative
// controls (dengue is explicitly NOT a quarantinable disease under clause 6).
export const SAMPLE_BENCHMARK_CASES = `Elective rhinoplasty for nose reshaping | flag 4
Rhinoplasty to repair nasal fracture after road traffic accident | flag 4
Tooth extraction for dental caries | flag 5
Emergency dental treatment after fall injuring natural teeth | flag 5
Pneumocystis pneumonia in HIV-positive patient | flag 6
Multiple injuries, driver under influence of alcohol (RTA) | flag 6/11
Newborn with ventricular septal defect | flag 7
Major depressive disorder, single episode | flag 17
Generalised anxiety disorder | flag 17
In-vitro fertilisation (IVF) treatment | flag 8
Investigation of obstructive sleep apnoea and snoring | flag 15
Acute appendicitis with emergency appendicectomy | clear
Dengue fever with warning signs | clear`;
