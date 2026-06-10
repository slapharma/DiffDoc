-- DiffDoc core schema (Phase 1, step 1)
-- 8 core tables from the build plan data model + a private storage bucket.
--
-- Auth note: `public.users` mirrors `auth.users` and is populated by a trigger
-- once Supabase Auth lands (Phase 5). Until then, `comparisons.user_id` is
-- nullable so anonymous Phase-1 uploads work. Phase 1 access is server-side via
-- the service-role key, which bypasses RLS — RLS is enabled with no policies so
-- the tables are locked to anon/authenticated clients until policies arrive.

create extension if not exists pgcrypto;

-- ── Enums ────────────────────────────────────────────────────────────────────
create type user_tier            as enum ('free', 'pro', 'team');
create type comparison_status    as enum ('pending', 'processing', 'complete', 'failed');
create type view_mode            as enum ('side_by_side', 'aligned_sections', 'summary_first');
create type diff_op              as enum ('equal', 'insert', 'delete');          -- mirrors lib/diff DiffOp
create type diff_classification  as enum ('cosmetic', 'minor', 'substantive', 'structural');
create type doc_side             as enum ('a', 'b');

-- ── users ─────────────────────────────────────────────────────────────────────
create table public.users (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null,
  stripe_customer_id text unique,
  tier               user_tier not null default 'free',
  created_at         timestamptz not null default now()
);

-- ── comparisons ───────────────────────────────────────────────────────────────
create table public.comparisons (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references public.users (id) on delete set null,
  doc_a_path       text,                       -- storage object path; set on upload
  doc_a_hash       text,                       -- SHA-256 hex
  doc_b_path       text,
  doc_b_hash       text,
  similarity_score numeric(5,2),               -- 0..100, set by the AI layer (Phase 2)
  view_mode        view_mode,                  -- auto-selected from similarity_score
  status           comparison_status not null default 'pending',
  created_at       timestamptz not null default now()
);
create index comparisons_user_id_idx on public.comparisons (user_id);
create index comparisons_status_idx  on public.comparisons (status);

-- ── differences ───────────────────────────────────────────────────────────────
create table public.differences (
  id             uuid primary key default gen_random_uuid(),
  comparison_id  uuid not null references public.comparisons (id) on delete cascade,
  location_a     jsonb,                        -- { offset, length } into doc A plain text
  location_b     jsonb,
  type           diff_op not null,
  classification diff_classification,          -- AI-assigned (Phase 2)
  ai_summary     text,
  flagged        boolean not null default false,
  severity       smallint,                     -- flag severity scale; defined in Phase 2
  created_at     timestamptz not null default now()
);
create index differences_comparison_id_idx on public.differences (comparison_id);
create index differences_flagged_idx        on public.differences (comparison_id) where flagged;

-- ── comments ──────────────────────────────────────────────────────────────────
create table public.comments (
  id            uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons (id) on delete cascade,
  difference_id uuid references public.differences (id) on delete set null,
  doc_side      doc_side not null,
  location      jsonb,
  text          text not null,
  author_id     uuid references public.users (id) on delete set null,
  resolved      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index comments_comparison_id_idx on public.comments (comparison_id);
create index comments_difference_id_idx on public.comments (difference_id);

-- ── edits ─────────────────────────────────────────────────────────────────────
create table public.edits (
  id            uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons (id) on delete cascade,
  doc_side      doc_side not null,
  before_text   text,
  after_text    text,
  location      jsonb,
  created_at    timestamptz not null default now()
);
create index edits_comparison_id_idx on public.edits (comparison_id);

-- ── audit_events (source of truth for the audit report's actions log) ──────────
create table public.audit_events (
  id            uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons (id) on delete cascade,
  event_type    text not null,
  payload_jsonb jsonb,
  created_at    timestamptz not null default now()
);
create index audit_events_comparison_id_idx on public.audit_events (comparison_id, created_at);

-- ── exports ───────────────────────────────────────────────────────────────────
create table public.exports (
  id            uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons (id) on delete cascade,
  bundle_path   text,
  bundle_hash   text,
  created_at    timestamptz not null default now()
);
create index exports_comparison_id_idx on public.exports (comparison_id);

-- ── usage_metrics ─────────────────────────────────────────────────────────────
create table public.usage_metrics (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,
  period_start      date not null,
  comparisons_count integer not null default 0,
  pages_processed   integer not null default 0,
  tokens_consumed   bigint  not null default 0,
  unique (user_id, period_start)
);

-- ── RLS: enabled, no policies yet (server-side service-role access only) ───────
alter table public.users         enable row level security;
alter table public.comparisons   enable row level security;
alter table public.differences   enable row level security;
alter table public.comments      enable row level security;
alter table public.edits         enable row level security;
alter table public.audit_events  enable row level security;
alter table public.exports       enable row level security;
alter table public.usage_metrics enable row level security;

-- ── Storage: one private bucket for originals + export bundles ─────────────────
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
