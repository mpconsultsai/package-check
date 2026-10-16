-- Anonymous package searches. Mirrors packageSearches in lib/db/schema.ts.
create table if not exists public.package_searches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ecosystem text not null check (ecosystem in ('npm', 'pypi', 'nuget')),
  query text not null,
  query_normalized text generated always as (lower(btrim(query))) stored,
  result_count integer not null default 0,
  result_names text[] not null default '{}',
  source text not null default 'web' check (source in ('web', 'mcp', 'api')),
  metadata jsonb not null default '{}'
);

create index if not exists package_searches_ecosystem_created_at_idx
  on public.package_searches (ecosystem, created_at desc);

create index if not exists package_searches_ecosystem_query_created_at_idx
  on public.package_searches (ecosystem, query_normalized, created_at desc);

-- The app connects as the postgres role, which bypasses RLS. With no policies,
-- the anon and authenticated roles cannot read or write through the Data API.
alter table public.package_searches enable row level security;
