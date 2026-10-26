// Logique pure du diagnostic Zernio (aucun appel réseau, testable).
import type { Check } from "@/lib/telegram-diagnose";
import type { ZernioWebhook, ZernioWebhookLog } from "@/lib/zernio";

export const zernioWebhookUrlFor = (base: string) => `${base.replace(/\/+$/, "")}/api/zernio/webhook`;

// Évènements dont l'app dépend pour suivre tes publications.
const CORE_EVENTS = ["post.scheduled", "post.published", "post.failed", "post.partial", "post.cancelled"];

// ── Variables ──────────────────────────────────────────────────────────
export function checkZernioEnv(env: Record<string, string | undefined>): Check[] {
  const has = (k: string) => Boolean(env[k]?.trim());
  const out: Check[] = [];
  out.push(has("ZERNIO_API_KEY")
    ? { id: "z.env.key", label: "ZERNIO_API_KEY", status: "ok", detail: "Présente." }
    : { id: "z.env.key", label: "ZERNIO_API_KEY", status: "fail", detail: "Absente.", fix: "Crée une clé API dans le dashboard Zernio (accès à tous les profils), mets-la dans Vercel et redéploie." });
  out.push(has("ZERNIO_WEBHOOK_SECRET")
    ? { id: "z.env.secret", label: "ZERNIO_WEBHOOK_SECRET", status: "ok", detail: `Présente (${env.ZERNIO_WEBHOOK_SECRET!.length} caractères). Elle doit être IDENTIQUE au secret saisi dans le webhook côté Zernio.` }
    : { id: "z.env.secret", label: "ZERNIO_WEBHOOK_SECRET", status: "fail", detail: "Absente : tous les webhooks reçus seront rejetés (401 Invalid signature).", fix: "Mets dans Vercel le même secret que dans le webhook Zernio, puis redéploie." });
  return out;
}

// ── Clé API valide ? comptes connectés ? ────────────────────────────────
export function interpretZernioAccounts(res: { ok: true; count: number } | { ok: false; error: string }): Check {
  const label = "Clé API acceptée par Zernio";
  if (!("error" in res)) {
    return res.count > 0
      ? { id: "z.api", label, status: "ok", detail: `Clé valide. ${res.count} réseau(x) social(aux) connecté(s) sur ce compte Zernio.` }
      : { id: "z.api", label, status: "warn", detail: "Clé valide, mais AUCUN réseau social n'est connecté sur ce compte Zernio (normal juste après un changement de compte).", fix: "Reconnecte tes comptes via « Réseaux sociaux » dans l'app." };
  }
  if (/\b40[13]\b/.test(res.error)) {
    return { id: "z.api", label, status: "fail", detail: `Zernio refuse la clé (${res.error}) : invalide, révoquée, ou d'un autre compte.`, fix: "Recrée une clé dans le dashboard du NOUVEAU compte Zernio, mets-la dans ZERNIO_API_KEY (sans espace) et redéploie." };
  }
  return { id: "z.api", label, status: "fail", detail: res.error, fix: "Vérifie ZERNIO_API_KEY et réessaie." };
}

// ── ZERNIO_PROFILE_ID cohérent avec le compte actuel ? ──────────────────
export function interpretZernioProfile(profileEnv: string | undefined, profiles: Array<{ id: string; name?: string }> | null): Check {
  const label = "ZERNIO_PROFILE_ID";
  const v = profileEnv?.trim();
  if (!v) return { id: "z.profile", label, status: "ok", detail: "Vide : l'app choisit ou crée un profil toute seule (recommandé après un changement de compte)." };
  if (!profiles) return { id: "z.profile", label, status: "warn", detail: "Défini, mais impossible de vérifier (liste des profils indisponible)." };
  if (profiles.some((p) => p.id === v)) return { id: "z.profile", label, status: "ok", detail: "Défini et présent dans ce compte Zernio." };
  return {
    id: "z.profile", label, status: "fail",
    detail: `Défini (${v}) mais absent de ton compte Zernio actuel : c'est l'ancien profil. Connecter un réseau échouera.`,
    fix: profiles.length ? `Vide la variable, ou mets un ID de ce compte : ${profiles.map((p) => `${p.id}${p.name ? ` (${p.name})` : ""}`).join(", ")}.` : "Vide la variable ZERNIO_PROFILE_ID dans Vercel et redéploie.",
  };
}

// ── Webhook déclaré chez Zernio ─────────────────────────────────────────
export function interpretZernioWebhooks(list: ZernioWebhook[], expectedUrl: string): Check {
  const label = "Webhook déclaré dans Zernio";
  const norm = (u: string) => u.trim().replace(/\/+$/, "");
  if (list.length === 0) {
    return { id: "z.webhook", label, status: "fail", detail: "Aucun webhook dans CE compte Zernio. Les webhooks ne suivent pas quand on change de compte : il faut le recréer.", fix: `Zernio > Settings > Webhooks > Add : URL ${expectedUrl}, secret = ZERNIO_WEBHOOK_SECRET, évènements post.* et account.*.` };
  }
  const mine = list.find((w) => norm(w.url) === norm(expectedUrl));
  if (!mine) {
    return { id: "z.webhook", label, status: "fail", detail: `Aucun webhook ne pointe vers ${expectedUrl}. URL(s) trouvée(s) : ${list.map((w) => w.url || "(vide)").join(", ")}.`, fix: "Corrige l'URL du webhook dans Zernio (faute de frappe, ancien domaine, slash en trop ?)." };
  }
  if (!mine.isActive) {
    return { id: "z.webhook", label, status: "fail", detail: "Le webhook existe mais il est DÉSACTIVÉ (Zernio désactive un webhook après des échecs de livraison répétés).", fix: "Réactive-le dans Zernio (isActive) après avoir corrigé la cause (secret, URL), puis relance un test." };
  }
  const missing = CORE_EVENTS.filter((e) => mine.events.length > 0 && !mine.events.includes(e));
  if (missing.length > 0) {
    return { id: "z.webhook", label, status: "warn", detail: `Webhook actif sur la bonne URL, mais il n'écoute pas : ${missing.join(", ")}.`, fix: "Ajoute ces évènements dans Zernio, sinon l'état de tes publications ne se mettra pas à jour." };
  }
  if (mine.failureCount > 0) {
    return { id: "z.webhook", label, status: "warn", detail: `Webhook actif sur la bonne URL, mais Zernio compte ${mine.failureCount} échec(s) de livraison consécutif(s).`, fix: "Regarde le test interne ci-dessous : il montre ce que ton app répond." };
  }
  return { id: "z.webhook", label, status: "ok", detail: `Actif sur ${expectedUrl}.` };
}

// ── Test interne : un faux webhook.test correctement signé ──────────────
export type SignedProbe = { status: number | null; contentType?: string | null; body?: string; location?: string | null; error?: string };
export function interpretSignedProbe(p: SignedProbe, url: string): Check {
  const label = "Ton app accepte un webhook signé (test interne)";
  if (p.status === null) return { id: "z.probe", label, status: "fail", detail: `Impossible de joindre ${url} : ${p.error ?? "pas de réponse"}.`, fix: "Vérifie le domaine et que le déploiement est en ligne." };
  if (p.status >= 200 && p.status < 300) return { id: "z.probe", label, status: "ok", detail: `Réponse ${p.status} : la signature est acceptée, la route fonctionne.` };
  if (p.status === 401) {
    if (/invalid signature/i.test(p.body ?? "")) {
      return { id: "z.probe", label, status: "fail", detail: "Ton app rejette la signature (401 Invalid signature) alors qu'elle est calculée avec ZERNIO_WEBHOOK_SECRET : l'adresse publique tourne avec un AUTRE secret (ancien déploiement ou variable non prise en compte).", fix: "Redéploie la production APRÈS avoir modifié la variable (Vercel > Deployments > ⋯ > Redeploy), puis relance ce test." };
    }
    return { id: "z.probe", label, status: "fail", detail: "Vercel répond 401 : la protection de déploiement bloque Zernio.", fix: "Vercel > Settings > Deployment Protection : désactive « Vercel Authentication » pour la production." };
  }
  if (p.status >= 300 && p.status < 400) return { id: "z.probe", label, status: "fail", detail: `L'adresse redirige (${p.status}) vers ${p.location ?? "?"}. Zernio ne suit pas les redirections.`, fix: "Mets dans Zernio l'URL finale (celle vers laquelle ça redirige)." };
  if (p.status === 404) return { id: "z.probe", label, status: "fail", detail: "404 : /api/zernio/webhook n'existe pas à cette adresse.", fix: "Vérifie le domaine et que le dernier commit est déployé." };
  if (p.status >= 500) return { id: "z.probe", label, status: "fail", detail: `Erreur serveur (${p.status}) dans ton app.`, fix: "Regarde les logs Vercel de /api/zernio/webhook." };
  return { id: "z.probe", label, status: "warn", detail: `Réponse inattendue (${p.status}).` };
}

// ── Test envoyé PAR Zernio (bouton) ─────────────────────────────────────
// Doc Zernio : « A 500 from the test call means your endpoint did not answer 2xx ».
export function interpretZernioTest(r: { status: number; body: string; requestId: string | null } | null): Check {
  const label = "Test envoyé par Zernio à ton webhook";
  if (r === null) return { id: "z.test", label, status: "skip", detail: "Non lancé. Clique sur « Envoyer un test Zernio »." };
  if (r.status >= 200 && r.status < 300) return { id: "z.test", label, status: "ok", detail: "Zernio a envoyé le test et ton app a répondu 2xx." };
  let msg = r.body;
  try { const j = JSON.parse(r.body) as { error?: string; code?: string; message?: string }; msg = [j.code, j.error ?? j.message].filter(Boolean).join(" — ") || r.body; } catch { /* corps non JSON */ }
  const rid = r.requestId ? ` (Request ID ${r.requestId})` : "";
  if (r.status === 500) {
    return {
      id: "z.test", label, status: "fail",
      detail: `Zernio a bien envoyé le test, mais ton endpoint n'a PAS répondu 2xx${rid} : « ${msg || "Test webhook failed"} ».`,
      fix: "Regarde « Dernières livraisons Zernio » juste en dessous : elle montre l'URL appelée et le code renvoyé. Un 404 = mauvaise URL dans Zernio ; un 401 = secret différent ; un 5xx = erreur dans ton app.",
    };
  }
  if (r.status === 400) {
    return { id: "z.test", label, status: "fail", detail: `Zernio refuse la demande de test (400)${rid} : ${msg}`, fix: "Problème de ma requête de test, pas de ton app : signale-le." };
  }
  return { id: "z.test", label, status: "fail", detail: `Zernio répond ${r.status}${rid} : ${msg || "(corps vide)"}`, fix: "Vérifie la clé API (droits « webhooks ») et que ce webhook existe dans ce compte Zernio." };
}

// ── Journal : ce que TON app a répondu à Zernio ─────────────────────────
export function interpretZernioLogs(logs: ZernioWebhookLog[] | null, expectedUrl: string): Check {
  const label = "Dernières livraisons Zernio vers ton app";
  const norm = (u: string) => u.trim().replace(/\/+$/, "");
  if (logs === null) return { id: "z.logs", label, status: "skip", detail: "Journal indisponible (droits de la clé API ?)." };
  if (logs.length === 0) return { id: "z.logs", label, status: "skip", detail: "Aucune livraison enregistrée sur 30 jours : aucun évènement n'a été envoyé à ton app depuis ce compte." };

  const short = (l: ZernioWebhookLog) => `${l.event || "?"}${l.test ? " (test)" : ""} → ${l.url || "?"} : ${l.statusCode ?? "pas de réponse"}${l.status === "success" ? " ✔" : " ✘"}${l.errorMessage ? ` (${l.errorMessage})` : ""}`;
  const lines = logs.slice(0, 5).map(short).join(" | ");
  const last = logs[0];

  if (last.status === "success") return { id: "z.logs", label, status: "ok", detail: `Dernière livraison réussie. ${lines}` };

  const wrongUrl = norm(last.url) !== norm(expectedUrl);
  const hint =
    last.statusCode === 404 ? (wrongUrl ? `Zernio appelle ${last.url} qui n'existe pas : l'URL du webhook est fausse.` : "La route n'existe pas sur ce déploiement.") :
    last.statusCode === 401 || last.statusCode === 403 ? "Ton app rejette la signature (ou Vercel bloque) : le secret du webhook Zernio diffère de ZERNIO_WEBHOOK_SECRET, ou le déploiement n'a pas été refait." :
    last.statusCode !== null && last.statusCode >= 500 ? "Erreur dans ton app : regarde les logs Vercel de /api/zernio/webhook." :
    last.statusCode === null ? "Aucune réponse : URL injoignable, domaine inconnu ou délai de 5 secondes dépassé." :
    "Réponse non 2xx.";
  return {
    id: "z.logs", label, status: "fail",
    detail: `${hint} ${lines}${last.responseBody ? ` — réponse de ton app : « ${last.responseBody} »` : ""}`,
    fix: wrongUrl ? `Dans Zernio > Webhooks, mets l'URL exacte : ${expectedUrl}` : undefined,
  };
}
