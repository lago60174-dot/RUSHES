import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

function isAdmin(user: { user_metadata?: Record<string, unknown> } | null) {
  return user?.user_metadata?.role === "admin";
}

export async function GET() {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = createSupabaseAdminClient();
  const now = new Date().toISOString();

  // Abonnés actifs (pro non expiré)
  const { data: activeSubs } = await db
    .from("subscriptions")
    .select("id, user_id, billing_period, starts_at, ends_at")
    .eq("plan", "pro")
    .or(`ends_at.is.null,ends_at.gt.${now}`);

  // Demandes en attente
  const { data: pendingRequests } = await db
    .from("payment_requests")
    .select("id")
    .eq("status", "pending");

  // Toutes les demandes approuvées pour le calcul du revenu
  const { data: approved } = await db
    .from("payment_requests")
    .select("amount, billing_period, created_at")
    .eq("status", "approved");

  // Calcul revenus
  const totalRevenue = (approved || []).reduce((sum, r) => sum + (r.amount || 0), 0);

  const now30 = new Date();
  now30.setDate(now30.getDate() - 30);
  const revenueThisMonth = (approved || [])
    .filter((r) => new Date(r.created_at) >= now30)
    .reduce((sum, r) => sum + (r.amount || 0), 0);

  const monthlyCount = (activeSubs || []).filter(
    (s) => s.billing_period === "monthly"
  ).length;
  const annualCount = (activeSubs || []).filter(
    (s) => s.billing_period === "annual"
  ).length;

  // Abonnements qui expirent dans les 7 prochains jours
  const in7Days = new Date();
  in7Days.setDate(in7Days.getDate() + 7);
  const expiringSoon = (activeSubs || []).filter(
    (s) => s.ends_at && new Date(s.ends_at) <= in7Days
  ).length;

  // Nombre total de comptes utilisateurs
  const { count: totalUsers } = await db
    .from("subscriptions")
    .select("user_id", { count: "exact", head: true });

  return NextResponse.json({
    activeSubscribers: (activeSubs || []).length,
    pendingRequests: (pendingRequests || []).length,
    totalRevenue,
    revenueThisMonth,
    monthlySubscribers: monthlyCount,
    annualSubscribers: annualCount,
    expiringSoon,
    totalUsers: totalUsers ?? 0,
  });
}
