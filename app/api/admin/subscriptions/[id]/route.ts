import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { computeEndsAt } from "@/lib/plans";

function isAdmin(user: { user_metadata?: Record<string, unknown> } | null) {
  return user?.user_metadata?.role === "admin";
}

// PATCH : renouveler ou modifier la date de fin
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
  const { action, endsAt, billingPeriod } = body;
  // action: "renew" | "set_date" | "make_unlimited"

  const db = createSupabaseAdminClient();

  const { data: sub } = await db
    .from("subscriptions")
    .select("*")
    .eq("id", id)
    .single();

  if (!sub) return NextResponse.json({ error: "Abonnement introuvable" }, { status: 404 });

  let newEndsAt: string | null = sub.ends_at;

  if (action === "renew") {
    // Renouveler depuis la date de fin actuelle (ou aujourd'hui si expiré)
    const base = sub.ends_at && new Date(sub.ends_at) > new Date()
      ? new Date(sub.ends_at)
      : new Date();
    const period = (billingPeriod || sub.billing_period || "monthly") as "monthly" | "annual";
    newEndsAt = computeEndsAt(period, base).toISOString();
  } else if (action === "set_date") {
    newEndsAt = endsAt || null;
  } else if (action === "make_unlimited") {
    newEndsAt = null;
  }

  const { error } = await db
    .from("subscriptions")
    .update({ ends_at: newEndsAt, billing_period: billingPeriod || sub.billing_period })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, endsAt: newEndsAt });
}

// DELETE : supprimer un abonnement (retour immédiat au plan free)
export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = createSupabaseAdminClient();
  const { error } = await db.from("subscriptions").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
