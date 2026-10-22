import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sendReply, triageItem } from "@/lib/inbox";

// POST /api/inbox/:id  { action: "approve", text? } | { action: "ignore" } | { action: "regenerate" }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const db = createSupabaseAdminClient();

  const { data: item } = await db.from("inbox_items").select("id, reply_draft, status")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!item) return NextResponse.json({ error: "Introuvable." }, { status: 404 });

  if (body.action === "ignore") {
    await db.from("inbox_items").update({ status: "ignored" }).eq("id", id)
      .in("status", ["new", "pending_approval", "failed"]);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "approve") {
    const text = String(body.text ?? item.reply_draft ?? "").trim();
    if (!text) return NextResponse.json({ error: "Réponse vide." }, { status: 400 });
    const r = await sendReply(db, id, text, "replied");
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 502 });
  }

  if (body.action === "regenerate") {
    // Remet à "new" puis laisse l'agent produire un nouveau brouillon. La
    // régénération ne peut jamais déclencher d'envoi automatique (forceApproval).
    await db.from("inbox_items").update({ status: "new", reply_draft: null }).eq("id", id)
      .in("status", ["pending_approval", "failed"]);
    await triageItem(db, user.id, id, { forceApproval: true });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
}
