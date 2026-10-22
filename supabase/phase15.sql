-- ============================================================
-- RUSHES — Phase 15 : Bot Telegram + agent
-- À exécuter dans l'éditeur SQL Supabase après phase14.sql
-- ============================================================

-- Message Telegram qui porte les boutons de validation d'un élément d'inbox
-- (permet de répondre en « reply » pour envoyer ta propre version).
alter table public.inbox_items add column if not exists tg_message_id bigint;

-- Mémoire de conversation de l'agent (texte uniquement, les derniers échanges).
create table if not exists public.agent_messages (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_agent_messages_user on public.agent_messages (user_id, id desc);

-- Telegram peut renvoyer le même update : on mémorise les ids traités.
create table if not exists public.telegram_updates (
  update_id  bigint primary key,
  created_at timestamptz not null default now()
);

-- Écritures côté serveur uniquement (service_role) : RLS activée, aucune policy.
alter table public.agent_messages   enable row level security;
alter table public.telegram_updates enable row level security;
