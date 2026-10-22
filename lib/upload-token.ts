import { createHmac, timingSafeEqual } from "crypto";

// Lien d'upload à usage limité dans le temps (pour les vidéos > 20 Mo que
// Telegram ne laisse pas télécharger au bot). Jeton = "<expiration>.<signature HMAC>".
function secret(): string {
  const s = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!s) throw new Error("TELEGRAM_WEBHOOK_SECRET manquant.");
  return s;
}
const sign = (exp: number) => createHmac("sha256", secret()).update(`upload:${exp}`).digest("hex");

export function createUploadToken(ttlMinutes = 30): string {
  const exp = Math.floor(Date.now() / 1000) + ttlMinutes * 60;
  return `${exp}.${sign(exp)}`;
}

export function verifyUploadToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || !sig || exp < Date.now() / 1000) return false;
  try {
    const a = Buffer.from(sig, "hex"), b = Buffer.from(sign(exp), "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}
