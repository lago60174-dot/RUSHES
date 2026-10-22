import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { zernioListAccounts } from "@/lib/zernio";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Tous les comptes de tous les profiles : un profile par compte
    // supplémentaire d'une même plateforme (règle Zernio : 1 compte par
    // plateforme et par profile).
    const accounts = await zernioListAccounts();
    return NextResponse.json(accounts);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
