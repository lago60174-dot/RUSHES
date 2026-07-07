import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { zernioGetConnectUrl } from "@/lib/zernio";
import { getOrCreateZernioProfileId } from "@/lib/zernio-profile";

export async function GET(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  if (!platform) return NextResponse.json({ error: "Missing platform" }, { status: 400 });

  try {
    // Provisionne automatiquement le profil Zernio de l'utilisateur s'il
    // n'en a pas encore — plus besoin de passer par le dashboard Zernio.
    const profileId = await getOrCreateZernioProfileId(user.id, user.email);
    const redirectUrl = new URL(request.url).origin + "/?zernio=connected";
    const authUrl = await zernioGetConnectUrl(platform, profileId, redirectUrl);
    return NextResponse.json({ authUrl });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
