-- ============================================================
-- RUSHES — Phase 12 : App privée (un seul utilisateur)
-- À exécuter dans l'éditeur SQL Supabase après phase11.sql
-- ============================================================
-- ⚠️ 1. REMPLACE 'ton@email.com' ci-dessous par TON email (même valeur que
--       la variable OWNER_EMAIL), AVANT d'exécuter.
-- ⚠️ 2. Crée d'abord ton compte (Authentication > Users > Add user), PUIS
--       exécute ce script : il bloque ensuite toute nouvelle inscription.

create or replace function public.block_non_owner_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.email) <> lower('ton@email.com') then
    raise exception 'Inscriptions fermées : application privée.';
  end if;
  return new;
end;
$$;

drop trigger if exists only_owner_can_signup on auth.users;
create trigger only_owner_can_signup
  before insert on auth.users
  for each row execute function public.block_non_owner_signup();
