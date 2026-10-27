// Filet de sécurité contre les inventions de l'agent (petit modèle qui « joue » une
// action au lieu de l'exécuter). Pur et testable : aucune requête ici.
//
// Deux fautes sont détectées, et seulement elles (pour éviter les faux positifs) :
//  1. un IDENTIFIANT (uuid) qui n'apparaît ni dans le message de l'utilisateur, ni dans
//     l'historique, ni dans le résultat d'un outil : il est forcément inventé ;
//  2. une action annoncée comme faite (« ✅ … ajoutée », « j'ai publié… ») alors
//     qu'AUCUN outil n'a été appelé pendant ce tour.
// Les vidéos reçues sont stockées par l'APPLICATION (pas par un outil) : quand le message
// commence par « [Vidéo reçue », confirmer le stockage est légitime.

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const CLAIM_RE = /(?:✅|☑️|✔️)[^\n]*?\b(ajout|enregistr|sauvegard|stock|publi|programm|planifi|supprim|envoy|d[ée]connect|synchronis)\w*|\b(?:j'ai|je viens de|c'est fait)\s+(?:bien\s+)?(ajout|enregistr|sauvegard|stock|publi|programm|planifi|supprim|envoy|d[ée]connect|synchronis)\w*/i;
const STORAGE_VERB_RE = /^(ajout|enregistr|sauvegard|stock)/i;

export type GuardInput = {
  answer: string;
  userText: string;        // message de l'utilisateur de ce tour
  history: string[];       // textes des messages précédents
  toolNames: string[];     // outils appelés avec succès pendant ce tour
  toolOutputs: string;     // concaténation de leurs résultats
};
export type GuardVerdict = null | "invented_id" | "invented_action";

export function findUnverifiedClaim(g: GuardInput): GuardVerdict {
  const known = `${g.userText}\n${g.history.join("\n")}\n${g.toolOutputs}`.toLowerCase();

  for (const id of g.answer.match(UUID_RE) ?? []) {
    if (!known.includes(id.toLowerCase())) return "invented_id";
  }

  if (g.toolNames.length === 0) {
    const m = CLAIM_RE.exec(g.answer);
    if (m) {
      const verb = m[1] ?? m[2] ?? "";
      const storedByApp = /^\[Vidéo reçue/i.test(g.userText.trim()) && STORAGE_VERB_RE.test(verb);
      if (!storedByApp) return "invented_action";
    }
  }
  return null;
}

export const GUARD_MESSAGE =
  "Je me suis mal exprimé : je n'ai lancé aucune action, donc rien n'a été ajouté, publié ni programmé, et je n'ai pas d'identifiant à te donner. " +
  "Pour voir ce qui est réellement enregistré, demande-moi « montre mes vidéos en attente ». " +
  "Pour mettre une vidéo sur ton stockage R2, envoie-la ici comme fichier vidéo : elle y part automatiquement. Ensuite, dis-moi où et quand la publier.";
