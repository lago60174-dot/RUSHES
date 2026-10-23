import { NextResponse, after } from "next/server";
import { timingSafeEqual } from "crypto";
import { handleUpdate, type TgUpdate } from "@/lib/telegram-bot";

// Le téléchargement d'une vidéo, la transcription d'un vocal ou l'extraction
// d'images prennent du temps : on laisse jusqu'à 60 s à la fonction.
export const maxDuration = 60;

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(request: Request) {
  // 1. Seul Telegram, muni du secret défini à l'installation, peut appeler cette route.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const given = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || !safeEqual(given, secret)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const update = (await request.json().catch(() => null)) as TgUpdate | null;
  if (!update) return NextResponse.json({ ok: true });

  // 2. On répond 200 tout de suite ; le traitement continue après (handleUpdate gère ses erreurs).
  after(() => handleUpdate(update));
  return NextResponse.json({ ok: true });
}
