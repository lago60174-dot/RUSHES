-- ============================================================
-- RUSHES — Phase 13 : Données Zernio stockées en base
-- À exécuter dans l'éditeur SQL Supabase après phase12.sql
-- ============================================================
-- Pourquoi : jusqu'ici RUSHES ne gardait que des totaux sur `videos`, écrasés
-- à chaque synchro, et aucune donnée par compte. Ces tables conservent :
--   • les comptes connectés + leur santé (token, permissions)
--   • l'historique quotidien des abonnés de chaque compte
--   • les stats de chaque vidéo PAR COMPTE (2 TikTok = 2 lignes) + historique
-- Les écritures se font côté serveur (service_role, qui contourne la RLS) ;
-- le navigateur n'a qu'un droit de lecture sur ses propres lignes.

-- ── 1. Comptes sociaux ──────────────────────────────────────
create table if not exists public.zernio_accounts (
  account_id          text primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  platform            text not null,
  username            text,
  display_name        text,
  picture_url         text,
  profile_id          text,
  followers           integer,
  status              text not null default 'healthy',  -- healthy | warning | error | disconnected
  can_post            boolean,
  can_fetch_analytics boolean,
  token_valid         boolean,
  token_expires_at    timestamptz,
  needs_reconnect     boolean not null default false,
  issues              jsonb not null default '[]'::jsonb,
  is_connected        boolean not null default true,
  connected_at        timestamptz not null default now(),
  disconnected_at     timestamptz,
  last_synced_at      timestamptz,
  raw                 jsonb
);
create index if not exists idx_zernio_accounts_user on public.zernio_accounts (user_id, platform);

-- ── 2. Historique des compteurs de compte (1 ligne / compte / jour) ──
create table if not exists public.account_snapshots (
  id               bigint generated always as identity primary key,
  account_id       text not null references public.zernio_accounts(account_id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  snap_date        date not null,
  captured_at      timestamptz not null default now(),
  followers        integer,
  following        integer,
  likes            bigint,
  videos           integer,
  page_views       bigint,
  followers_gained integer,
  followers_lost   integer,
  raw              jsonb,
  unique (account_id, snap_date)
);
create index if not exists idx_account_snapshots_account on public.account_snapshots (account_id, snap_date desc);

-- ── 3. Stats d'une vidéo PAR COMPTE cible ───────────────────
create table if not exists public.post_targets (
  video_id          text not null references public.videos(id) on delete cascade,
  account_id        text not null,
  user_id           uuid not null references auth.users(id) on delete cascade,
  zernio_post_id    text,
  platform          text not null,
  platform_post_url text,
  thumbnail_url     text,
  views             bigint not null default 0,
  impressions       bigint not null default 0,
  reach             bigint not null default 0,
  likes             bigint not null default 0,
  comments          bigint not null default 0,
  shares            bigint not null default 0,
  saves             bigint not null default 0,
  clicks            bigint not null default 0,
  avg_watch_time    numeric not null default 0,
  raw               jsonb,                       -- réponse Zernio complète, rien n'est perdu
  first_synced_at   timestamptz not null default now(),
  last_synced_at    timestamptz not null default now(),
  primary key (video_id, account_id)
);
create index if not exists idx_post_targets_user on public.post_targets (user_id);

-- ── 4. Historique des stats par vidéo et par compte ─────────
-- Une ligne n'est ajoutée que si une métrique a changé depuis la précédente.
create table if not exists public.post_target_history (
  id          bigint generated always as identity primary key,
  video_id    text not null references public.videos(id) on delete cascade,
  account_id  text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  captured_at timestamptz not null default now(),
  views       bigint not null default 0,
  impressions bigint not null default 0,
  reach       bigint not null default 0,
  likes       bigint not null default 0,
  comments    bigint not null default 0,
  shares      bigint not null default 0,
  saves       bigint not null default 0
);
create index if not exists idx_post_target_history on public.post_target_history (video_id, account_id, captured_at desc);

-- ── RLS : lecture seule pour le propriétaire ────────────────
alter table public.zernio_accounts      enable row level security;
alter table public.account_snapshots    enable row level security;
alter table public.post_targets         enable row level security;
alter table public.post_target_history  enable row level security;

drop policy if exists "zernio_accounts_owner_read" on public.zernio_accounts;
create policy "zernio_accounts_owner_read" on public.zernio_accounts
  for select using (auth.uid() = user_id);

drop policy if exists "account_snapshots_owner_read" on public.account_snapshots;
create policy "account_snapshots_owner_read" on public.account_snapshots
  for select using (auth.uid() = user_id);

drop policy if exists "post_targets_owner_read" on public.post_targets;
create policy "post_targets_owner_read" on public.post_targets
  for select using (auth.uid() = user_id);

drop policy if exists "post_target_history_owner_read" on public.post_target_history;
create policy "post_target_history_owner_read" on public.post_target_history
  for select using (auth.uid() = user_id);
