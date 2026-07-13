import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint as string | undefined;
  const p256dh = body?.keys?.p256dh as string | undefined;
  const authKey = body?.keys?.auth as string | undefined;

  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ error: "Abonnement push invalide (endpoint/keys manquants)." }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  const { error } = await db.from("push_subscriptions").upsert(
    { user_id: user.id, endpoint, p256dh, auth: authKey },
    { onConflict: "endpoint" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint as string | undefined;
  if (!endpoint) return NextResponse.json({ error: "endpoint manquant" }, { status: 400 });

  const db = createSupabaseAdminClient();
  await db.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", endpoint);

  return NextResponse.json({ ok: true });
}
