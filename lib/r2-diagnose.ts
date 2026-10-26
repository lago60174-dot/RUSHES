// Logique pure du diagnostic Cloudflare R2 (aucun appel réseau, testable).
// Aucune valeur secrète n'est jamais renvoyée : seulement leur forme.
import type { Check } from "@/lib/telegram-diagnose";

export type R2Failure = { code?: string; status?: number | null; message: string };

// Les erreurs du SDK S3 portent le vrai code (AccessDenied, NoSuchBucket…).
export function toFailure(e: unknown): R2Failure {
  const err = e as { name?: string; Code?: string; message?: string; $metadata?: { httpStatusCode?: number }; cause?: { code?: string }; code?: string };
  return { code: err.Code ?? err.name ?? err.code ?? err.cause?.code, status: err.$metadata?.httpStatusCode ?? null, message: err.message ?? String(e) };
}

// ── 1. Variables : présence ET forme (la cause n°1 est un copier-coller faux) ──
export function checkR2Env(env: Record<string, string | undefined>): Check[] {
  const out: Check[] = [];
  const raw = (k: string) => env[k];
  const dirty = (v: string) => v !== v.trim() || /["'`\s]/.test(v); // espace, retour ligne, guillemet

  const push = (c: Check) => out.push(c);
  const missing = (k: string, fix: string): Check => ({ id: `r2.env.${k}`, label: k, status: "fail", detail: "Variable absente ou vide.", fix });

  // R2_ACCOUNT_ID
  {
    const v = raw("R2_ACCOUNT_ID"); const k = "R2_ACCOUNT_ID";
    if (!v?.trim()) push(missing(k, "C'est la longue suite après dash.cloudflare.com/ dans l'URL, ou « ID du compte » sur la page R2."));
    else if (dirty(v)) push({ id: `r2.env.${k}`, label: k, status: "fail", detail: "Contient un espace, un retour à la ligne ou un guillemet invisible.", fix: "Supprime la variable dans Vercel et recolle la valeur sans rien autour, puis redéploie." });
    else if (/cloudflarestorage|https?:/i.test(v)) push({ id: `r2.env.${k}`, label: k, status: "fail", detail: "Tu as collé l'adresse (endpoint) au lieu de l'ID du compte.", fix: "Garde seulement les 32 caractères qui précèdent « .r2.cloudflarestorage.com »." });
    else if (!/^[0-9a-f]{32}$/i.test(v)) push({ id: `r2.env.${k}`, label: k, status: "warn", detail: `Forme inhabituelle (${v.length} caractères au lieu de 32 chiffres/lettres a-f).`, fix: "Recopie l'ID depuis la page R2 de Cloudflare." });
    else push({ id: `r2.env.${k}`, label: k, status: "ok", detail: "Forme correcte (32 caractères)." });
  }

  // R2_ACCESS_KEY_ID
  {
    const v = raw("R2_ACCESS_KEY_ID"); const k = "R2_ACCESS_KEY_ID";
    if (!v?.trim()) push(missing(k, "C'est l'« ID de clé d'accès » affiché à la création du jeton R2."));
    else if (dirty(v)) push({ id: `r2.env.${k}`, label: k, status: "fail", detail: "Contient un espace, un retour à la ligne ou un guillemet invisible.", fix: "Supprime la variable dans Vercel et recolle la valeur proprement, puis redéploie." });
    else if (/^cfat_|^cfut_/i.test(v)) push({ id: `r2.env.${k}`, label: k, status: "fail", detail: "Tu as collé la « Valeur du jeton » (cfat_…), pas l'« ID de clé d'accès ».", fix: "Utilise l'ID de clé d'accès (32 caractères), sous « identifiants de connexion pour les clients S3 »." });
    else if (!/^[0-9a-f]{32}$/i.test(v)) push({ id: `r2.env.${k}`, label: k, status: "warn", detail: `Forme inhabituelle (${v.length} caractères, attendu 32).`, fix: "Recopie l'ID de clé d'accès depuis la création du jeton." });
    else push({ id: `r2.env.${k}`, label: k, status: "ok", detail: "Forme correcte (32 caractères)." });
  }

  // R2_SECRET_ACCESS_KEY
  {
    const v = raw("R2_SECRET_ACCESS_KEY"); const k = "R2_SECRET_ACCESS_KEY";
    if (!v?.trim()) push(missing(k, "C'est la « Clé d'accès secrète », affichée une seule fois à la création du jeton."));
    else if (dirty(v)) push({ id: `r2.env.${k}`, label: k, status: "fail", detail: "Contient un espace, un retour à la ligne ou un guillemet invisible.", fix: "Supprime la variable dans Vercel et recolle la valeur proprement, puis redéploie." });
    else if (/^cfat_|^cfut_/i.test(v)) push({ id: `r2.env.${k}`, label: k, status: "fail", detail: "Tu as collé la « Valeur du jeton » (cfat_…), pas la clé d'accès secrète.", fix: "Utilise la clé d'accès secrète (64 caractères). Si tu l'as perdue, recrée un jeton." });
    else if (!/^[0-9a-f]{64}$/i.test(v)) push({ id: `r2.env.${k}`, label: k, status: "warn", detail: `Forme inhabituelle (${v.length} caractères, attendu 64). Copie tronquée ?`, fix: "Si tu ne l'as plus en entier, recrée un jeton : la clé secrète n'est affichée qu'une fois." });
    else push({ id: `r2.env.${k}`, label: k, status: "ok", detail: "Forme correcte (64 caractères)." });
  }

  // R2_BUCKET
  {
    const v = raw("R2_BUCKET"); const k = "R2_BUCKET";
    if (!v?.trim()) push(missing(k, "C'est le nom du compartiment, tel qu'affiché dans R2."));
    else if (dirty(v)) push({ id: `r2.env.${k}`, label: k, status: "fail", detail: `Contient un espace, un retour à la ligne ou un guillemet invisible (valeur lue : « ${v.replace(/\s/g, "␣")} »).`, fix: "Recolle le nom du compartiment sans rien autour, puis redéploie." });
    else if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(v)) push({ id: `r2.env.${k}`, label: k, status: "fail", detail: `« ${v} » n'est pas un nom de compartiment valide (minuscules, chiffres et tirets seulement ; pas d'URL).`, fix: "Mets uniquement le nom, par exemple mymedia." });
    else push({ id: `r2.env.${k}`, label: k, status: "ok", detail: `Nom configuré : « ${v} ». Compare-le au nom exact dans ta liste de compartiments Cloudflare.` });
  }

  // R2_PUBLIC_URL
  {
    const v = raw("R2_PUBLIC_URL"); const k = "R2_PUBLIC_URL";
    if (!v?.trim()) push(missing(k, "Active l'accès public du compartiment (sous-domaine r2.dev) et copie l'URL."));
    else if (dirty(v)) push({ id: `r2.env.${k}`, label: k, status: "fail", detail: "Contient un espace, un retour à la ligne ou un guillemet invisible.", fix: "Recolle l'URL proprement, puis redéploie." });
    else if (!/^https:\/\//.test(v)) push({ id: `r2.env.${k}`, label: k, status: "fail", detail: "Doit commencer par https://.", fix: "Exemple : https://pub-xxxxxxxx.r2.dev" });
    else if (/\/$/.test(v)) push({ id: `r2.env.${k}`, label: k, status: "warn", detail: "Slash final présent.", fix: "Retire le / à la fin." });
    else push({ id: `r2.env.${k}`, label: k, status: "ok", detail: v });
  }
  return out;
}

// ── 2. Écriture réelle d'un petit fichier ──────────────────────────────
export function interpretR2Put(res: { ok: true } | { ok: false; failure: R2Failure }, bucket: string): Check {
  const label = "Écriture dans le bucket (test réel)";
  if (!("failure" in res)) return { id: "r2.put", label, status: "ok", detail: `Un fichier de test a été écrit dans « ${bucket} ».` };
  const { code = "", status, message } = res.failure;
  const blob = `${code} ${message}`;
  // Les cas précis d'abord : plusieurs d'entre eux renvoient aussi HTTP 403.
  if (/InvalidAccessKeyId|SignatureDoesNotMatch|InvalidArgument/i.test(blob) || status === 401) {
    return { id: "r2.put", label, status: "fail", detail: "Les clés ne sont pas reconnues (ID inconnu ou clé secrète incorrecte/tronquée).", fix: "Recrée un jeton R2 et recopie l'ID de clé d'accès ET la clé secrète (pas la « Valeur du jeton »), sans espace, puis redéploie." };
  }
  if (/NoSuchBucket|specified bucket does not exist/i.test(blob) || status === 404) {
    return { id: "r2.put", label, status: "fail", detail: `Le compartiment « ${bucket} » n'existe pas dans ce compte Cloudflare (ou R2_ACCOUNT_ID est d'un autre compte).`, fix: "Compare R2_BUCKET avec la liste de tes compartiments dans R2, lettre pour lettre, et vérifie R2_ACCOUNT_ID." };
  }
  if (/AccessDenied|Access Denied/i.test(blob) || status === 403) {
    return {
      id: "r2.put", label, status: "fail",
      detail: `Cloudflare refuse l'écriture dans « ${bucket} » (403 Access Denied). Tes clés sont reconnues, mais ce jeton n'a pas le droit d'écrire ICI.`,
      fix: "Les 3 causes possibles : (1) le jeton est en « Lecture seule » : il faut « Lecture et écriture d'objets » ; (2) le jeton est limité à un AUTRE compartiment que « " + bucket + " » ; (3) R2_BUCKET ne correspond pas au compartiment autorisé. Le plus simple : Cloudflare > R2 > Gérer les jetons API > Créer un jeton > « Lecture et écriture d'objets » > « Appliquer à tous les compartiments » (ou à celui-ci) > recopie le nouvel ID et la nouvelle clé secrète dans Vercel, puis redéploie.",
    };
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|fetch failed|ECONN|ETIMEDOUT/i.test(blob)) {
    return { id: "r2.put", label, status: "fail", detail: `Adresse introuvable ou injoignable : ${message}`, fix: "R2_ACCOUNT_ID est probablement faux (l'adresse est https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com)." };
  }
  return { id: "r2.put", label, status: "fail", detail: `Échec : ${code || "erreur"}${status ? ` (HTTP ${status})` : ""} — ${message}` };
}

// ── 3. Lecture publique : ce que Zernio utilisera pour télécharger la vidéo ──
export function interpretR2Public(res: { status: number | null; matches?: boolean; error?: string }, publicUrl: string): Check {
  const label = "Lecture publique (R2_PUBLIC_URL)";
  if (res.status === null) return { id: "r2.public", label, status: "fail", detail: `Impossible de joindre ${publicUrl} : ${res.error ?? "pas de réponse"}.`, fix: "Vérifie R2_PUBLIC_URL (domaine r2.dev ou domaine personnalisé actif)." };
  if (res.status === 200 && res.matches) return { id: "r2.public", label, status: "ok", detail: "Le fichier de test est lisible publiquement : Zernio pourra télécharger tes vidéos." };
  if (res.status === 200) return { id: "r2.public", label, status: "warn", detail: "L'URL répond, mais pas avec le fichier de test (autre compartiment ?).", fix: "R2_PUBLIC_URL doit pointer vers le compartiment R2_BUCKET." };
  if (res.status === 401 || res.status === 403) return { id: "r2.public", label, status: "fail", detail: `Accès public refusé (${res.status}) : le compartiment n'est pas public.`, fix: "R2 > ton compartiment > Paramètres > Accès public : active le sous-domaine r2.dev (ou un domaine personnalisé)." };
  if (res.status === 404) return { id: "r2.public", label, status: "fail", detail: "404 : l'URL publique ne trouve pas le fichier qu'on vient d'écrire.", fix: "R2_PUBLIC_URL pointe vers un autre compartiment, ou l'accès public n'est pas activé sur celui-ci." };
  return { id: "r2.public", label, status: "warn", detail: `Réponse inattendue (${res.status}).` };
}

export function interpretR2Cleanup(res: { ok: true } | { ok: false; message: string }): Check {
  const label = "Suppression du fichier de test";
  return !("message" in res)
    ? { id: "r2.delete", label, status: "ok", detail: "Fichier de test supprimé (le jeton peut supprimer)." }
    : { id: "r2.delete", label, status: "warn", detail: `Le fichier de test n'a pas pu être supprimé : ${res.message}`, fix: "Le jeton n'a pas le droit de supprimer. Utilise « Lecture et écriture d'objets »." };
}

// ── Message lisible pour Telegram quand l'upload d'une vidéo échoue ──────
export function friendlyStorageError(message: string): string | null {
  if (/AccessDenied|Access Denied/i.test(message)) return "Cloudflare R2 refuse d'enregistrer la vidéo (Access Denied) : le jeton R2 n'a pas le droit d'écrire dans ce compartiment, ou le nom du compartiment est faux. Ouvre /diagnostic et clique sur « Diagnostic stockage R2 » : il te dit lequel des cas c'est.";
  if (/NoSuchBucket|specified bucket does not exist/i.test(message)) return "Le compartiment R2 configuré n'existe pas. Vérifie R2_BUCKET et R2_ACCOUNT_ID, ou ouvre /diagnostic > « Diagnostic stockage R2 ».";
  if (/InvalidAccessKeyId|SignatureDoesNotMatch/i.test(message)) return "Les clés R2 ne sont pas reconnues. Ouvre /diagnostic > « Diagnostic stockage R2 ».";
  return null;
}
