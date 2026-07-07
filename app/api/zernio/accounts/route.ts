import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { zernioListAccounts } from "@/lib/zernio";
import { getOrCreateZernioProfileId } from "@/lib/zernio-profile";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Scopé au profil Zernio de cet utilisateur : chacun ne voit que ses
    // propres comptes sociaux, jamais ceux des autres utilisateurs RUSHES.
    const profileId = await getOrCreateZernioProfileId(user.id, user.email);
    const accounts = await zernioListAccounts(profileId);
    return NextResponse.json(accounts);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
