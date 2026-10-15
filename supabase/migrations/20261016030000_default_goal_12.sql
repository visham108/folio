-- Every year's goal starts at 12 (per-year goals live in profiles.goals).
alter table public.profiles alter column yearly_goal set default 12;
