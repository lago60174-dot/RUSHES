import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { computeEndsAt } from "@/lib/plans";

function isAdmin(user: { user_metadata?: Record<string, unknown> } | null) {
  return user?.user_metadata?.role === "admin";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { action, adminNotes } = body; // action: "approve" | "reject"

  if (!["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Action invalide" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();

  // Récupérer la demande
  const { data: req, error: fetchErr } = await db
    .from("payment_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !req) {
    return NextResponse.json({ error: "Demande introuvable" }, { status: 404 });
  }
  if (req.status !== "pending") {
    return NextResponse.json({ error: "Demande déjà traitée" }, { status: 409 });
  }

  // Mettre à jour le statut de la demande
  const { error: updateErr } = await db
    .from("payment_requests")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      admin_notes: adminNotes || null,
    })
    .eq("id", id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Si approuvé → créer/renouveler l'abonnement
  if (action === "approve") {
    const billingPeriod = req.billing_period as "monthly" | "annual";
    const endsAt = computeEndsAt(billingPeriod);

    const { error: subErr } = await db.from("subscriptions").insert({
      user_id: req.user_id,
      plan: "pro",
      billing_period: billingPeriod,
      starts_at: new Date().toISOString(),
      ends_at: endsAt.toISOString(),
    });

    if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, action });
}
