-- Original filenames are needed by the workspace UI; previously they only
-- existed inside the comparison_created audit event payload.
alter table public.comparisons
  add column doc_a_name text,
  add column doc_b_name text;
