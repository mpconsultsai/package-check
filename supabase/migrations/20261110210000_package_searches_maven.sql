-- Allow Maven coordinates in package_searches (app ecosystems include maven).
alter table public.package_searches
  drop constraint if exists package_searches_ecosystem_check;

alter table public.package_searches
  add constraint package_searches_ecosystem_check
  check (ecosystem in ('npm', 'pypi', 'nuget', 'maven'));
