// Client Telegram Bot API minimal. Le token n'est lu que dans l'environnement
// (TELEGRAM_BOT_TOKEN) et n'apparaît jamais dans un message d'erreur.
const API = "https://api.telegram.org";

export const TG_DOWNLOAD_LIMIT = 20 * 1024 * 1024; // limite getFile de l'API publique

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET);
}
export function getOwnerChatId(): number | null {
  const v = Number(process.env.TELEGRAM_OWNER_ID);
  return Number.isFinite(v) && v !== 0 ? v : null;
}

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN manquant.");
  return t;
}

export async function tg<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${API}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(`Telegram ${method} : ${data?.description ?? res.status}`);
  }
  return data.result as T;
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type InlineKeyboard = Array<Array<{ text: string; callback_data?: string; url?: string }>>;

// Envoie un message (découpé si > 4096 caractères). Texte brut par défaut ;
// html=true pour le balisage <b>/<i> (le texte dynamique doit passer par escapeHtml).
export async function sendMessage(chatId: number, text: string, opts: { html?: boolean; keyboard?: InlineKeyboard } = {}) {
  const chunks: string[] = [];
  for (let i = 0; i < Math.max(text.length, 1); i += 4000) chunks.push(text.slice(i, i + 4000));
  let last: { message_id: number } | null = null;
  for (let i = 0; i < chunks.length; i++) {
    last = await tg<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text: chunks[i] || "…",
      ...(opts.html ? { parse_mode: "HTML" } : {}),
      disable_web_page_preview: true,
      ...(opts.keyboard && i === chunks.length - 1 ? { reply_markup: { inline_keyboard: opts.keyboard } } : {}),
    });
  }
  return last!;
}

export async function editMessage(chatId: number, messageId: number, text: string, opts: { html?: boolean; keyboard?: InlineKeyboard } = {}) {
  await tg("editMessageText", {
    chat_id: chatId, message_id: messageId, text: text.slice(0, 4000),
    ...(opts.html ? { parse_mode: "HTML" } : {}),
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: opts.keyboard ?? [] },
  }).catch(() => {});
}

export const answerCallback = (id: string, text?: string) =>
  tg("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) }).catch(() => {});
export const typing = (chatId: number) => tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});

// Télécharge un fichier envoyé au bot (≤ 20 Mo : limite imposée par Telegram).
export async function downloadFile(fileId: string): Promise<{ buffer: Buffer; path: string }> {
  const info = await tg<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!info.file_path) throw new Error("Telegram n'a pas fourni de chemin pour ce fichier.");
  const res = await fetch(`${API}/file/bot${token()}/${info.file_path}`);
  if (!res.ok) throw new Error(`Téléchargement Telegram impossible (${res.status}).`);
  return { buffer: Buffer.from(await res.arrayBuffer()), path: info.file_path };
}
