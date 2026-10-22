-- ============================================================
-- RUSHES — Phase 14 : Inbox (commentaires + DMs) et agent de réponse
-- À exécuter dans l'éditeur SQL Supabase après phase13.sql
-- ============================================================
-- Une table unifiée pour les commentaires et les DMs reçus (et les DMs
-- envoyés, pour garder le contexte d'une conversation).
-- status :
--   new               reçu, pas encore traité
--   sending           réponse en cours d'envoi (verrou anti double-envoi)
--   auto_replied      l'agent a répondu seul (cas simple)
--   pending_approval  brouillon prêt, attend ta validation
--   replied           tu as validé / envoyé une réponse
--   ignored           spam, message sortant, ou écarté par toi
--   failed            l'envoi a échoué (voir `error`)

create table if not exists public.inbox_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  kind             text not null check (kind in ('comment', 'dm')),
  direction        text not null default 'incoming' check (direction in ('incoming', 'outgoing')),
  account_id       text not null,
  platform         text not null,
  external_id      text not null,            -- id du commentaire ou du message (plateforme/Zernio)
  conversation_id  text,                     -- DMs : id de conversation Zernio
  post_id          text,                     -- commentaires : id du post (Zernio, sinon plateforme)
  platform_post_id text,
  video_id         text references public.videos(id) on delete set null,
  parent_external_id text,                   -- commentaire parent si c'est une réponse
  author_id        text,
  author_name      text,
  author_username  text,
  text             text not null default '',
  received_at      timestamptz not null default now(),
  status           text not null default 'new'
                   check (status in ('new','sending','auto_replied','pending_approval','replied','ignored','failed')),
  category         text,                     -- simple | sensitive | ignore (décision de l'agent)
  confidence       numeric,
  reply_draft      text,
  reply_text       text,
  reason           text,                     -- pourquoi l'agent a décidé ainsi
  replied_at       timestamptz,
  error            text,
  raw              jsonb,
  created_at       timestamptz not null default now(),
  unique (account_id, external_id)
);

create index if not exists idx_inbox_user_status on public.inbox_items (user_id, status, received_at desc);
create index if not exists idx_inbox_conversation on public.inbox_items (conversation_id, received_at desc);
create index if not exists idx_inbox_video on public.inbox_items (video_id);

alter table public.inbox_items enable row level security;

drop policy if exists "inbox_items_owner_read" on public.inbox_items;
create policy "inbox_items_owner_read" on public.inbox_items
  for select using (auth.uid() = user_id);
