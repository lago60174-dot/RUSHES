import { agentProvider, mistralModel, MISTRAL_DEFAULT_MODEL, MISTRAL_FALLBACK_CHAIN, type ModelProbe, type MistralModelInfo } from "@/lib/llm";

// Logique pure du diagnostic du bot Telegram : aucune requête réseau ici,
// uniquement l'interprétation de ce que la route /api/telegram/diagnose a
// collecté. Les secrets ne sont jamais renvoyés (seulement « présent / absent »).

export type CheckStatus = "ok" | "warn" | "fail" | "skip";
export type Check = { id: string; label: string; status: CheckStatus; detail: string; fix?: string };

export type WebhookInfo = {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number; // secondes Unix
  last_error_message?: string;
  allowed_updates?: string[];
};

export type ProbeResult = { status: number | null; contentType?: string | null; location?: string | null; error?: string };

const TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/;

export const webhookUrlFor = (base: string) => `${base.replace(/\/+$/, "")}/api/telegram/webhook`;

// ── 1. Variables d'environnement ───────────────────────────────────────
export function checkEnv(env: Record<string, string | undefined>, requestOrigin: string): Check[] {
  const out: Check[] = [];
  const has = (k: string) => Boolean(env[k]?.trim());

  // Token
  if (!has("TELEGRAM_BOT_TOKEN")) {
    out.push({ id: "env.token", label: "TELEGRAM_BOT_TOKEN", status: "fail", detail: "Variable absente.", fix: "Crée le bot avec @BotFather (/newbot), copie le token dans Vercel, puis redéploie." });
  } else if (!TOKEN_RE.test(env.TELEGRAM_BOT_TOKEN!.trim())) {
    out.push({ id: "env.token", label: "TELEGRAM_BOT_TOKEN", status: "fail", detail: "Le format ne ressemble pas à un token Telegram (attendu : 123456789:AAxxxx…).", fix: "Recopie le token depuis @BotFather, sans espace ni guillemet." });
  } else {
    out.push({ id: "env.token", label: "TELEGRAM_BOT_TOKEN", status: "ok", detail: "Présent, format valide." });
  }

  // Secret du webhook
  if (!has("TELEGRAM_WEBHOOK_SECRET")) {
    out.push({ id: "env.secret", label: "TELEGRAM_WEBHOOK_SECRET", status: "fail", detail: "Variable absente : le webhook refusera tous les appels de Telegram.", fix: "Génère une chaîne aléatoire (lettres, chiffres, _ et - uniquement), mets-la dans Vercel, redéploie, puis clique sur « Installer le webhook »." });
  } else if (!SECRET_RE.test(env.TELEGRAM_WEBHOOK_SECRET!)) {
    out.push({ id: "env.secret", label: "TELEGRAM_WEBHOOK_SECRET", status: "fail", detail: "Caractères interdits (espace, guillemet, point, @…) ou plus de 256 caractères.", fix: "Utilise seulement A-Z a-z 0-9 _ - (ex. : openssl rand -hex 32)." });
  } else {
    out.push({ id: "env.secret", label: "TELEGRAM_WEBHOOK_SECRET", status: "ok", detail: `Présent (${env.TELEGRAM_WEBHOOK_SECRET!.length} caractères).` });
  }

  // ID propriétaire
  const ownerRaw = env.TELEGRAM_OWNER_ID?.trim();
  if (!ownerRaw) {
    out.push({ id: "env.owner", label: "TELEGRAM_OWNER_ID", status: "warn", detail: "Vide : le bot se contente de te donner ton ID Telegram, puis ne fait rien d'autre.", fix: "Écris au bot : il répond avec ton ID. Mets-le dans TELEGRAM_OWNER_ID sur Vercel et redéploie." });
  } else if (!/^-?\d+$/.test(ownerRaw) || Number(ownerRaw) === 0) {
    out.push({ id: "env.owner", label: "TELEGRAM_OWNER_ID", status: "fail", detail: "Doit être un nombre (ton ID Telegram), pas un @pseudo ni le token.", fix: "Écris au bot sans ID configuré : il te donne le bon nombre." });
  } else {
    out.push({ id: "env.owner", label: "TELEGRAM_OWNER_ID", status: "ok", detail: `Défini (${ownerRaw}). Tout message d'un autre compte est ignoré en silence.` });
  }

  // URL du site
  const site = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!site || /ton-projet/i.test(site)) {
    out.push({ id: "env.site", label: "NEXT_PUBLIC_SITE_URL", status: "warn", detail: site ? "Valeur d'exemple non remplacée." : "Absente : l'URL du site est déduite de la page courante.", fix: "Mets l'URL exacte de ton app (ex. https://rushes-seven.vercel.app), sans slash final." });
  } else if (!/^https:\/\//.test(site)) {
    out.push({ id: "env.site", label: "NEXT_PUBLIC_SITE_URL", status: "fail", detail: "Telegram n'accepte que des webhooks en https.", fix: "Commence l'URL par https://." });
  } else if (/\/$/.test(site)) {
    out.push({ id: "env.site", label: "NEXT_PUBLIC_SITE_URL", status: "warn", detail: "Slash final présent.", fix: "Retire le / à la fin." });
  } else {
    let siteHost = ""; let reqHost = "";
    try { siteHost = new URL(site).host; reqHost = new URL(requestOrigin).host; } catch { /* ignoré */ }
    if (siteHost && reqHost && siteHost !== reqHost) {
      out.push({ id: "env.site", label: "NEXT_PUBLIC_SITE_URL", status: "warn", detail: `Tu consultes l'app via ${reqHost} mais la variable pointe vers ${siteHost}.`, fix: "Si ce n'est pas voulu, aligne la variable sur ton domaine principal." });
    } else {
      out.push({ id: "env.site", label: "NEXT_PUBLIC_SITE_URL", status: "ok", detail: site });
    }
  }

  // Compte propriétaire de l'app
  out.push(has("OWNER_EMAIL")
    ? { id: "env.email", label: "OWNER_EMAIL", status: "ok", detail: "Définie." }
    : { id: "env.email", label: "OWNER_EMAIL", status: "fail", detail: "Absente : le bot ne retrouve pas ton compte et répond « Compte propriétaire introuvable ».", fix: "Mets l'email de ton compte Supabase dans OWNER_EMAIL." });

  // Cerveau de l'agent : même règle de choix que l'agent lui-même (lib/llm.ts)
  const provider = agentProvider(env);
  out.push(provider
    ? { id: "env.llm", label: "Clé IA de l'agent", status: "ok", detail: provider === "mistral" ? `Mistral (modèle ${mistralModel(env)}).` : `Claude (modèle ${env.AGENT_CHAT_MODEL?.trim() || "claude-sonnet-5-5"}).` }
    : { id: "env.llm", label: "Clé IA de l'agent", status: "fail", detail: "Ni MISTRAL_API_KEY ni ANTHROPIC_API_KEY : le bot ne peut pas te répondre.", fix: "Ajoute MISTRAL_API_KEY sur Vercel et redéploie." });

  // Vocaux
  out.push(has("MISTRAL_API_KEY") || has("OPENAI_API_KEY")
    ? { id: "env.stt", label: "Transcription des vocaux", status: "ok", detail: has("MISTRAL_API_KEY") ? "Mistral (Voxtral)." : "OpenAI (Whisper)." }
    : { id: "env.stt", label: "Transcription des vocaux", status: "warn", detail: "Aucune clé : les messages vocaux ne seront pas compris.", fix: "Ajoute MISTRAL_API_KEY (ou OPENAI_API_KEY)." });

  // Vidéos
  const r2 = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL"].filter((k) => !has(k));
  out.push(r2.length === 0
    ? { id: "env.r2", label: "Stockage vidéo (R2)", status: "ok", detail: "Les 5 variables sont présentes." }
    : { id: "env.r2", label: "Stockage vidéo (R2)", status: "warn", detail: `Manque : ${r2.join(", ")}. Les vidéos envoyées au bot ne pourront pas être stockées.`, fix: "Complète les variables Cloudflare R2 sur Vercel." });

  return out;
}

// ── 2. Token valide ? (getMe) ──────────────────────────────────────────
export function interpretGetMe(res: { ok: true; username?: string } | { ok: false; error: string }): Check {
  if (!("error" in res)) return { id: "tg.getme", label: "Token accepté par Telegram", status: "ok", detail: `Bot @${res.username ?? "?"}.` };
  const unauthorized = /unauthorized|not found/i.test(res.error);
  return {
    id: "tg.getme", label: "Token accepté par Telegram", status: "fail",
    detail: unauthorized ? "Telegram refuse ce token (révoqué ou mal copié)." : res.error,
    fix: unauthorized ? "Dans @BotFather : /mybots → ton bot → API Token. Recopie-le dans Vercel et redéploie." : undefined,
  };
}

// ── 3. Webhook enregistré chez Telegram ────────────────────────────────
export function interpretWebhookInfo(info: WebhookInfo, expectedUrl: string, nowSec = Math.floor(Date.now() / 1000)): Check {
  const label = "Webhook enregistré chez Telegram";
  const pending = info.pending_update_count ?? 0;

  if (!info.url) {
    return { id: "tg.webhook", label, status: "fail", detail: "Aucun webhook : Telegram ne sait pas où envoyer tes messages. C'est la cause n°1 d'un bot totalement muet.", fix: "Clique sur « Installer le webhook » (ou ouvre /api/telegram/setup)." };
  }
  if (info.url !== expectedUrl) {
    return { id: "tg.webhook", label, status: "fail", detail: `Telegram envoie vers ${info.url} alors que l'app attend ${expectedUrl}.`, fix: "Clique sur « Installer le webhook » pour réenregistrer la bonne adresse." };
  }
  if (info.allowed_updates && info.allowed_updates.length > 0 && !info.allowed_updates.includes("message")) {
    return { id: "tg.webhook", label, status: "fail", detail: `Le webhook ne reçoit pas les messages (types autorisés : ${info.allowed_updates.join(", ")}).`, fix: "Clique sur « Installer le webhook »." };
  }

  if (info.last_error_message) {
    const ageMin = info.last_error_date ? Math.round((nowSec - info.last_error_date) / 60) : null;
    const msg = info.last_error_message;
    let hint = "Regarde les logs de la fonction sur Vercel (Logs > filtre /api/telegram/webhook).";
    if (/403/.test(msg)) hint = "Le secret enregistré chez Telegram ne correspond pas à TELEGRAM_WEBHOOK_SECRET (modifié après l'installation ?). Clique sur « Installer le webhook » après avoir redéployé.";
    else if (/401/.test(msg)) hint = "Vercel bloque Telegram : désactive « Vercel Authentication » (Settings > Deployment Protection) pour la production.";
    else if (/404/.test(msg)) hint = "L'adresse n'existe pas sur ce déploiement : vérifie le domaine et que le dernier code est bien déployé.";
    else if (/timeout|timed out/i.test(msg)) hint = "La fonction met trop de temps à répondre : regarde les logs Vercel.";
    else if (/ssl|certificate/i.test(msg)) hint = "Problème de certificat HTTPS sur le domaine.";
    else if (/50\d/.test(msg)) hint = "Erreur serveur dans l'app : regarde les logs Vercel.";

    const recent = ageMin === null || ageMin < 60 || pending > 0;
    return {
      id: "tg.webhook", label, status: recent ? "fail" : "warn",
      detail: `Dernière erreur de livraison${ageMin !== null ? ` (il y a ${ageMin < 120 ? `${ageMin} min` : `${Math.round(ageMin / 60)} h`})` : ""} : « ${msg} »${recent ? "" : " — ancienne, probablement déjà résolue."}`,
      fix: recent ? hint : "Envoie un message au bot pour confirmer que ça passe maintenant.",
    };
  }

  if (pending > 0) {
    return { id: "tg.webhook", label, status: "warn", detail: `${pending} message(s) en attente chez Telegram : l'app ne les a pas encore acceptés.`, fix: "Envoie un nouveau message ; s'ils restent bloqués, regarde la ligne « Adresse du webhook » ci-dessous." };
  }
  return { id: "tg.webhook", label, status: "ok", detail: `Branché sur ${info.url}, aucune erreur de livraison.` };
}

// ── 4. L'adresse publique répond-elle comme Telegram l'attend ? ────────
// wrong = appel avec un mauvais secret (doit donner 403)
// right = appel avec le bon secret et un update vide (doit donner 200)
export function interpretProbe(wrong: ProbeResult, right: ProbeResult, url: string): Check {
  const label = "Adresse du webhook (test réel)";
  const net = [wrong, right].find((p) => p.status === null);
  if (net) return { id: "probe", label, status: "fail", detail: `Impossible de joindre ${url} : ${net.error ?? "pas de réponse"}.`, fix: "Vérifie que le domaine est correct et que le déploiement est en ligne." };

  const all = [wrong, right];
  if (all.some((p) => p.status === 401)) {
    return { id: "probe", label, status: "fail", detail: "Vercel répond 401 : la protection de déploiement bloque Telegram (il ne peut pas se connecter).", fix: "Vercel > Settings > Deployment Protection : désactive « Vercel Authentication » pour la production, puis réessaie." };
  }
  const redirect = all.find((p) => p.status !== null && p.status >= 300 && p.status < 400);
  if (redirect) {
    return { id: "probe", label, status: "fail", detail: `L'adresse redirige (${redirect.status}) vers ${redirect.location ?? "?"}. Telegram ne suit pas les redirections.`, fix: "Utilise dans NEXT_PUBLIC_SITE_URL le domaine final (celui vers lequel ça redirige) puis réinstalle le webhook." };
  }
  if (all.some((p) => p.status === 404)) {
    return { id: "probe", label, status: "fail", detail: "404 : la route /api/telegram/webhook n'existe pas à cette adresse.", fix: "Vérifie le domaine et que le dernier commit est bien déployé sur Vercel." };
  }
  if (all.some((p) => p.status !== null && p.status >= 500)) {
    return { id: "probe", label, status: "fail", detail: `Erreur serveur (${all.find((p) => (p.status ?? 0) >= 500)!.status}) en appelant le webhook.`, fix: "Regarde les logs Vercel de /api/telegram/webhook." };
  }
  if (wrong.status === 200) {
    return { id: "probe", label, status: "fail", detail: "Le webhook accepte un appel avec un mauvais secret : il est ouvert à n'importe qui.", fix: "Vérifie que TELEGRAM_WEBHOOK_SECRET est bien défini sur ce déploiement." };
  }
  if (right.status === 403) {
    return { id: "probe", label, status: "fail", detail: "Le webhook refuse le bon secret : cette adresse correspond à un autre déploiement ou à d'anciennes variables.", fix: "Vérifie NEXT_PUBLIC_SITE_URL, redéploie après tout changement de variable, puis réinstalle le webhook." };
  }
  if (wrong.status === 403 && right.status === 200) {
    return { id: "probe", label, status: "ok", detail: "Joignable : refuse un mauvais secret (403), accepte le bon (200)." };
  }
  return { id: "probe", label, status: "warn", detail: `Réponses inattendues : mauvais secret → ${wrong.status}, bon secret → ${right.status}.` };
}

// ── 5. Base de données ─────────────────────────────────────────────────
export function interpretTables(res: { error?: { code?: string; message: string }; lastUpdateAt?: string | null }): Check {
  const label = "Tables du bot (phase15.sql)";
  if (res.error) {
    const missing = res.error.code === "42P01" || /does not exist|schema cache|could not find/i.test(res.error.message);
    return {
      id: "db.tables", label, status: "fail",
      detail: missing ? "La table telegram_updates n'existe pas." : res.error.message,
      fix: missing ? "Exécute supabase/phase15.sql dans le SQL Editor de Supabase." : "Vérifie SUPABASE_SERVICE_ROLE_KEY.",
    };
  }
  return res.lastUpdateAt
    ? { id: "db.tables", label, status: "ok", detail: `Tables présentes. Dernier message traité : ${new Date(res.lastUpdateAt).toLocaleString("fr-FR", { timeZone: "Africa/Douala" })}.` }
    : { id: "db.tables", label, status: "warn", detail: "Tables présentes, mais aucun de tes messages n'a jamais été traité par l'app : le message n'arrive pas jusqu'au bot, ou ton ID Telegram est mal configuré." };
}

export function interpretOwnerUser(found: boolean): Check {
  return found
    ? { id: "db.owner", label: "Compte propriétaire retrouvé", status: "ok", detail: "L'email OWNER_EMAIL correspond à un utilisateur Supabase." }
    : { id: "db.owner", label: "Compte propriétaire retrouvé", status: "fail", detail: "Aucun utilisateur Supabase ne correspond à OWNER_EMAIL.", fix: "Vérifie que OWNER_EMAIL est exactement l'email de ton compte (Authentication > Users)." };
}

// ── 5b. La clé IA est-elle acceptée par le fournisseur ? ───────────────
// Test gratuit : on liste les modèles (aucun jeton consommé).
export function interpretLlmKey(provider: "anthropic" | "mistral", status: number | null, error?: string): Check {
  const label = `Clé ${provider === "mistral" ? "Mistral" : "Anthropic"} acceptée par le fournisseur`;
  const name = provider === "mistral" ? "MISTRAL_API_KEY" : "ANTHROPIC_API_KEY";
  if (status === null) return { id: "llm.key", label, status: "warn", detail: `Impossible de joindre le fournisseur : ${error ?? "pas de réponse"}.` };
  if (status >= 200 && status < 300) return { id: "llm.key", label, status: "ok", detail: "Clé valide." };
  if (status === 401 || status === 403) return { id: "llm.key", label, status: "fail", detail: `Clé refusée (${status}) : invalide, révoquée ou mal copiée.`, fix: `Recrée la clé, mets-la dans ${name} sur Vercel (sans espace ni guillemet) et redéploie.` };
  if (status === 429) return { id: "llm.key", label, status: "warn", detail: "Trop de requêtes ou quota atteint (429).", fix: "Vérifie ton forfait et ta facturation chez le fournisseur." };
  return { id: "llm.key", label, status: "warn", detail: `Réponse inattendue (${status}).` };
}

// ── 5c. Le MODÈLE est-il autorisé par le forfait ? ──────────────────────
// Une clé valide ne suffit pas : Mistral refuse (403 tier_not_allowed) les
// modèles non inclus dans le forfait. On fait un vrai appel d'1 jeton.
export function interpretLlmModel(model: string, main: ModelProbe, fallback?: ModelProbe, fallbackModel: string = MISTRAL_DEFAULT_MODEL): Check {
  const label = `Modèle Mistral utilisable (${model})`;
  const tier = (p: ModelProbe) => p.status === 403 && /tier_not_allowed|subscription tier/i.test(p.body ?? "");
  if (main.status === null) return { id: "llm.model", label, status: "warn", detail: `Impossible de tester le modèle : ${main.error ?? "pas de réponse"}.` };
  if (main.status >= 200 && main.status < 300) return { id: "llm.model", label, status: "ok", detail: "Le modèle répond." };
  const zero = main.status === 429 && main.headers?.["x-ratelimit-limit-req-minute"] === "0";
  if (tier(main) || zero) {
    if (fallback && fallback.status !== null && fallback.status >= 200 && fallback.status < 300) {
      return {
        id: "llm.model", label, status: "warn",
        detail: zero
          ? `Ton compte a un quota de 0 requête/minute sur ce modèle (typique du forfait gratuit). L'app bascule automatiquement sur ${fallbackModel}, qui fonctionne.`
          : `Ce modèle n'est pas inclus dans ton forfait Mistral. L'app bascule automatiquement sur ${fallbackModel}, qui fonctionne.`,
        fix: `Pour retirer cet avertissement et gagner un aller-retour par message, mets MISTRAL_MODEL=${fallbackModel} sur Vercel.`,
      };
    }
    const hdr = main.headers && Object.keys(main.headers).length ? ` (${Object.entries(main.headers).map(([k, v]) => `${k}=${v}`).join(", ")})` : "";
    return { id: "llm.model", label, status: "fail", detail: zero ? `Quota de 0 requête/minute sur ${model}${hdr} et aucun modèle de secours ne répond.` : `Ni ${model} ni les modèles de secours ne sont autorisés par ton forfait Mistral.`, fix: "Clique sur « Chercher un modèle qui marche », ou vérifie ton forfait sur admin.mistral.ai (Limits, Subscription)." };
  }
  if (main.status === 404 || (main.status === 400 && /model/i.test(main.body ?? ""))) return { id: "llm.model", label, status: "fail", detail: "Ce nom de modèle n'existe pas chez Mistral.", fix: `Corrige MISTRAL_MODEL (ex. ${MISTRAL_DEFAULT_MODEL}) ou supprime la variable.` };
  if (main.status === 401) return { id: "llm.model", label, status: "fail", detail: "Clé refusée (401).", fix: "Voir la ligne précédente sur la clé." };
  if (main.status === 429) {
    const h = main.headers && Object.keys(main.headers).length ? ` En-têtes de limite renvoyés par Mistral : ${Object.entries(main.headers).map(([k, v]) => `${k}=${v}`).join(", ")}.` : "";
    return {
      id: "llm.model", label, status: "fail",
      detail: `Mistral refuse (429) même une requête d'UN seul jeton, après plusieurs essais espacés : ce n'est donc pas la limite d'1 requête/seconde. Le quota de ton espace de travail est nul ou épuisé pour ce modèle.${h}`,
      fix: "Clique sur « Chercher un modèle qui marche ». Sinon, sur admin.mistral.ai : page Limits (tes quotas), Usage (consommation) et Subscription (le forfait gratuit peut exiger la vérification du téléphone ou l'acceptation de l'utilisation des données).",
    };
  }
  return { id: "llm.model", label, status: "warn", detail: `Réponse inattendue (${main.status}) : ${(main.body ?? "").slice(0, 160)}` };
}

// ── 6. Envoi d'un message test ─────────────────────────────────────────
export function interpretSend(res: { ok: true } | { ok: false; error: string } | null): Check {
  const label = "Message test envoyé sur ton Telegram";
  if (res === null) return { id: "send", label, status: "skip", detail: "Non lancé. Clique sur « Envoyer un message test »." };
  if (!("error" in res)) return { id: "send", label, status: "ok", detail: "Envoyé : regarde ton Telegram. Le bot peut donc t'écrire." };
  if (/chat not found/i.test(res.error)) return { id: "send", label, status: "fail", detail: "Telegram ne trouve pas ce chat : TELEGRAM_OWNER_ID est faux, ou tu n'as jamais ouvert ce bot.", fix: "Ouvre le bot, appuie sur Démarrer, et vérifie que TELEGRAM_OWNER_ID est bien ton ID." };
  if (/blocked/i.test(res.error)) return { id: "send", label, status: "fail", detail: "Tu as bloqué ce bot.", fix: "Débloque-le dans Telegram." };
  if (/unauthorized/i.test(res.error)) return { id: "send", label, status: "fail", detail: "Token refusé.", fix: "Voir la ligne « Token accepté par Telegram »." };
  return { id: "send", label, status: "fail", detail: res.error };
}

// ── Synthèse ───────────────────────────────────────────────────────────
export function summarize(checks: Check[]): { level: "ok" | "warn" | "fail"; headline: string; firstProblem: Check | null } {
  const fail = checks.find((c) => c.status === "fail");
  if (fail) return { level: "fail", headline: `Cause probable : ${fail.label}`, firstProblem: fail };
  const warn = checks.find((c) => c.status === "warn");
  if (warn) return { level: "warn", headline: `À vérifier : ${warn.label}`, firstProblem: warn };
  return { level: "ok", headline: "Tout est correct côté configuration", firstProblem: null };
}

// ── Recherche d'un modèle Mistral qui fonctionne ───────────────────────
// Modèles inadaptés à un assistant conversationnel avec outils : code, complétion,
// embeddings, modération, OCR, audio, raisonnement (réponses en blocs « pensée »).
const NOT_FOR_AGENT = /embed|moderation|ocr|voxtral|transcri|realtime|code|codestral|devstral|fim|mathstral|magistral|classif/i;

const STATIC_CANDIDATES = ["mistral-small-latest", "ministral-14b-latest", "ministral-8b-latest", "mistral-medium-latest", "open-mistral-nemo", "ministral-3b-latest", "mistral-large-latest"];

// Garde les modèles de chat compatibles « outils » (indispensables à l'agent),
// écarte embeddings / modération / OCR / audio / modèles dépréciés. Modèle actuel
// et modèle par défaut en premier. Si la liste est inconnue → liste statique.
export function pickCandidateModels(list: MistralModelInfo[] | null, current: string, max = 7): string[] {
  const out: string[] = [];
  const add = (m: string) => { if (m && !out.includes(m)) out.push(m); };
  add(current); add(MISTRAL_DEFAULT_MODEL);
  if (list && list.length) {
    const usable = list.filter((m) =>
      m.capabilities?.completion_chat !== false && m.capabilities?.function_calling !== false &&
      !m.deprecation && !NOT_FOR_AGENT.test(m.id));
    usable.filter((m) => /-latest$/.test(m.id)).forEach((m) => add(m.id));
    usable.filter((m) => !/-latest$/.test(m.id)).forEach((m) => add(m.id));
  } else {
    STATIC_CANDIDATES.forEach(add);
  }
  return out.slice(0, max);
}

export type ScanResult = { model: string; status: number | null; ok: boolean; verdict: string };
export function classifyProbe(model: string, p: ModelProbe): ScanResult {
  const st = p.status;
  if (st !== null && st >= 200 && st < 300) return { model, status: st, ok: true, verdict: "Répond ✔" };
  if (st === 403 && /tier_not_allowed|subscription tier/i.test(p.body ?? "")) return { model, status: st, ok: false, verdict: "Non inclus dans ton forfait" };
  if (st === 429) return { model, status: st, ok: false, verdict: "Quota / limite atteint (429)" };
  if (st === 404) return { model, status: st, ok: false, verdict: "Modèle introuvable" };
  if (st === 401) return { model, status: st, ok: false, verdict: "Clé refusée" };
  if (st === null) return { model, status: st, ok: false, verdict: `Erreur réseau : ${p.error ?? "?"}` };
  return { model, status: st, ok: false, verdict: `Réponse ${st}` };
}

// Plus petit = meilleur choix pour un assistant conversationnel avec outils.
export function modelRank(id: string): number {
  const order = [/mistral-large/, /mistral-medium/, /mistral-small/, /ministral-14b/, /ministral-8b/, /open-mistral-nemo|mistral-nemo/, /ministral-3b/];
  const i = order.findIndex((re) => re.test(id));
  return i === -1 ? 10 : i;
}

export function summarizeScan(results: ScanResult[], current: string): { level: "ok" | "warn" | "fail"; message: string; recommended: string | null } {
  const working = results.filter((r) => r.ok);
  if (working.length === 0) {
    const all429 = results.length > 0 && results.every((r) => r.status === 429);
    return {
      level: "fail", recommended: null,
      message: all429
        ? "Aucun modèle ne répond : Mistral renvoie 429 sur tous. La limite est au niveau de ton COMPTE (pas d'un modèle). Vérifie admin.mistral.ai > Limits, Usage et Subscription (téléphone à vérifier, acceptation des données pour le forfait gratuit), ou passe à un forfait payant. En attendant, tu peux utiliser une clé Anthropic (ANTHROPIC_API_KEY), que l'agent sait aussi utiliser."
        : "Aucun modèle ne répond avec cette clé. Regarde le détail de chaque ligne ci-dessous.",
    };
  }
  if (working.some((r) => r.model === current)) return { level: "ok", recommended: current, message: `Ton modèle actuel (${current}) fonctionne.` };
  const best = [...working].sort((a, b) => modelRank(a.model) - modelRank(b.model))[0].model;
  return { level: "warn", recommended: best, message: `${current} ne répond pas, mais ${best} oui. Mets MISTRAL_MODEL=${best} sur Vercel puis redéploie.` };
}
