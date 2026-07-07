-- ============================================================
-- RUSHES — Phase 9 : Plan Business
-- À exécuter dans l'éditeur SQL Supabase après phase8.sql
-- Ajoute le palier "business" en plus de "free" / "pro".
-- ============================================================

-- ── 1. subscriptions.plan : autoriser 'business' ────────────
alter table public.subscriptions
  drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions
  add constraint subscriptions_plan_check check (plan in ('free', 'pro', 'business'));

-- ── 2. payment_requests.plan : autoriser 'business' ─────────
alter table public.payment_requests
  drop constraint if exists payment_requests_plan_check;
alter table public.payment_requests
  add constraint payment_requests_plan_check check (plan in ('pro', 'business'));

-- ── 3. get_user_plan() : reconnaître aussi 'business' ───────
create or replace function public.get_user_plan(p_user_id uuid)
returns text language sql stable security definer as $$
  select coalesce(
    (
      select plan from public.subscriptions
      where user_id = p_user_id
        and plan in ('pro', 'business')
        and (ends_at is null or ends_at > now())
      order by ends_at desc nulls first
      limit 1
    ),
    'free'
  );
$$;

-- ── 4. Index : élargir le prédicat aux deux plans payants ───
drop index if exists idx_subscriptions_user_active;
create index if not exists idx_subscriptions_user_active
  on public.subscriptions (user_id, ends_at)
  where plan in ('pro', 'business');
