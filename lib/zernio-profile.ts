import { createSupabaseAdminClient } from "./supabase-admin";
import { zernioCreateProfile } from "./zernio";

// Récupère le zernioProfileId déjà enregistré pour cet utilisateur RUSHES,
// ou en crée un à la volée (lazy provisioning) s'il n'en a pas encore.
// C'est ce qui garantit l'isolation par utilisateur : chaque utilisateur
// RUSHES a son propre profil Zernio, donc ses propres comptes sociaux,
// même si toute l'app ne partage qu'une seule clé API Zernio.
export async function getOrCreateZernioProfileId(userId: string, email?: string | null): Promise<string> {
  const db = createSupabaseAdminClient();

  const { data: settingsRow } = await db
    .from("settings")
    .select("data")
    .eq("user_id", userId)
    .single();

  const existing = settingsRow?.data?.zernioProfileId as string | undefined;
  if (existing) return existing;

  // Pas encore de profil : on en crée un côté Zernio...
  const profile = await zernioCreateProfile(
    `RUSHES - ${email || userId}`,
    "Profil créé automatiquement par RUSHES"
  );

  // ...puis on l'enregistre dans settings, en fusionnant avec les données
  // existantes (le POST /api/settings remplace tout le blob, donc on ne
  // peut pas juste upsert un champ isolé sans écraser le reste).
  const mergedData = { ...(settingsRow?.data || {}), zernioProfileId: profile._id };
  await db.from("settings").upsert({
    user_id: userId,
    data: mergedData,
    updated_at: new Date().toISOString(),
  });

  return profile._id;
}
