-- ============================================================
-- RUSHES — Phase 8 : Webhooks Zernio + statut d'échec
-- À exécuter dans l'éditeur SQL Supabase après phase7.sql
--
-- Objectif : savoir enfin si une publication programmée a
-- réellement été publiée, a échoué, ou est encore en attente,
-- sans avoir à vérifier manuellement sur chaque réseau social.
-- ============================================================

-- 1. Autoriser un nouveau statut "failed" (échec de publication)
alter table public.videos
  drop constraint if exists videos_status_check;

alter table public.videos
  add constraint videos_status_check
  check (status in ('planned', 'published', 'failed'));

-- 2. Colonnes pour stocker le détail de l'erreur renvoyée par Zernio
alter table public.videos
  add column if not exists zernio_error          text,
  add column if not exists zernio_error_category text,
  add column if not exists zernio_platform_status jsonb not null default '[]'::jsonb;

-- 3. Index utilisé par le webhook pour retrouver la vidéo via son post Zernio
create index if not exists idx_videos_zernio_post_id
  on public.videos (zernio_post_id)
  where zernio_post_id is not null;
