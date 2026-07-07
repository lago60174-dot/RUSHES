import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET() {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createSupabaseAdminClient();

  // Abonnement actif (pro ou business, non expiré)
  const { data: sub } = await db
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .in("plan", ["pro", "business"])
    .or("ends_at.is.null,ends_at.gt." + new Date().toISOString())
    .order("ends_at", { ascending: false, nullsFirst: true })
    .limit(1)
    .single();

  // Nombre de publications ce mois-ci
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count: pubCount } = await db
    .from("videos")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "published")
    .gte("published_date", startOfMonth.toISOString().slice(0, 10));

  const plan = (sub?.plan as "pro" | "business" | undefined) || "free";

  return NextResponse.json({
    plan,
    subscription: sub
      ? {
          id: sub.id,
          plan: sub.plan,
          billingPeriod: sub.billing_period,
          startsAt: sub.starts_at,
          endsAt: sub.ends_at,
        }
      : null,
    usage: {
      publicationsThisMonth: pubCount ?? 0,
      publicationsLimit: plan === "free" ? 5 : null, // null = illimité
    },
  });
}
