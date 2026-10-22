import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { zernioDeleteAccount, zernioListAccounts } from "@/lib/zernio";

// Déconnecte un compte social. Si des publications planifiées le ciblent
// encore, on répond 409 avec leur nombre : l'appelant doit rappeler avec
// ?force=1 après confirmation de l'utilisateur.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { accountId } = await params;
  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    // Le compte doit exister dans la liste Zernio de cette clé API.
    const accounts = await zernioListAccounts();
    if (!accounts.some((a) => a._id === accountId)) {
      return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
    }

    const db = createSupabaseAdminClient();
    const [byTargets, byLegacy] = await Promise.all([
      db.from("videos").select("id")
        .eq("user_id", user.id).eq("status", "planned")
        .contains("zernio_targets", [{ accountId }]),
      db.from("videos").select("id")
        .eq("user_id", user.id).eq("status", "planned")
        .eq("zernio_account_id", accountId),
    ]);
    const affected = new Set([...(byTargets.data ?? []), ...(byLegacy.data ?? [])].map((v) => v.id as string));

    if (affected.size > 0 && !force) {
      return NextResponse.json(
        { error: "Des publications planifiées ciblent ce compte.", plannedCount: affected.size },
        { status: 409 }
      );
    }

    await zernioDeleteAccount(accountId);
    return NextResponse.json({ ok: true, plannedCount: affected.size });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
