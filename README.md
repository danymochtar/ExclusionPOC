# Exclusion App — POC

Flags whether a patient's diagnosis falls under an insurance/takaful policy
exclusion, with the exact clause cited, a confidence score, a plain-language
rationale, and any carve-out/exception warning.

**This is decision support, not auto-adjudication.** The app flags and
explains; a qualified assessor decides. The UI deliberately uses
flag/review language — never approve/reject.

## How it works

Two LLM phases:

1. **Ingestion** (once per policy) — `POST /api/ingest` reads the exclusion
   wording and turns each clause into a structured `ExclusionClause`
   (trigger concepts, category, exceptions, verbatim text).
2. **Assessment** (per diagnosis) — `POST /api/assess` matches each diagnosis
   against that rulebook and returns a status, the matched clause(s), a
   confidence score, a rationale, and any exception warning.

Exceptions/carve-outs are first-class: conditional exclusions (e.g. dental
treatment "except as necessitated by accidental injury") are surfaced as
amber warnings rather than silently excluded.

## Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS v4 + shadcn-style components (`components/ui`)
- Vercel AI SDK; provider swappable via `lib/ai.ts` (Azure OpenAI ↔ Anthropic)
- PDF text extraction server-side with `unpdf` (`POST /api/extract`)
- React state only — no database (clean seam to add Prisma/Postgres later)

## Getting started

```bash
cp .env.example .env.local   # add your Azure OpenAI or Anthropic credentials
npm install
npm run dev
```

Open http://localhost:3000.

## Demo script

1. Click **Use sample policy** (a de-identified takaful medical certificate's
   Claim Exclusions + Sanctions Exclusions) or upload the PDF, then
   **Build rulebook** — ~20 parsed clauses appear with category tags.
2. Click **Load samples** — 8 diagnoses populate.
3. **Run assessment** — depression/anxiety flag against the mental/nervous
   clause; congenital heart disease flags congenital; HIV flags; dental and
   cosmetic flag **with exception notes** (injury carve-outs); appendicitis
   comes back not excluded (control case).
4. **Export assessor note** downloads a plain-text summary of the flags.

## API

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/extract` | multipart PDF (`file`) | `{ text }` |
| `POST /api/ingest` | `{ policyText }` | `{ clauses: ExclusionClause[] }` |
| `POST /api/assess` | `{ clauses, diagnoses }` | `{ results: AssessmentResult[] }` |

## Environment

| Variable | Notes |
| --- | --- |
| `AI_PROVIDER` | `azure` (default) or `anthropic` |
| `AZURE_OPENAI_RESOURCE_NAME` / `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_DEPLOYMENT` | Azure OpenAI |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Anthropic |

## POC scope / non-goals

- Alerting only — no auto approve/reject.
- `icdHints` is a placeholder; a deterministic ICD-10 layer (e.g. Azure AI
  Language Text Analytics for Health) is a Phase 2 enhancement.
- No persistence, auth, or multi-policy management — single session.
- Temporal exclusions (waiting periods, pre-existing conditions) are detected
  and categorised but not scored — they need member/policy dates, so they're
  shown as "needs policy data".
- Sample data is de-identified; never use real patient identifiers.

## Production integration path

The POC's core is the production core. In a real MiCare deployment only the
edges change: manual diagnosis entry (step 3) is replaced by an API hook from
the claims system (each incoming claim calls `POST /api/assess`), and the
flags (step 4) either embed in the claims UI or land in a work queue. The
rulebook review becomes an approve/edit step with versioning, and the
assessor decisions captured on each flag become the feedback data for tuning
prompts and measuring precision. The middle — ingest → rulebook → assess →
structured results — stays identical.

## Production hardening (not done in this POC)

- Uploaded policy text goes into the LLM prompt, so a malicious document
  could attempt prompt injection. Acceptable while documents come from
  trusted insurers; production would need input sanitisation/isolation.
- API error messages surface environment-variable names to ease setup;
  replace with generic messages before production.
- No auth or rate limiting on the API routes (input sizes are capped:
  10 MB PDF, 100k-char policy text, 25 diagnoses per run).
