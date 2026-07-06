-- ============================================================
-- RUSHES — Phase 7 : Nettoyage pipeline de découpage vidéo (abandonné)
-- À exécuter dans l'éditeur SQL Supabase après phase6.sql
--
-- Cette fonctionnalité (clip_jobs + buckets "videos"/"clips") n'est
-- utilisée par aucun code actuel — RUSHES fonctionne désormais en
-- mode "lien externe uniquement" (pas d'upload/stockage de vidéos).
-- ============================================================

-- ── 1. Supprimer les policies storage sur le bucket "videos" ───
drop policy if exists "videos_owner_upload" on storage.objects;
drop policy if exists "videos_owner_read" on storage.objects;
drop policy if exists "videos_owner_delete" on storage.objects;

-- ── 2. Supprimer les policies storage sur le bucket "clips" ────
drop policy if exists "clips_owner_read" on storage.objects;
drop policy if exists "clips_service_write" on storage.objects;

-- ── 3. Supprimer la table clip_jobs ──────────────────────────
drop table if exists public.clip_jobs;

-- ── 4. Supprimer les buckets Storage ─────────────────────────
-- ⚠️ À faire manuellement dans le dashboard Supabase :
-- Storage → bucket "videos" → Delete bucket
-- Storage → bucket "clips"  → Delete bucket
-- (Si des fichiers existent encore dedans, vérifie qu'ils ne sont plus
--  nécessaires — RUSHES ne les utilise plus depuis le passage en lien externe)
