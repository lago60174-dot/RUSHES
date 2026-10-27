// Diagnostic de l'inbox (réponses aux commentaires et messages privés). Logique pure.
import type { Check } from "@/lib/telegram-diagnose";
import type { InboxSettings } from "@/lib/inbox";
import { INBOX_EVENTS } from "@/lib/zernio-diagnose";

export type InboxStats = {
  total: number;
  comments: number;
  dms: number;
  byStatus: Record<string, number>;
  lastReceivedAt: string | null;
  stuckNew: number;          // « new » : le tri IA n'a pas abouti (ou pas encore eu lieu)
  stuckErrors: string[];     // messages d'erreur distincts de ces éléments
  failedErrors: string[];    // erreurs d'envoi des réponses
};

export function interpretInboxSettings(s: InboxSettings): Check {
  const label = "Réglages de l'agent d'inbox";
  if (!s.enabled) {
    return { id: "i.settings", label, status: "fail", detail: "L'agent d'inbox est DÉSACTIVÉ : aucun commentaire ni message n'est traité.", fix: "Écris au bot « active l'inbox », ou règle-le dans l'app." };
  }
  if (!s.autoReply) {
    return { id: "i.settings", label, status: "ok", detail: "Actif, mais les réponses automatiques sont désactivées : chaque commentaire et message t'est proposé à valider dans Telegram, avec un brouillon." };
  }
  return {
    id: "i.settings", label, status: "ok",
    detail: `Actif. Il répond SEUL uniquement aux cas simples (compliments, remerciements, emojis) quand l'IA est sûre à 80 % ou plus, sans lien, @mention, numéro ni mot sensible (prix, collab, devis, argent…), dans la limite de ${s.maxAutoPerHour} par heure. Tout le reste t'arrive dans Telegram avec un brouillon et trois boutons : ✅ Envoyer, ↻ Autre, 🚫 Ignorer. Le spam est écarté.`,
  };
}

export function interpretInboxLlm(configured: boolean, provider: string | null): Check {
  const label = "IA qui trie et rédige les réponses";
  return configured
    ? { id: "i.llm", label, status: "ok", detail: `Fournisseur : ${provider ?? "?"}. (Si l'IA est bloquée, voir la ligne « Modèle Mistral » du diagnostic Telegram.)` }
    : { id: "i.llm", label, status: "fail", detail: "Aucune clé IA : impossible de trier ni de rédiger.", fix: "Ajoute MISTRAL_API_KEY (ou ANTHROPIC_API_KEY) sur Vercel et redéploie." };
}

export function interpretInboxAccounts(count: number | null): Check {
  const label = "Réseaux sociaux connectés";
  if (count === null) return { id: "i.accounts", label, status: "warn", detail: "Impossible de lire les comptes chez Zernio." };
  if (count === 0) return { id: "i.accounts", label, status: "fail", detail: "AUCUN réseau n'est connecté sur ton compte Zernio : aucun commentaire ni message ne peut arriver.", fix: "Reconnecte tes comptes via « Réseaux sociaux » dans l'app." };
  return { id: "i.accounts", label, status: "ok", detail: `${count} réseau(x) connecté(s).` };
}

export function interpretInboxEvents(w: { found: boolean; events: string[] } | null): Check {
  const label = "Zernio envoie-t-il les commentaires et messages à ton app ?";
  if (w === null) return { id: "i.events", label, status: "skip", detail: "Liste des webhooks Zernio indisponible." };
  if (!w.found) return { id: "i.events", label, status: "fail", detail: "Aucun webhook Zernio ne pointe vers ton app : rien n'arrive en temps réel.", fix: "Voir la ligne « Webhook déclaré dans Zernio » du diagnostic Zernio." };
  if (w.events.length === 0) return { id: "i.events", label, status: "warn", detail: "Webhook trouvé, mais Zernio n'indique pas la liste de ses évènements : impossible de confirmer." };
  const missing = INBOX_EVENTS.filter((e) => !w.events.includes(e));
  if (missing.length === 0) return { id: "i.events", label, status: "ok", detail: "Le webhook écoute comment.received, message.received et message.sent." };
  const noDm = missing.includes("message.received");
  return {
    id: "i.events", label, status: "fail",
    detail: `Le webhook n'écoute pas : ${missing.join(", ")}. ${noDm ? "Les messages privés ne seront JAMAIS reçus (ils n'arrivent que par webhook). " : ""}${missing.includes("comment.received") ? "Les commentaires ne seront relevés que par le contrôle automatique toutes les 30 minutes (posts publiés depuis moins de 14 jours)." : ""}`.trim(),
    fix: `Dans Zernio > Webhooks, ajoute les évènements : ${missing.join(", ")}.`,
  };
}

export function interpretInboxTelegram(configured: boolean, ownerSet: boolean): Check {
  const label = "Validation des réponses dans Telegram";
  return configured && ownerSet
    ? { id: "i.telegram", label, status: "ok", detail: "Les éléments à valider arrivent dans ton Telegram, avec boutons (et par notification dans l'app)." }
    : { id: "i.telegram", label, status: "warn", detail: "Telegram n'est pas complètement configuré : les éléments à valider n'arriveront que par notification dans l'app.", fix: "Configure TELEGRAM_BOT_TOKEN et TELEGRAM_OWNER_ID (voir le diagnostic du bot)." };
}

const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleString("fr-FR", { timeZone: "Africa/Douala" }) : "—";

export function interpretInboxActivity(st: InboxStats): Check {
  const label = "Activité des 14 derniers jours";
  if (st.total === 0) {
    return { id: "i.activity", label, status: "warn", detail: "Aucun commentaire ni message reçu. Normal si aucun réseau n'est connecté ou si rien n'a été publié ; sinon, vérifie les lignes précédentes." };
  }
  const n = (k: string) => st.byStatus[k] ?? 0;
  return {
    id: "i.activity", label, status: "ok",
    detail: `${st.total} reçu(s) (${st.comments} commentaire(s), ${st.dms} message(s) privé(s)), dernier le ${fmtDate(st.lastReceivedAt)}. Répondus automatiquement : ${n("auto_replied")} · répondus par toi : ${n("replied")} · EN ATTENTE DE TA VALIDATION : ${n("pending_approval")} · écartés (spam ou inutile) : ${n("ignored")} · échecs d'envoi : ${n("failed")} · pas encore triés : ${n("new")}.`,
  };
}

export function interpretInboxStuck(st: InboxStats): Check {
  const label = "Éléments que l'IA n'a pas réussi à trier";
  if (st.stuckNew === 0) return { id: "i.stuck", label, status: "ok", detail: "Aucun élément bloqué." };
  const err = st.stuckErrors[0] ? ` Dernière erreur : « ${st.stuckErrors[0].slice(0, 160)} ».` : "";
  return {
    id: "i.stuck", label, status: "warn",
    detail: `${st.stuckNew} élément(s) attendent un tri IA et n'ont pas encore reçu de réponse ni de brouillon.${err}`,
    fix: "Ils sont retentés automatiquement toutes les 30 minutes (et signalés à valider après 24 h). Pour les relancer maintenant : « Relancer le tri ». Si l'erreur parle de quota, voir le diagnostic du bot.",
  };
}

export function interpretInboxFailed(st: InboxStats): Check {
  const label = "Réponses que le réseau a refusées";
  const f = st.byStatus["failed"] ?? 0;
  if (f === 0) return { id: "i.failed", label, status: "ok", detail: "Aucune réponse refusée." };
  const err = st.failedErrors[0] ? ` Dernière erreur : « ${st.failedErrors[0].slice(0, 200)} ».` : "";
  return { id: "i.failed", label, status: "fail", detail: `${f} réponse(s) n'ont pas pu être envoyées.${err}`, fix: "Souvent : compte à reconnecter (permissions) ou commentaire supprimé. Reconnecte le compte dans « Réseaux sociaux » puis réessaie." };
}

export function interpretInboxTables(missing: boolean, message?: string): Check | null {
  if (!missing) return null;
  return { id: "i.tables", label: "Table de l'inbox (phase14.sql)", status: "fail", detail: message ?? "La table inbox_items n'existe pas.", fix: "Exécute supabase/phase14.sql dans le SQL Editor de Supabase." };
}

export function interpretInboxRetry(r: { retried: number; escalated: number; stuck: number } | null): Check {
  const label = "Relance du tri";
  if (r === null) return { id: "i.retry", label, status: "skip", detail: "Non lancée. Clique sur « Relancer le tri »." };
  if (r.stuck === 0) return { id: "i.retry", label, status: "ok", detail: "Rien à relancer." };
  return { id: "i.retry", label, status: "ok", detail: `${r.retried} élément(s) retraité(s) sur ${r.stuck}${r.escalated ? `, ${r.escalated} passé(s) en validation manuelle` : ""}. Relance le diagnostic pour voir le résultat.` };
}

// Agrège les lignes brutes de la table (pure : testable sans base).
export function aggregateInbox(rows: Array<{ kind: string; status: string; error: string | null; received_at: string }>): InboxStats {
  const byStatus: Record<string, number> = {};
  let comments = 0, dms = 0, lastReceivedAt: string | null = null;
  const stuckErrors = new Set<string>(), failedErrors = new Set<string>();
  let stuckNew = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.kind === "dm") dms += 1; else comments += 1;
    if (!lastReceivedAt || r.received_at > lastReceivedAt) lastReceivedAt = r.received_at;
    if (r.status === "new") { stuckNew += 1; if (r.error) stuckErrors.add(r.error); }
    if (r.status === "failed" && r.error) failedErrors.add(r.error);
  }
  return { total: rows.length, comments, dms, byStatus, lastReceivedAt, stuckNew, stuckErrors: [...stuckErrors].slice(0, 3), failedErrors: [...failedErrors].slice(0, 3) };
}
