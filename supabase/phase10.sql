-- ============================================================
-- RUSHES — Phase 10 : Notifications push
-- À exécuter dans l'éditeur SQL Supabase après phase9.sql
-- ============================================================

-- Abonnements aux notifications push (Web Push API). Un utilisateur peut
-- avoir plusieurs abonnements (un par navigateur/appareil sur lequel il a
-- cliqué "Activer les notifications").
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_owner_policy" on public.push_subscriptions;
create policy "push_subscriptions_owner_policy" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Dernier palier d'abonnés (par tranche de 100) déjà notifié, par compte
-- Zernio connecté — évite d'envoyer plusieurs fois la même notification de
-- palier franchi. Table interne, jamais lue/écrite par le client (accès
-- service_role uniquement via le cron), donc RLS activée sans policy.
create table if not exists public.account_milestones (
  account_id             text primary key,
  last_follower_milestone integer not null default 0,
  updated_at             timestamptz not null default now()
);

alter table public.account_milestones enable row level security;
