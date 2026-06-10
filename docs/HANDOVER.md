# DiffDoc — session handover

You're picking up work on **DiffDoc**, an AI-powered document comparison web app for SLA Pharma Group. Read this in full before touching anything.

## What it is

User uploads two `.docx` or `.pdf` files. The app parses both, runs a literal + semantic diff, and presents one of three view modes (auto-selected from a similarity score) plus an audit-ready export bundle (both originals, both edited versions, audit report PDF, manifest with hashes).

Reference docs (uploaded by user, not in repo):
- `diffdeckbuildplan.docx` — full 11–13 week build plan, 5 phases
- `diffdeckmockups.jsx` — original React mockup the UI is ported from

## Locked decisions (don't re-litigate)

| Decision | Value |
| --- | --- |
| Name | **DiffDoc** (was "DiffDeck" in mockup) |
| Brand | Stand-alone commercial brand. Keep neutral stone palette from mockup for now; design properly later. |
| Supabase region | **eu-west-2** (UK / EU only) |
| Free tier export | **Includes** audit report PDF |
| Stack | Next.js 14 App Router on Vercel · Railway worker · Supabase (db/storage/auth) · Anthropic API · Voyage AI embeddings · Stripe |

## Where things live

- **Repo:** `slapharma/DiffDoc` (https://github.com/slapharma/DiffDoc) — restricted scope, this is the only repo MCP tools can touch
- **Vercel project:** `slapharma/diff-doc`, production URL https://diff-doc-omega.vercel.app
- **Feature branch:** `claude/build-diffdoc-pr90b` — develop here, PR into `main`
- **GitHub accounts:** slapharma (per user instructions)

## What's done

- **PR #1 (merged):** Phase 0 — Next.js 14 scaffold, TypeScript strict, Tailwind, `next/font` for Inter + JetBrains Mono, UI shell with three view modes from the mockup (`components/workspace.tsx`). `vercel.json` pins `framework: nextjs` because the Vercel project was created with framework=null and was looking for a `public/` dir.
- **PR #2 (open, draft):** Phase 1a — parsing + literal diff library. Pure TypeScript, no infra deps.
  - `lib/document/types.ts` — internal JSON representation (sections / paragraphs / runs with character offsets)
  - `lib/document/parse-docx.ts` — mammoth-based, walks HTML output into paragraphs
  - `lib/document/parse-pdf.ts` — pdf-parse v1 (NOT v2 — v2 has a class-based API and was reverted)
  - `lib/document/index.ts` — `parseDocument(buf, { filename })` dispatcher
  - `lib/diff/literal.ts` — `diff-match-patch` wrapper with offset-anchored chunks and similarity score
  - `test/` — vitest harness, 9 tests passing, `test/fixtures/buildplan.docx` is a real-world fixture
  - URL: https://github.com/slapharma/DiffDoc/pull/2

## What's next (Phase 1 remainder)

In rough order, each its own PR:

1. **Supabase project + schema** — create the project (eu-west-2), apply migration for the 8 tables from the build plan (`users`, `comparisons`, `differences`, `comments`, `edits`, `audit_events`, `exports`, `usage_metrics`). Storage bucket for originals + bundles. Needs Supabase MCP access or user-provided keys.
2. **Upload API route** — `app/api/upload/route.ts` — validate file type, SHA-256 hash, write to Supabase Storage, insert `comparisons` row in `pending` state.
3. **Railway worker** — separate Node service, triggered by webhook from the Vercel API. Parses both docs (uses `lib/document`), runs literal diff (`lib/diff`), writes results back to Supabase. Needed because Vercel's 60s function timeout won't survive a 50-page DOCX.
4. **Wire real data into the workspace UI** — replace the hardcoded fixtures in `components/workspace.tsx` with data fetched from Supabase.

Then **Phase 2** (AI layer): Anthropic API client, Voyage AI embeddings + similarity score → view mode selector, per-diff classification with batching, flagging heuristics (numbers/dates/negations), executive summary, token accounting.

See the build plan for Phases 3–5 (workspace interactions, export bundle, commercial wrapper).

## Open items needing the user

Before starting Phase 1 step 1 you need to confirm with the user:

- **Supabase org** — which org under their account should host the project
- **Railway** — they need to either create the empty project or hand over an API token
- **API keys** — Anthropic + Voyage AI keys (Phase 2 but useful early so they're not blocking)

Don't guess. Ask via `AskUserQuestion` if needed.

## Operational notes

- **Branch:** always develop on `claude/build-diffdoc-pr90b`. After a merge, reset locally: `git checkout main && git reset --hard origin/main && git checkout -B claude/build-diffdoc-pr90b origin/main`. The remote branch state may be stale — force-push-with-lease is fine since the merged work is preserved on `main`.
- **PRs:** open as **draft**. The user has been subscribing to PR activity to autofix CI/review comments.
- **Bootstrap quirk:** the repo was empty when this session started (no `main`, no commits). I had to seed `main` with an empty initial-commit branch before the first PR could exist. Not relevant now — `main` is populated.
- **Vercel framework gotcha:** the Vercel project was created with framework=null. `vercel.json` pins it to `nextjs`. If you ever delete or change that file and builds start erroring with "No Output Directory named 'public' found", that's the cause.
- **pdf-parse version:** locked to `^1.1.1`. v2.x has a class-based API (`PDFParse`) that's incompatible with the v1 callback-style `pagerender`. Don't auto-bump.
- **Repo MCP scope:** GitHub MCP tools are restricted to `slapharma/DiffDoc` only. Don't try other repos.

## Commands

```bash
npm run dev          # Next.js dev server
npm run build        # production build (Vercel runs this)
npm run typecheck    # tsc --noEmit
npm test             # vitest run (9 tests, ~1s)
npm run lint         # next lint
```

All four must pass green before pushing.

## Phase 1 exit gate (from the build plan)

20 real-world DOCX/PDF files round-trip with ≥95% text fidelity. PR #2 passes 100% on a 10-phrase set against the build-plan docx. The 20-file test set will be built up as real customer files arrive — for now, add fixtures opportunistically when the user shares one.
