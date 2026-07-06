-- ============================================================
-- RUSHES — Phase 6 : Pricing & Paiement Manuel
-- À exécuter dans l'éditeur SQL Supabase après phase5.sql
-- ============================================================

-- ── 1. Table subscriptions ──────────────────────────────────
create table if not exists public.subscriptions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete cascade not null,
  plan           text not null default 'free' check (plan in ('free', 'pro')),
  billing_period text check (billing_period in ('monthly', 'annual', 'custom')),
  starts_at      timestamptz not null default now(),
  ends_at        timestamptz,           -- null = pas d'expiration (offert manuellement)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;

-- L'utilisateur peut voir ses propres abonnements, l'admin voit tout (via service_role)
drop policy if exists "subscriptions_owner_select" on public.subscriptions;
create policy "subscriptions_owner_select" on public.subscriptions
  for select using (auth.uid() = user_id);

-- ── 2. Table payment_requests ───────────────────────────────
create table if not exists public.payment_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete cascade not null,
  -- Infos plan demandé
  plan           text not null default 'pro' check (plan in ('pro')),
  billing_period text not null check (billing_period in ('monthly', 'annual')),
  amount         integer not null,      -- montant en FCFA
  -- Paiement
  method         text not null check (method in ('mtn', 'orange')),
  reference      text,                  -- référence de transaction (optionnel)
  proof_url      text,                  -- URL screenshot preuve (optionnel)
  -- Traitement admin
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_notes    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger payment_requests_updated_at
  before update on public.payment_requests
  for each row execute function public.set_updated_at();

alter table public.payment_requests enable row level security;

drop policy if exists "payment_requests_owner_select" on public.payment_requests;
create policy "payment_requests_owner_select" on public.payment_requests
  for select using (auth.uid() = user_id);

drop policy if exists "payment_requests_owner_insert" on public.payment_requests;
create policy "payment_requests_owner_insert" on public.payment_requests
  for insert with check (auth.uid() = user_id);

-- ── 3. Bucket payment-proofs (privé) ────────────────────────
-- À exécuter manuellement dans Supabase Storage si le bucket n'existe pas encore :
-- insert into storage.buckets (id, name, public) values ('payment-proofs', 'payment-proofs', false);

-- Policies storage payment-proofs
drop policy if exists "proof_owner_upload" on storage.objects;
create policy "proof_owner_upload" on storage.objects
  for insert with check (
    bucket_id = 'payment-proofs'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "proof_owner_read" on storage.objects;
create policy "proof_owner_read" on storage.objects
  for select using (
    bucket_id = 'payment-proofs'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ── 4. Fonctions helpers ─────────────────────────────────────

-- Retourne le plan actif d'un utilisateur (free si aucun abonnement actif)
create or replace function public.get_user_plan(p_user_id uuid)
returns text language sql stable security definer as $$
  select coalesce(
    (
      select plan from public.subscriptions
      where user_id = p_user_id
        and plan = 'pro'
        and (ends_at is null or ends_at > now())
      order by ends_at desc nulls first
      limit 1
    ),
    'free'
  );
$$;

-- Compte les publications du mois courant pour un utilisateur
create or replace function public.count_monthly_publications(p_user_id uuid)
returns integer language sql stable security definer as $$
  select count(*)::integer
  from public.videos
  where user_id = p_user_id
    and status = 'published'
    and published_date >= to_char(date_trunc('month', now()), 'YYYY-MM-DD');
$$;

-- ── 5. Donner le rôle admin à un utilisateur ────────────────
-- Pour promouvoir un utilisateur en admin, exécuter ceci dans SQL avec son UUID :
--
-- update auth.users
--   set raw_user_meta_data = raw_user_meta_data || '{"role": "admin"}'::jsonb
--   where id = '<UUID_DU_COMPTE_ADMIN>';
--
-- Ou via le dashboard Supabase : Authentication → Users → Edit → user_metadata → { "role": "admin" }

-- ── 6. Index de performance ──────────────────────────────────
create index if not exists idx_subscriptions_user_active
  on public.subscriptions (user_id, ends_at)
  where plan = 'pro';

create index if not exists idx_payment_requests_status
  on public.payment_requests (status, created_at desc);

create index if not exists idx_payment_requests_user
  on public.payment_requests (user_id, created_at desc);
