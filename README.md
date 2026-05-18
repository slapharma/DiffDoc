# DiffDoc

AI-powered document comparison. Upload two `.docx` or `.pdf` files; get an AI-selected view (side-by-side, aligned, or summary-first) plus an audit-ready export bundle.

## Status

Phase 0 — Next.js scaffold + UI mockup running. Backend, parsing, AI, and billing are not yet wired.

See the build plan for the five-phase roadmap.

## Local dev

```bash
npm install
npm run dev
```

App runs at http://localhost:3000.

## Scripts

- `npm run dev` — Next.js dev server
- `npm run build` — production build
- `npm run typecheck` — TypeScript check
- `npm run lint` — ESLint

## Stack (target)

- **Frontend / light API:** Next.js 14 App Router on Vercel
- **Worker:** Node.js on Railway (DOCX/PDF parsing, diff, PDF report gen)
- **Database / storage / auth:** Supabase
- **AI:** Anthropic API (Claude Sonnet 4.6) + Voyage AI embeddings
- **Billing:** Stripe
