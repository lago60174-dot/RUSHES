import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { tg, isTelegramConfigured } from "@/lib/telegram";

// À ouvrir UNE fois dans ton navigateur, connecté à l'app : enregistre le
// webhook chez Telegram (avec le secret) et les commandes du bot.
// GET /api/telegram/setup  → installe ; renvoie aussi l'état actuel du webhook.
export async function GET(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: "Définis TELEGRAM_BOT_TOKEN et TELEGRAM_WEBHOOK_SECRET sur Vercel, puis redéploie." }, { status: 400 });
  }

  const base = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/, "");
  try {
    await tg("setWebhook", {
      url: `${base}/api/telegram/webhook`,
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });
    await tg("setMyCommands", { commands: [
      { command: "inbox", description: "Messages à valider" },
      { command: "sync", description: "Actualiser les stats" },
      { command: "aide", description: "Ce que je sais faire" },
    ] });
    const info = await tg<Record<string, unknown>>("getWebhookInfo");
    const me = await tg<{ username: string }>("getMe");
    return NextResponse.json({
      ok: true, bot: `@${me.username}`, webhook: info.url, pending_updates: info.pending_update_count,
      derniere_erreur: info.last_error_message ?? null,
      etape_suivante: process.env.TELEGRAM_OWNER_ID ? "Écris-lui /start dans Telegram." : "Écris n'importe quoi au bot : il te donnera ton ID Telegram à mettre dans TELEGRAM_OWNER_ID.",
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
