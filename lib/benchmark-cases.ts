// Test-case line format shared by the benchmark page and its docs.
// One condition per line. An answer key after "|" is OPTIONAL and only used
// for marking (never sent to the models):
//   "Tooth extraction"                  -> compared, not scored
//   "Tooth extraction | flag 5"         -> should be flagged, citing rule 5
//   "Alcohol injury | flag 6/11"        -> rule 6 or 11 both count
//   "Appendicitis | clear"              -> should NOT be flagged

export interface BenchmarkCaseInput {
  diagnosis: string;
  expectFlag?: boolean;
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

    if (!diagnosis || rest.length > 0) {
      errors.push(line);
      continue;
    }

    // No answer key — compare this condition without scoring it.
    if (expectPart === undefined) {
      cases.push({ diagnosis });
      continue;
    }

    if (expectation === "clear") {
      cases.push({ diagnosis, expectFlag: false });
      continue;
    }

    const flagMatch = expectation?.match(/^flag(?:\s+([\d/\s]+))?$/);
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
export const SAMPLE_BENCHMARK_CASES = `Elective rhinoplasty for nose reshaping
Rhinoplasty to repair nasal fracture after road traffic accident
Tooth extraction for dental caries
Emergency dental treatment after fall injuring natural teeth
Pneumocystis pneumonia in HIV-positive patient
Multiple injuries, driver under influence of alcohol (RTA)
Newborn with ventricular septal defect
Major depressive disorder, single episode
Generalised anxiety disorder
In-vitro fertilisation (IVF) treatment
Investigation of obstructive sleep apnoea and snoring
Acute appendicitis with emergency appendicectomy
Dengue fever with warning signs`;

// The same cases with the answer key, for scored runs.
export const SAMPLE_BENCHMARK_CASES_SCORED = `Elective rhinoplasty for nose reshaping | flag 4
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

/**
 * Built-in answer key: conditions matching a known sample (case-insensitive)
 * are graded automatically even when entered without a marking key, so the
 * default demo shows accuracy scores while the input stays a plain list.
 * An explicit key on the line always wins.
 */
export function applyGoldenAnswers(
  cases: BenchmarkCaseInput[]
): BenchmarkCaseInput[] {
  const golden = new Map(
    parseCaseLines(SAMPLE_BENCHMARK_CASES_SCORED).cases.map((c) => [
      c.diagnosis.toLowerCase(),
      c,
    ])
  );
  return cases.map((c) => {
    if (c.expectFlag !== undefined) return c;
    const known = golden.get(c.diagnosis.toLowerCase());
    return known ? { ...known, diagnosis: c.diagnosis } : c;
  });
}
