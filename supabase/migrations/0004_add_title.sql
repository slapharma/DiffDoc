-- User-editable task title; null means the UI shows "Primary vs Comparator".
alter table public.comparisons
  add column title text;
