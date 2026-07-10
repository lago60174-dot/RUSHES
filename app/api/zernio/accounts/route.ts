import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { zernioListAccounts } from "@/lib/zernio";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Tous les comptes connectés à l'app (une seule clé API Zernio,
    // pas d'isolation par utilisateur). Filtré par ZERNIO_PROFILE_ID si
    // renseigné pour ne montrer que les comptes du bon profile Zernio.
    const accounts = await zernioListAccounts(process.env.ZERNIO_PROFILE_ID);
    return NextResponse.json(accounts);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
