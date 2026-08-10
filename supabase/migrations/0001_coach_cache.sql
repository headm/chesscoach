-- Shared cache of coaching notes.
--
-- One row per (prompt version, band, mode, position, request) — see
-- `coachCacheKey` in src/lib/server/coach/cache.ts for the key's shape. Rows
-- are immutable in practice: the key contains a hash of the prompt that
-- produced the note, so editing the prompt writes new keys rather than
-- changing existing ones.
--
-- Run against your project:
--   supabase db push
-- or paste into the SQL editor in the Supabase dashboard.

create table if not exists public.coach_cache (
	key text primary key,
	response jsonb not null,
	created_at timestamptz not null default now()
);

-- Supports the sweeps below. The primary key already covers lookups by key.
create index if not exists coach_cache_created_at_idx on public.coach_cache (created_at);

-- Row-level security on, and deliberately no policies.
--
-- With RLS enabled and no policy granting access, the anon and authenticated
-- roles can neither read nor write this table; service_role bypasses RLS and is
-- the only way in. In the dashboard's terms: a publishable key (sb_publishable_)
-- acts as anon and is locked out, a secret key (sb_secret_) acts as service_role
-- and is not. The app uses the latter, as SUPABASE_SECRET_KEY, from server-only
-- code. This matters more than it looks: a cache the public can write to is a
-- way to put words in the coach's mouth for every later player who reaches that
-- position.
alter table public.coach_cache enable row level security;

-- Housekeeping. Neither is automatic — run when it matters, or wire either one
-- into a pg_cron job.
--
-- After a prompt change, the old version's rows are dead weight; nothing will
-- ever ask for those keys again. Find the live prefixes in the app logs or by
-- grouping, then drop the rest:
--
--   delete from public.coach_cache
--   where key not like 'v<current-hash>:%';
--
-- Or simply age everything out:
--
--   delete from public.coach_cache
--   where created_at < now() - interval '90 days';
