-- A reading goal per year ({"2020": 30, "2026": 24}); a year without one has no goal.
alter table public.profiles
  add column goals jsonb not null default '{}'::jsonb,
  add constraint profiles_goals_shape check (jsonb_typeof(goals) = 'object' and length(goals::text) <= 4000);
