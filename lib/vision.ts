import { createWriteStream } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { runFfmpeg } from "@/lib/ffmpeg";

export type Frame = { seconds: number; jpeg: Buffer };

// Sécurité : ffmpeg ne lit que des URL situées sur NOTRE domaine public R2.
// Les liens de vidéos viennent de la base (parfois saisis à la main dans
// l'app) : sans cette limite, ffmpeg pourrait être amené à lire n'importe quelle
// adresse, y compris interne au serveur.
export function isAllowedMediaUrl(url: string): boolean {
  try {
    const base = process.env.R2_PUBLIC_URL;
    if (!base) return false;
    const u = new URL(url), b = new URL(base);
    return (u.protocol === "https:" || u.protocol === "http:") && u.origin === b.origin;
  } catch { return false; }
}

// Au-delà de cette taille on ne télécharge pas : l'agent se rabat sur la miniature.
export const MAX_VISION_BYTES = 150 * 1024 * 1024;

// Pourquoi on télécharge au lieu de donner l'URL à ffmpeg : le binaire
// ffmpeg-static (glibc statique) plante (segfault) dès qu'il doit résoudre un
// nom de domaine. Node fait donc le réseau, ffmpeg ne lit qu'un fichier local.
async function downloadToTemp(url: string, dir: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(40_000) });
  if (!res.ok || !res.body) throw new Error(`Vidéo inaccessible (${res.status}).`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_VISION_BYTES) throw new Error(`Vidéo trop volumineuse pour être analysée (${Math.round(declared / 1048576)} Mo, max ${MAX_VISION_BYTES / 1048576} Mo).`);

  const file = join(dir, "video.bin");
  let received = 0;
  const src = Readable.fromWeb(res.body as unknown as import("stream/web").ReadableStream);
  src.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > MAX_VISION_BYTES) src.destroy(new Error("Vidéo trop volumineuse pour être analysée."));
  });
  await pipeline(src, createWriteStream(file));
  return file;
}

async function probeDuration(file: string): Promise<number> {
  // Sans ffprobe : ffmpeg écrit « Duration: HH:MM:SS.xx » sur stderr (et sort en erreur, c'est normal).
  const r = await runFfmpeg(["-hide_banner", "-i", file], { timeoutMs: 20_000 });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr);
  if (!m) throw new Error("Durée de la vidéo illisible (format non pris en charge).");
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// Extrait `count` images réparties sur toute la vidéo.
export async function extractFrames(url: string, count = 6, width = 768): Promise<{ durationSeconds: number; frames: Frame[] }> {
  if (!isAllowedMediaUrl(url)) throw new Error("URL de vidéo non autorisée.");
  const dir = await mkdtemp(join(tmpdir(), "flare-vision-"));
  try {
    const file = await downloadToTemp(url, dir);
    const duration = await probeDuration(file);
    const n = duration < 4 ? 1 : Math.max(1, Math.min(8, Math.floor(count)));
    const times = Array.from({ length: n }, (_, i) => Math.max(0, Math.min(duration - 0.3, ((i + 0.5) / n) * duration)));

    const frames: Frame[] = [];
    for (let i = 0; i < times.length; i += 3) {            // 3 extractions en parallèle
      const batch = await Promise.all(times.slice(i, i + 3).map(async (t) => {
        const r = await runFfmpeg(["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", `scale='min(${width},iw)':-2`, "-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { timeoutMs: 25_000 });
        return r.stdout.length > 500 ? { seconds: t, jpeg: r.stdout } : null;
      }));
      frames.push(...batch.filter((f): f is Frame => f !== null));
    }
    if (frames.length === 0) throw new Error("Aucune image n'a pu être extraite de la vidéo.");
    return { durationSeconds: duration, frames };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Repli : une miniature distante (Zernio) en base64. HTTPS uniquement, 5 Mo max.
export async function fetchImageBase64(url: string): Promise<{ mediaType: string; data: string } | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    const res = await fetch(u, { signal: AbortSignal.timeout(10_000) });
    const type = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!res.ok || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) return null;
    return { mediaType: type, data: buf.toString("base64") };
  } catch { return null; }
}

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
