import { spawn } from "child_process";

// Chemin du binaire ffmpeg : variable FFMPEG_PATH, sinon ffmpeg-static.
// Renvoie null si indisponible (le reste de l'app continue de fonctionner).
let cached: string | null | undefined;
export async function getFfmpegPath(): Promise<string | null> {
  if (cached !== undefined) return cached;
  if (process.env.FFMPEG_PATH) return (cached = process.env.FFMPEG_PATH);
  try {
    const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null };
    cached = (mod.default ?? (mod as unknown as string)) || null;
  } catch {
    cached = null;
  }
  return cached;
}

export type FfmpegResult = { code: number | null; stdout: Buffer; stderr: string };

// Lance ffmpeg avec délai maximal ; tue le processus s'il dépasse.
export async function runFfmpeg(args: string[], opts: { timeoutMs?: number; input?: Buffer; maxStdoutBytes?: number } = {}): Promise<FfmpegResult> {
  const bin = await getFfmpegPath();
  if (!bin) throw new Error("ffmpeg indisponible sur ce serveur.");
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxOut = opts.maxStdoutBytes ?? 15 * 1024 * 1024;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = []; let outSize = 0; let err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("ffmpeg : délai dépassé.")); }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => { outSize += d.length; if (outSize <= maxOut) out.push(d); else child.kill("SIGKILL"); });
    child.stderr.on("data", (d: Buffer) => { if (err.length < 20_000) err += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out), stderr: err }); });
    child.stdin.on("error", () => {});
    if (opts.input) child.stdin.end(opts.input); else child.stdin.end();
  });
}
