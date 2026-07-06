import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getPlanAmount, BILLING_MONTHLY, BILLING_ANNUAL } from "@/lib/plans";

export async function POST(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { billingPeriod, method, reference, proofUrl } = body;

  // Validation
  if (!["monthly", "annual"].includes(billingPeriod)) {
    return NextResponse.json({ error: "Période invalide" }, { status: 400 });
  }
  if (!["mtn", "orange"].includes(method)) {
    return NextResponse.json({ error: "Méthode de paiement invalide" }, { status: 400 });
  }
  if (!reference && !proofUrl) {
    return NextResponse.json(
      { error: "Fournis au moins une référence de transaction ou un screenshot de preuve" },
      { status: 400 }
    );
  }

  // Vérifier qu'il n'a pas déjà une demande en attente
  const db = createSupabaseAdminClient();
  const { data: existing } = await db
    .from("payment_requests")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .limit(1)
    .single();

  if (existing) {
    return NextResponse.json(
      { error: "Tu as déjà une demande en attente. Attends qu'elle soit traitée." },
      { status: 409 }
    );
  }

  const amount = getPlanAmount(billingPeriod === "annual" ? BILLING_ANNUAL : BILLING_MONTHLY);

  const { data, error } = await db
    .from("payment_requests")
    .insert({
      user_id: user.id,
      plan: "pro",
      billing_period: billingPeriod,
      amount,
      method,
      reference: reference || null,
      proof_url: proofUrl || null,
      status: "pending",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data.id, status: "pending" });
}

export async function GET() {
  // Retourne les demandes de l'utilisateur connecté
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("payment_requests")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return NextResponse.json(data || []);
}
