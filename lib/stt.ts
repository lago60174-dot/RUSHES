import { runFfmpeg, getFfmpegPath } from "@/lib/ffmpeg";

// Transcription des messages vocaux. Priorité à Mistral Voxtral (la clé
// MISTRAL_API_KEY est déjà utilisée par l'analyse), repli sur OpenAI.
// La langue est détectée automatiquement (français, anglais, mélange…).
export function isSttConfigured(): boolean {
  return Boolean(process.env.MISTRAL_API_KEY || process.env.OPENAI_API_KEY);
}

type Provider = { name: string; url: string; key: string; model: string };
function providers(): Provider[] {
  const list: Provider[] = [];
  if (process.env.MISTRAL_API_KEY) list.push({ name: "Mistral", url: "https://api.mistral.ai/v1/audio/transcriptions", key: process.env.MISTRAL_API_KEY, model: "voxtral-mini-latest" });
  if (process.env.OPENAI_API_KEY) list.push({ name: "OpenAI", url: "https://api.openai.com/v1/audio/transcriptions", key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_STT_MODEL || "whisper-1" });
  return list;
}

async function callProvider(p: Provider, audio: Buffer, filename: string, mime: string): Promise<string> {
  const form = new FormData();
  form.append("model", p.model);
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), filename);
  const res = await fetch(p.url, { method: "POST", headers: { Authorization: `Bearer ${p.key}` }, body: form });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 160);
    const e = new Error(`${p.name} ${res.status} ${detail}`) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  return String(data.text ?? "").trim();
}

// OGG/Opus (format des vocaux Telegram) → MP3, accepté partout : utilisé
// seulement si un fournisseur refuse le format d'origine.
async function toMp3(audio: Buffer): Promise<Buffer> {
  const r = await runFfmpeg(["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", "-f", "mp3", "pipe:1"], { input: audio, timeoutMs: 25_000 });
  if (r.code !== 0 || r.stdout.length === 0) throw new Error("Conversion audio impossible.");
  return r.stdout;
}

export async function transcribeAudio(audio: Buffer, opts: { filename?: string; mimeType?: string } = {}): Promise<{ text: string; provider: string }> {
  const list = providers();
  if (list.length === 0) throw new Error("Aucune clé de transcription (MISTRAL_API_KEY ou OPENAI_API_KEY).");
  const filename = opts.filename || "voice.ogg";
  const mime = opts.mimeType || "audio/ogg";
  const errors: string[] = [];

  for (const p of list) {
    try {
      let text: string;
      try {
        text = await callProvider(p, audio, filename, mime);
      } catch (e) {
        // Format refusé (4xx) : on réessaie une fois en MP3 si ffmpeg est disponible.
        const status = (e as { status?: number }).status;
        if (status && status >= 400 && status < 500 && status !== 401 && status !== 429 && (await getFfmpegPath())) {
          text = await callProvider(p, await toMp3(audio), "voice.mp3", "audio/mpeg");
        } else throw e;
      }
      if (!text) throw new Error("transcription vide");
      return { text, provider: p.name };
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(`Transcription impossible : ${errors.join(" | ")}`);
}
