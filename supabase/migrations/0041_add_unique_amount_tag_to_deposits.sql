-- Add unique_amount_tag to deposits table
alter table public.deposits
  add column if not exists unique_amount_tag text;

-- Create unique constraint/index on unique_amount_tag
create unique index if not exists deposits_unique_amount_tag_idx
  on public.deposits (unique_amount_tag)
  where unique_amount_tag is not null;
