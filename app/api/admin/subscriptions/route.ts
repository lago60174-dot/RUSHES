import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

function isAdmin(user: { user_metadata?: Record<string, unknown> } | null) {
  return user?.user_metadata?.role === "admin";
}

export async function GET(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter") || "active"; // active | expired | all

  const db = createSupabaseAdminClient();
  const now = new Date().toISOString();

  let query = db
    .from("subscriptions")
    .select("*")
    .order("created_at", { ascending: false });

  if (filter === "active") {
    query = query.eq("plan", "pro").or(`ends_at.is.null,ends_at.gt.${now}`);
  } else if (filter === "expired") {
    query = query.eq("plan", "pro").lt("ends_at", now).not("ends_at", "is", null);
  }

  const { data: subs, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = [...new Set((subs || []).map((s) => s.user_id))];
  const usersMap: Record<string, string> = {};
  for (const uid of userIds) {
    const { data } = await db.auth.admin.getUserById(uid);
    if (data?.user?.email) usersMap[uid] = data.user.email;
  }

  return NextResponse.json(
    (subs || []).map((s) => ({ ...s, userEmail: usersMap[s.user_id] || s.user_id }))
  );
}

// POST : créer un abonnement manuellement (offert, test, etc.)
export async function POST(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { userId, billingPeriod, endsAt } = body;

  if (!userId) return NextResponse.json({ error: "userId requis" }, { status: 400 });

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("subscriptions")
    .insert({
      user_id: userId,
      plan: "pro",
      billing_period: billingPeriod || null,
      starts_at: new Date().toISOString(),
      ends_at: endsAt || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
