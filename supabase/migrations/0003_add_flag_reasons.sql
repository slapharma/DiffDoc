-- Local flagging heuristics (build plan Phase 2 item, runs without AI):
-- why a difference was flagged — numbers, dates, negations.
alter table public.differences
  add column flag_reasons text[];
