import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { zernioGetConnectUrl } from "@/lib/zernio";

export async function GET(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  if (!platform) return NextResponse.json({ error: "Missing platform" }, { status: 400 });

  // ⚠️ CORRIGÉ (10/07) : on envoyait ici l'URL de callback RUSHES à la place
  // du profileId Zernio (bug historique — voir le commentaire détaillé dans
  // lib/zernio.ts sur zernioGetConnectUrl). Résultat : chaque compte connecté
  // depuis RUSHES atterrissait sur le mauvais profile côté Zernio (souvent le
  // profile "Default"), ce qui casse ensuite les stats/analytics, elles bien
  // scopées par profile. Renseigne ZERNIO_PROFILE_ID dans les variables
  // d'environnement Vercel avec l'ID du profile Zernio où tes comptes sont
  // censés vivre (visible dans le dashboard Zernio, ou via GET /v1/profiles).
  const profileId = process.env.ZERNIO_PROFILE_ID;
  if (!profileId) {
    return NextResponse.json(
      { error: "ZERNIO_PROFILE_ID n'est pas configuré côté serveur. Ajoute cette variable d'environnement (voir le dashboard Zernio > Profiles) avant de connecter un compte." },
      { status: 500 }
    );
  }

  try {
    const redirectUrl = new URL(request.url).origin + "/?zernio=connected";
    const authUrl = await zernioGetConnectUrl(platform, profileId, redirectUrl);
    return NextResponse.json({ authUrl });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
