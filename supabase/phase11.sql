-- ============================================================
-- RUSHES — Phase 11 : Stockage Cloudflare R2
-- À exécuter dans l'éditeur SQL Supabase après phase10.sql
-- ============================================================

-- Registre des fichiers stockés (R2). Le fichier lui-même est dans R2 ;
-- ici on garde seulement la référence, pour pouvoir le retrouver, le
-- lier à une vidéo et le supprimer proprement.
create table if not exists public.media_assets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  storage       text not null default 'r2',
  object_key    text not null unique,
  public_url    text not null,
  filename      text,
  content_type  text,
  size_bytes    bigint,
  source        text not null default 'web' check (source in ('web', 'telegram')),
  video_id      text references public.videos(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_media_assets_user_id on public.media_assets (user_id, created_at desc);

alter table public.media_assets enable row level security;

drop policy if exists "media_assets_owner_policy" on public.media_assets;
create policy "media_assets_owner_policy" on public.media_assets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
