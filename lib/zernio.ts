import { createHmac, timingSafeEqual } from "crypto";

const ZERNIO_BASE = "https://zernio.com/api/v1";

function zernioHeaders() {
  return {
    Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`,
    "Content-Type": "application/json",
  };
}

type FollowerStats = {
  followerCount: number;
  followingCount: number;
  likesCount: number;
  videoCount: number;
  followersGained: number | null;
  followersLost: number | null;
  // Facebook et YouTube uniquement : ni l'un ni l'autre n'expose de "likes
  // cumulés" ni de "nombre de vidéos" au niveau compte (contrairement à
  // TikTok) — page_views (Facebook) ou vues du channel sur 30j (YouTube)
  // est la métrique la plus proche d'un indicateur d'audience globale.
  pageViews?: number;
};

function normalizeFollowerStats(raw: Record<string, unknown> | undefined | null): FollowerStats {
  return {
    followerCount: Number(raw?.followerCount ?? raw?.follower_count ?? 0),
    followingCount: Number(raw?.followingCount ?? raw?.following_count ?? 0),
    likesCount: Number(raw?.likesCount ?? raw?.likes_count ?? 0),
    videoCount: Number(raw?.videoCount ?? raw?.video_count ?? 0),
    followersGained: (raw?.followersGained ?? raw?.followers_gained ?? null) as number | null,
    followersLost: (raw?.followersLost ?? raw?.followers_lost ?? null) as number | null,
  };
}

// TikTok expose ses compteurs de compte (abonnés / likes cumulés / vidéos)
// via un endpoint dédié côté Zernio (/analytics/tiktok/account-insights),
// séparé de l'endpoint générique /accounts/follower-stats qui semble ne pas
// couvrir TikTok.
// ⚠️ Mise à jour d'après le changelog Zernio (24 avril 2026) : les
// "key params" documentés sont accountId, metrics, since, until, metricType
// — la version précédente n'envoyait QUE accountId. C'est très probablement
// la vraie cause des 0/0 : la requête réussissait (200) mais sans préciser
// quelles métriques on voulait, Zernio ne renvoyait rien d'exploitable.
// Le changelog précise aussi que cet endpoint réutilise la même enveloppe de
// réponse que /analytics/instagram/account-insights, qui structure les
// métriques par nom (pas forcément des champs plats followerCount /
// follower_count) — le parsing ci-dessous gère donc plusieurs formes
// possibles, faute de pouvoir tester la forme exacte avec une vraie clé API.
async function zernioGetTikTokAccountInsights(accountId: string): Promise<FollowerStats> {
  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - 30);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    accountId,
    metrics: "follower_count,following_count,likes_count,video_count",
    metricType: "totalvalue",
    since: fmt(since),
    until: fmt(until),
  });

  const res = await fetch(`${ZERNIO_BASE}/analytics/tiktok/account-insights?${params.toString()}`, {
    headers: zernioHeaders(),
  });
  if (!res.ok) {
    console.error(`[zernio] account-insights (tiktok) HTTP ${res.status} pour accountId=${accountId}`);
    throw new Error(`Zernio account-insights error: ${res.status}`);
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Zernio est indisponible (réponse invalide sur /analytics/tiktok/account-insights).");
  const stats = extractTikTokStatsFromAnyShape(data);
  // Diagnostic : si la requête réussit (200) mais que tout reste à zéro, la
  // cause la plus probable est une forme d'enveloppe différente de celles
  // gérées ci-dessous — on logge la réponse brute pour corriger le mapping
  // avec certitude au prochain passage, plutôt que de deviner une 3e fois.
  if (stats.followerCount === 0 && stats.likesCount === 0 && stats.videoCount === 0) {
    console.error(
      `[zernio] account-insights (tiktok) a renvoyé des zéros pour accountId=${accountId}. Réponse brute :`,
      JSON.stringify(data).slice(0, 2000)
    );
  }
  return stats;
}

// Essaie plusieurs formes d'enveloppe possibles pour account-insights,
// faute de forme 100% confirmée pour la variante TikTok :
//  1. Enveloppe "totalValue" façon Instagram Analytics :
//     { data: [ { name: "follower_count", totalValue: { value: N } }, ... ] }
//  2. Objet "metrics" à plat : { metrics: { follower_count: N, ... } }
//  3. Plate (ancienne hypothèse, gardée en dernier recours) :
//     { followerCount, followingCount, ... } ou nichée sous
//     accounts[0] / insights / stats
function extractTikTokStatsFromAnyShape(raw: Record<string, unknown>): FollowerStats {
  const list = Array.isArray(raw?.data)
    ? (raw.data as Record<string, unknown>[])
    : Array.isArray(raw?.metrics)
      ? (raw.metrics as Record<string, unknown>[])
      : null;

  if (list) {
    const byName: Record<string, unknown> = {};
    for (const m of list) {
      const name = (m?.name as string | undefined) ?? (m?.metric as string | undefined);
      if (!name) continue;
      const totalValue = m?.totalValue as Record<string, unknown> | undefined;
      const totalValueSnake = m?.total_value as Record<string, unknown> | undefined;
      byName[name] = totalValue?.value ?? totalValueSnake?.value ?? m?.value ?? null;
    }
    return normalizeFollowerStats(byName);
  }

  if (raw?.metrics && typeof raw.metrics === "object" && !Array.isArray(raw.metrics)) {
    return normalizeFollowerStats(raw.metrics as Record<string, unknown>);
  }

  const flat = Array.isArray(raw?.accounts)
    ? (raw.accounts as Record<string, unknown>[])[0]
    : ((raw?.insights ?? raw?.stats ?? raw) as Record<string, unknown>);
  return normalizeFollowerStats(flat);
}

// Facebook expose ses compteurs de Page (abonnés / vues) via un endpoint
// dédié côté Zernio, comme TikTok — mais avec des métriques différentes.
// ✅ Endpoint confirmé via le SDK PHP officiel Zernio (zernio-dev/zernio-php) :
// GET /v1/analytics/facebook/page-insights.
// ⚠️ Contrairement à TikTok, Facebook n'a PAS de "likes cumulés" ni de
// "nombre de vidéos" au niveau Page — ces concepts n'existent pas côté Meta
// à ce niveau. On ne renvoie donc que abonnés + vues (likesCount/videoCount
// restent à 0 pour Facebook, ce n'est pas un bug).
// ⚠️ Important : Meta a déprécié les anciennes métriques `page_fans` et
// `page_impressions` le 15 novembre 2025 (annonce officielle Meta for
// Developers). Les appeler renvoie désormais une erreur "invalid metric".
// La doc Zernio confirme que cet endpoint utilise déjà les nouveaux noms
// post-dépréciation — on utilise donc directement les remplaçants
// officiels : `page_follows` (remplace page_fans) et `page_media_view`
// (remplace page_impressions).
async function zernioGetFacebookPageInsights(accountId: string): Promise<FollowerStats> {
  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - 30);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    accountId,
    metrics: "page_follows,page_media_view",
    since: fmt(since),
    until: fmt(until),
  });

  const res = await fetch(`${ZERNIO_BASE}/analytics/facebook/page-insights?${params.toString()}`, {
    headers: zernioHeaders(),
  });
  if (!res.ok) {
    console.error(`[zernio] page-insights (facebook) HTTP ${res.status} pour accountId=${accountId}`);
    throw new Error(`Zernio page-insights error: ${res.status}`);
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Zernio est indisponible (réponse invalide sur /analytics/facebook/page-insights).");

  const stats = extractFacebookStatsFromAnyShape(data);
  if (stats.followerCount === 0 && !stats.pageViews) {
    console.error(
      `[zernio] page-insights (facebook) a renvoyé des zéros pour accountId=${accountId}. Réponse brute :`,
      JSON.stringify(data).slice(0, 2000)
    );
  }
  return stats;
}

// Même logique de tolérance de forme que extractTikTokStatsFromAnyShape
// (voir ce commentaire ci-dessus) — Zernio réutilise la même famille
// d'enveloppes de réponse pour tous ses endpoints "*-insights".
function extractFacebookStatsFromAnyShape(raw: Record<string, unknown>): FollowerStats {
  const list = Array.isArray(raw?.data)
    ? (raw.data as Record<string, unknown>[])
    : Array.isArray(raw?.metrics)
      ? (raw.metrics as Record<string, unknown>[])
      : null;

  const byName: Record<string, unknown> = {};
  if (list) {
    for (const m of list) {
      const name = (m?.name as string | undefined) ?? (m?.metric as string | undefined);
      if (!name) continue;
      const totalValue = m?.totalValue as Record<string, unknown> | undefined;
      const totalValueSnake = m?.total_value as Record<string, unknown> | undefined;
      byName[name] = totalValue?.value ?? totalValueSnake?.value ?? m?.value ?? null;
    }
  } else if (raw?.metrics && typeof raw.metrics === "object" && !Array.isArray(raw.metrics)) {
    Object.assign(byName, raw.metrics as Record<string, unknown>);
  } else {
    const flat = Array.isArray(raw?.accounts)
      ? (raw.accounts as Record<string, unknown>[])[0]
      : ((raw?.insights ?? raw?.stats ?? raw) as Record<string, unknown>);
    Object.assign(byName, flat);
  }

  const followerCount = Number(
    byName.page_follows ?? byName.pageFollows ?? byName.followerCount ?? byName.follower_count ?? 0
  );
  const pageViews = Number(byName.page_media_view ?? byName.pageMediaView ?? 0) || undefined;

  return {
    followerCount,
    followingCount: 0,
    likesCount: 0,
    videoCount: 0,
    followersGained: (byName.followersGained ?? byName.followers_gained ?? null) as number | null,
    followersLost: (byName.followersLost ?? byName.followers_lost ?? null) as number | null,
    pageViews,
  };
}

// Endpoint générique (comptes hors TikTok/Facebook, ou fallback si l'endpoint
// spécifique échoue).
async function zernioGetGenericFollowerStats(accountId: string): Promise<FollowerStats> {
  const res = await fetch(`${ZERNIO_BASE}/accounts/follower-stats?accountId=${accountId}`, {
    headers: zernioHeaders(),
  });
  if (!res.ok) {
    console.error(`[zernio] follower-stats (générique) HTTP ${res.status} pour accountId=${accountId}`);
    throw new Error(`Zernio follower-stats error: ${res.status}`);
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Zernio est indisponible (réponse invalide sur /accounts/follower-stats).");
  const raw = Array.isArray(data.accounts) ? data.accounts[0] : (data.stats ?? data);
  const stats = normalizeFollowerStats(raw);
  if (stats.followerCount === 0 && stats.likesCount === 0 && stats.videoCount === 0) {
    console.error(
      `[zernio] follower-stats (générique) a renvoyé des zéros pour accountId=${accountId}. Réponse brute :`,
      JSON.stringify(data).slice(0, 2000)
    );
  }
  return stats;
}

// YouTube expose ses abonnés/vues différemment des autres plateformes :
// ✅ Endpoint confirmé mot pour mot via docs.zernio.com/analytics/get-youtube-channel-insights :
// GET /v1/analytics/youtube/channel-insights.
// ⚠️ Piège important : CET endpoint ne donne PAS le nombre d'abonnés actuel
// — seulement des deltas (subscribersGained/subscribersLost) sur une
// période. Pour le nombre d'abonnés actuel, il faut passer par l'endpoint
// générique /v1/accounts/follower-stats (celui déjà utilisé comme fallback
// pour les autres plateformes), qui lui renvoie bien un total. On combine
// donc les deux : abonnés via l'endpoint générique, vues (30j) via
// channel-insights.
async function zernioGetYouTubeChannelStats(accountId: string): Promise<FollowerStats> {
  const base = await zernioGetGenericFollowerStats(accountId);

  try {
    const params = new URLSearchParams({ accountId, metrics: "views" });
    const res = await fetch(`${ZERNIO_BASE}/analytics/youtube/channel-insights?${params.toString()}`, {
      headers: zernioHeaders(),
    });
    if (!res.ok) {
      console.error(`[zernio] channel-insights (youtube) HTTP ${res.status} pour accountId=${accountId}`);
      return base;
    }
    const data = await res.json().catch(() => null);
    // Forme confirmée : { metrics: { views: { total, values[], breakdowns[] } } }
    const views = data?.metrics?.views?.total;
    if (typeof views === "number") return { ...base, pageViews: views };
    return base;
  } catch (e) {
    console.error(`[zernio] channel-insights (youtube) erreur pour accountId=${accountId} :`, (e as Error).message);
    return base;
  }
}

// Stats publiques du compte (abonnés, likes cumulés, nb de vidéos, etc.).
// platform est optionnel pour rester compatible avec les appels existants,
// mais il faut le passer pour TikTok, Facebook et YouTube afin d'utiliser
// le bon endpoint dédié pour chacun.
export async function zernioGetFollowerStats(accountId: string, platform?: string) {
  if (platform === "tiktok") {
    try {
      return await zernioGetTikTokAccountInsights(accountId);
    } catch {
      // Si l'endpoint dédié échoue (pas encore actif, mauvaise route, etc.)
      // on retente sur l'endpoint générique plutôt que de tout casser.
      return zernioGetGenericFollowerStats(accountId);
    }
  }
  if (platform === "facebook") {
    try {
      return await zernioGetFacebookPageInsights(accountId);
    } catch {
      return zernioGetGenericFollowerStats(accountId);
    }
  }
  if (platform === "youtube") {
    // zernioGetYouTubeChannelStats gère déjà ses propres erreurs en interne
    // (retombe sur les stats génériques si channel-insights échoue), pas
    // besoin d'un try/catch supplémentaire ici.
    return zernioGetYouTubeChannelStats(accountId);
  }
  return zernioGetGenericFollowerStats(accountId);
}

// Get connected accounts
// Demande une URL d'upload direct (jusqu'à 5 Go) + l'URL publique finale du fichier
export async function zernioGetMediaPresignUrl(filename: string, contentType: string) {
  const res = await fetch(`${ZERNIO_BASE}/media/presign`, {
    method: "POST",
    headers: zernioHeaders(),
    body: JSON.stringify({ filename, contentType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Zernio presign error: ${res.status}`);
  }
  const data = await res.json().catch(() => null);
  if (!data || !data.uploadUrl || !data.publicUrl) {
    throw new Error("Zernio est indisponible ou a renvoyé une réponse invalide. Réessaie dans quelques instants.");
  }
  return data as { uploadUrl: string; publicUrl: string; expires: string };
}

// List all connected social accounts
// Filtre par profileId si fourni (recommandé — voir note sur les profiles
// dans zernioGetConnectUrl) pour être sûr de ne voir que les comptes du bon
// profile, même si la clé API a accès à plusieurs profiles.
export type ZernioAccountRaw = {
  _id: string;
  platform: string;
  name: string;
  username: string;
  profilePicture?: string;
  // ID du profile Zernio qui contient ce compte (normalisé : Zernio peut
  // renvoyer une chaîne ou un objet { _id } selon l'endpoint).
  profileId?: string;
};

export async function zernioListAccounts(profileId?: string): Promise<ZernioAccountRaw[]> {
  const url = profileId
    ? `${ZERNIO_BASE}/accounts?profileId=${encodeURIComponent(profileId)}`
    : `${ZERNIO_BASE}/accounts`;
  const res = await fetch(url, {
    headers: zernioHeaders(),
  });
  if (!res.ok) throw new Error(`Zernio accounts error: ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Zernio est indisponible (réponse invalide sur /accounts).");
  return (data.accounts as Array<Record<string, unknown>>).map((a) => {
    const rawProfile = a.profileId as unknown;
    const pid =
      typeof rawProfile === "string"
        ? rawProfile
        : (rawProfile as { _id?: string; id?: string } | null | undefined)?._id ??
          (rawProfile as { _id?: string; id?: string } | null | undefined)?.id;
    return { ...(a as object), profileId: pid } as ZernioAccountRaw;
  });
}

// Déconnecte et supprime un compte social côté Zernio.
export async function zernioDeleteAccount(accountId: string) {
  const res = await fetch(`${ZERNIO_BASE}/accounts/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
    headers: zernioHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Zernio disconnect error: ${res.status}`);
  }
}

// ⚠️ Règle Zernio : UN SEUL compte par plateforme et par profile. Lancer le
// connect sur un profile qui a déjà un TikTok REMPLACE ce TikTok au lieu d'en
// ajouter un second. Pour avoir plusieurs TikTok / Facebook / etc., il faut un
// profile par compte (les profiles sont gratuits, seuls les comptes sont
// facturés). Cette fonction trouve un profile qui n'a pas encore de compte
// pour cette plateforme — en réutilise un existant s'il y en a un de libre,
// sinon en crée un nouveau.
export async function zernioPickProfileForNewAccount(platform: string): Promise<string> {
  const [profiles, accounts] = await Promise.all([zernioListProfiles(), zernioListAccounts()]);

  const sameplatform = accounts.filter((a) => a.platform === platform);
  // Garde-fou : si on ne sait pas dans quel profile vit un compte existant,
  // on ne peut pas garantir qu'on ne va pas l'écraser → on refuse plutôt que
  // de risquer de perdre un compte.
  if (sameplatform.some((a) => !a.profileId)) {
    throw new Error(
      "Impossible de déterminer le profile Zernio d'un compte existant : connexion annulée pour ne pas l'écraser."
    );
  }
  const taken = new Set(sameplatform.map((a) => a.profileId as string));

  const preferred = process.env.ZERNIO_PROFILE_ID;
  if (preferred && !taken.has(preferred)) return preferred;

  const free = profiles.find((p) => !taken.has(p.id));
  if (free) return free.id;

  const n = sameplatform.length + 1;
  return zernioCreateProfile(`FLARE ${platform} #${n}`);
}

// Get OAuth URL to connect a platform account
// ⚠️ CORRIGÉ (10/07) : ce endpoint attend le vrai profileId Zernio (l'ID du
// "profile" — le conteneur qui regroupe tes comptes sociaux dans Zernio, ex.
// "prof_abc123"), PAS une URL de redirection. L'appelant précédent
// (app/api/zernio/connect/route.ts) passait ici l'URL de callback RUSHES à
// la place du profileId — Zernio recevait donc un profileId invalide et
// rattachait probablement le compte à un profil par défaut plutôt qu'au bon
// profil. C'est très probablement la cause du décalage "Default vs RUSHES"
// et du 404 sur /analytics (la clé API peut être restreinte à un profil
// précis ; un post créé sous le mauvais profil devient invisible pour elle).
// redirectUrl est optionnel et passé séparément via le paramètre redirect_url.
export async function zernioGetConnectUrl(platform: string, profileId: string, redirectUrl?: string) {
  const params = new URLSearchParams({ profileId });
  if (redirectUrl) params.set("redirect_url", redirectUrl);
  const res = await fetch(
    `${ZERNIO_BASE}/connect/${platform}?${params.toString()}`,
    { headers: zernioHeaders() }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Zernio connect error: ${res.status}`);
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Zernio est indisponible (réponse invalide sur /connect).");
  return data.authUrl as string;
}

// Liste les profiles Zernio visibles par la clé API (utile une seule fois
// pour retrouver l'ID du bon profile à mettre dans ZERNIO_PROFILE_ID).
export async function zernioListProfiles() {
  const res = await fetch(`${ZERNIO_BASE}/profiles`, { headers: zernioHeaders() });
  if (!res.ok) throw new Error(`Zernio profiles error: ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Zernio est indisponible (réponse invalide sur /profiles).");
  return (data.profiles as Array<Record<string, unknown>>).map((p) => ({
    id: (p._id ?? p.id) as string,
    name: p.name as string,
    isDefault: Boolean(p.isDefault),
  }));
}

// Crée un profile Zernio (gratuit) et renvoie son ID.
export async function zernioCreateProfile(name: string): Promise<string> {
  const res = await fetch(`${ZERNIO_BASE}/profiles`, {
    method: "POST",
    headers: zernioHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err.error || err.message || `Zernio create profile error: ${res.status}`) +
        " — vérifie que ta clé API Zernio n'est pas restreinte à un seul profile."
    );
  }
  const data = await res.json().catch(() => null);
  const id = data?.profile?._id ?? data?.profile?.id;
  if (!id) throw new Error("Zernio a répondu sans ID de profile.");
  return id as string;
}

// Create a post (publish now or schedule)
export async function zernioCreatePost(params: {
  content: string;
  platforms: Array<{ platform: string; accountId: string }>;
  mediaUrl?: string;
  scheduledFor?: string; // ISO string, omit for immediate publish
  timezone?: string;
}) {
  const body: Record<string, unknown> = {
    content: params.content,
    platforms: params.platforms,
  };
  // Pas de profileId ici : les comptes cibles peuvent vivre dans des profiles
  // différents (un profile par compte supplémentaire d'une même plateforme).
  // Les accountId explicites suffisent à router chaque publication.
  if (params.scheduledFor) {
    body.scheduledFor = params.scheduledFor;
    body.timezone = params.timezone || "UTC";
  } else {
    body.publishNow = true;
  }
  if (params.mediaUrl) {
    // Zernio attend un tableau mediaItems, pas un champ mediaUrl —
    // RUSHES ne publie que des vidéos, donc type est toujours "video" ici.
    body.mediaItems = [{ type: "video", url: params.mediaUrl }];
  }

  const res = await fetch(`${ZERNIO_BASE}/posts`, {
    method: "POST",
    headers: zernioHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // Zernio renvoie son message dans le champ "error", pas "message"
    console.error("[zernio/posts] body envoyé:", JSON.stringify(body), "réponse erreur:", JSON.stringify(err));
    throw new Error(err.error || err.message || `Zernio post error: ${res.status}`);
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Zernio est indisponible (réponse invalide sur /posts).");
  return data.post as { _id: string; [key: string]: unknown };
}

// Récupère l'état actuel d'un post (utilisé par check-status en filet de
// sécurité tant que le webhook n'est pas configuré, ou pour une vérif à la demande).
// ⚠️ Reconstruite à partir de l'usage dans check-status/[videoId]/route.ts —
// vérifie l'URL exacte (`/posts/:id`) et la forme de la réponse dans la doc Zernio.
export async function zernioGetPost(postId: string) {
  const res = await fetch(`${ZERNIO_BASE}/posts/${postId}`, {
    headers: zernioHeaders(),
  });
  if (!res.ok) throw new Error(`Zernio post error: ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Zernio est indisponible (réponse invalide sur /posts/:id).");
  const post = (data.post ?? data) as Record<string, unknown>;
  return post as {
    _id: string;
    status?: string;
    publishedAt?: string;
    platforms?: Array<{
      platform: string;
      accountId?: string | { _id: string };
      status: string;
      errorMessage?: string;
      errorCategory?: string;
    }>;
  };
}

// Vérifie la signature HMAC-SHA256 envoyée par Zernio dans l'en-tête
// x-zernio-signature, calculée sur le corps brut de la requête avec
// ZERNIO_WEBHOOK_SECRET (même valeur que celle configurée dans le dashboard Zernio).
// ⚠️ Reconstruite à partir de l'usage dans webhook/route.ts — le schéma exact
// (algo, format de l'en-tête, préfixe "sha256=" ou non) est à confirmer dans
// la doc Zernio ; adapte si leur implémentation diffère.
export function verifyZernioWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[zernio/webhook] ZERNIO_WEBHOOK_SECRET manquant côté serveur.");
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;

  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

// Get analytics for a specific post.
// ✅ Vérifiée mot pour mot contre docs.zernio.com/analytics/get-analytics —
// contrairement à la version précédente, jamais confirmée en conditions
// réelles. Deux erreurs corrigées :
//  1. L'endpoint est GET /v1/analytics?postId=... (paramètre de requête),
//     PAS /v1/analytics/{postId} (paramètre de chemin, qui n'existe pas et
//     renvoie donc systématiquement 404 — c'est exactement l'erreur "Zernio
//     analytics error: 404" observée dans les logs du cron GitHub Actions).
//  2. La forme de la réponse est complètement différente : un objet
//     `analytics` global + un tableau `platformAnalytics` (pas un objet
//     `platforms` indexé par nom de plateforme).
export async function zernioGetPostAnalytics(postId: string) {
  const res = await fetch(`${ZERNIO_BASE}/analytics?postId=${encodeURIComponent(postId)}`, {
    headers: zernioHeaders(),
  });

  // La doc précise explicitement que ces deux codes sont normaux pour un
  // post qui vient d'être publié : 202 = synchro encore en cours côté
  // Zernio, 424 = aucune plateforme n'a encore pu remonter de stats. Dans
  // les deux cas ce n'est pas une erreur, juste "rien à afficher pour le
  // moment" — le prochain passage du cron réessaiera.
  if (res.status === 202 || res.status === 424) {
    return { postId, platforms: {} as Record<string, Record<string, number>> };
  }
  if (res.status === 402) {
    throw new Error("Zernio : l'add-on Analytics n'est pas activé sur ce compte.");
  }
  if (!res.ok) throw new Error(`Zernio analytics error: ${res.status}`);

  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Zernio est indisponible (réponse invalide sur /analytics).");

  const platforms: Record<string, Record<string, number>> = {};
  const list = Array.isArray(data.platformAnalytics) ? data.platformAnalytics : [];
  for (const p of list) {
    const a = (p?.analytics || {}) as Record<string, number>;
    platforms[p.platform] = {
      views: a.views || a.impressions || 0,
      impressions: a.impressions || 0,
      likes: a.likes || 0,
      comments: a.comments || 0,
      shares: a.shares || 0,
      saves: a.saves || 0,
      // Le follow-count attribué à un post précis n'est pas exposé par
      // Zernio (seul le suivi de compte global l'est, via follower-stats) —
      // ce champ reste donc toujours à 0 ici, ce n'est pas un bug.
      newFollowers: 0,
      // Uniquement disponible pour Instagram Reels ; 0 pour les autres
      // plateformes (dont TikTok) car Zernio n'expose pas cette donnée là.
      avgWatchTime: a.igReelsAvgWatchTime || 0,
      completionRate: 0,
    };
  }

  // Filet de sécurité si jamais platformAnalytics est absent (ne devrait
  // pas arriver d'après la doc, mais évite un objet vide silencieux).
  if (list.length === 0 && data.analytics && data.platform) {
    const a = data.analytics as Record<string, number>;
    platforms[data.platform] = {
      views: a.views || a.impressions || 0,
      likes: a.likes || 0,
      comments: a.comments || 0,
      shares: a.shares || 0,
      saves: a.saves || 0,
      newFollowers: 0,
      avgWatchTime: a.igReelsAvgWatchTime || 0,
      completionRate: 0,
    };
  }

  return { postId, platforms };
}

// Map Zernio analytics to our video schema
// Fonction interne (non exportée — utilisée uniquement par mapZernioAnalyticsMulti ci-dessous)
function mapZernioAnalytics(
  platformData: Record<string, unknown>,
  platform: string
) {
  const d = (platformData[platform] || {}) as Record<string, number>;
  return {
    views: d.views ?? d.impressions ?? 0,
    likes: d.likes ?? 0,
    comments: d.comments ?? 0,
    shares: d.shares ?? 0,
    saves: d.saves ?? 0,
    newFollowers: d.newFollowers ?? 0,
    avgWatchTime: d.avgWatchTime ?? 0,
    completionRate: d.completionRate ?? 0,
  };
}

// Utilisé quand un post a été publié simultanément sur plusieurs réseaux —
// somme les métriques ; avgWatchTime / completionRate sont moyennés plutôt que sommés.
export function mapZernioAnalyticsMulti(
  platformData: Record<string, unknown>,
  platforms: string[]
) {
  const list = platforms.length ? platforms : Object.keys(platformData);
  const totals = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, newFollowers: 0, avgWatchTime: 0, completionRate: 0 };
  let watchSamples = 0;
  for (const platform of list) {
    const m = mapZernioAnalytics(platformData, platform);
    totals.views += m.views;
    totals.likes += m.likes;
    totals.comments += m.comments;
    totals.shares += m.shares;
    totals.saves += m.saves;
    totals.newFollowers += m.newFollowers;
    if (m.avgWatchTime || m.completionRate) {
      totals.avgWatchTime += m.avgWatchTime;
      totals.completionRate += m.completionRate;
      watchSamples += 1;
    }
  }
  if (watchSamples > 0) {
    totals.avgWatchTime = totals.avgWatchTime / watchSamples;
    totals.completionRate = totals.completionRate / watchSamples;
  }
  return totals;
}

// ── Phase 13 : données détaillées par compte ────────────────────────────

export type PostTargetAnalytics = {
  accountId: string | null; // null si Zernio ne l'a pas renvoyé (ancienne forme)
  platform: string;
  platformPostUrl: string | null;
  thumbnailUrl: string | null;
  views: number;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  avgWatchTime: number;
  raw: Record<string, unknown>;
};

function idOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as { _id?: string; id?: string };
    return o._id ?? o.id ?? null;
  }
  return null;
}

// Stats d'un post, UNE LIGNE PAR COMPTE (platformAnalytics[].accountId,
// confirmé dans docs.zernio.com/analytics/get-analytics). L'ancienne
// zernioGetPostAnalytics indexe par nom de plateforme : avec deux TikTok sur
// le même post, le second écrasait le premier. Celle-ci ne mélange rien.
export async function zernioGetPostTargetAnalytics(postId: string) {
  const res = await fetch(`${ZERNIO_BASE}/analytics?postId=${encodeURIComponent(postId)}`, {
    headers: zernioHeaders(),
  });
  // 202 = synchro en cours côté Zernio, 424 = aucune plateforme n'a encore remonté de stats.
  if (res.status === 202 || res.status === 424) return { pending: true, targets: [] as PostTargetAnalytics[] };
  if (res.status === 402) throw new Error("Zernio : l'add-on Analytics n'est pas activé sur ce compte.");
  if (!res.ok) throw new Error(`Zernio analytics error: ${res.status}`);

  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Zernio est indisponible (réponse invalide sur /analytics).");

  const items: Array<Record<string, unknown>> = Array.isArray(data.platformAnalytics)
    ? data.platformAnalytics
    : data.analytics && data.platform
      ? [{ platform: data.platform, accountId: data.accountId, analytics: data.analytics, platformPostUrl: data.platformPostUrl, thumbnailUrl: data.thumbnailUrl }]
      : [];

  const targets: PostTargetAnalytics[] = items.map((p) => {
    const a = (p.analytics || {}) as Record<string, number>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return {
      accountId: idOf(p.accountId),
      platform: p.platform as string,
      platformPostUrl: (p.platformPostUrl as string | undefined) ?? null,
      thumbnailUrl: (p.thumbnailUrl as string | undefined) ?? null,
      views: n(a.views) || n(a.impressions),
      impressions: n(a.impressions),
      reach: n(a.reach),
      likes: n(a.likes),
      comments: n(a.comments),
      shares: n(a.shares),
      saves: n(a.saves),
      clicks: n(a.clicks),
      avgWatchTime: n(a.igReelsAvgWatchTime),
      raw: p,
    };
  });
  return { pending: targets.length === 0, targets };
}

export type AccountHealth = {
  accountId: string;
  status: string | null; // healthy | warning | error
  canPost: boolean | null;
  canFetchAnalytics: boolean | null;
  tokenValid: boolean | null;
  tokenExpiresAt: string | null;
  needsReconnect: boolean | null;
  issues: string[];
};

// GET /v1/accounts/health (champs : status healthy|warning|error, canPost,
// canFetchAnalytics, tokenValid, tokenExpiresAt, needsReconnect, issues).
// Tolère camelCase et snake_case, la forme exacte n'ayant pas été testée
// avec une vraie clé.
export async function zernioGetAccountsHealth(): Promise<AccountHealth[]> {
  const res = await fetch(`${ZERNIO_BASE}/accounts/health`, { headers: zernioHeaders() });
  if (!res.ok) throw new Error(`Zernio accounts health error: ${res.status}`);
  const data = await res.json().catch(() => null);
  const list: Array<Record<string, unknown>> = Array.isArray(data?.accounts) ? data.accounts : [];
  const pick = (o: Record<string, unknown>, a: string, b: string) => o[a] ?? o[b];
  return list
    .map((h) => ({
      accountId: (idOf(pick(h, "accountId", "account_id")) ?? idOf(h._id)) as string,
      status: (h.status as string | undefined) ?? null,
      canPost: (pick(h, "canPost", "can_post") as boolean | undefined) ?? null,
      canFetchAnalytics: (pick(h, "canFetchAnalytics", "can_fetch_analytics") as boolean | undefined) ?? null,
      tokenValid: (pick(h, "tokenValid", "token_valid") as boolean | undefined) ?? null,
      tokenExpiresAt: (pick(h, "tokenExpiresAt", "token_expires_at") as string | undefined) ?? null,
      needsReconnect: (pick(h, "needsReconnect", "needs_reconnect") as boolean | undefined) ?? null,
      issues: Array.isArray(h.issues) ? (h.issues as string[]) : [],
    }))
    .filter((h) => h.accountId);
}

// ── Phase 14 : inbox (commentaires + DMs) ───────────────────────────────

async function zernioError(res: Response, label: string): Promise<Error> {
  const err = await res.json().catch(() => ({}));
  return new Error(err.error || err.message || `${label}: ${res.status}`);
}

// POST /v1/inbox/comments/{postId} — body { accountId, message, commentId? }
// (confirmé dans la spec : ReplyToInboxPostRequest). postId accepte l'ID
// Zernio OU l'ID natif de la plateforme. La clé d'idempotence évite qu'un
// retry (timeout réseau) poste la réponse deux fois.
export async function zernioReplyToComment(params: {
  postId: string;
  accountId: string;
  message: string;
  commentId?: string;
  idempotencyKey?: string;
}) {
  const headers: Record<string, string> = { ...zernioHeaders() };
  if (params.idempotencyKey) {
    headers["Idempotency-Key"] = params.idempotencyKey;
    headers["x-request-id"] = params.idempotencyKey;
  }
  const res = await fetch(`${ZERNIO_BASE}/inbox/comments/${encodeURIComponent(params.postId)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      accountId: params.accountId,
      message: params.message,
      ...(params.commentId ? { commentId: params.commentId } : {}),
    }),
  });
  if (!res.ok) throw await zernioError(res, "Zernio reply comment error");
  return res.json().catch(() => ({}));
}

// POST /v1/inbox/conversations/{conversationId}/messages — body { accountId, message }
export async function zernioSendMessage(params: {
  conversationId: string;
  accountId: string;
  message: string;
}) {
  const res = await fetch(`${ZERNIO_BASE}/inbox/conversations/${encodeURIComponent(params.conversationId)}/messages`, {
    method: "POST",
    headers: zernioHeaders(),
    body: JSON.stringify({ accountId: params.accountId, message: params.message }),
  });
  if (!res.ok) throw await zernioError(res, "Zernio send message error");
  return res.json().catch(() => ({}));
}

export type ZernioComment = {
  id: string;
  text: string;
  createdAt: string | null;
  authorId: string | null;
  authorName: string | null;
  authorUsername: string | null;
  parentId: string | null;
  raw: Record<string, unknown>;
};

// GET /v1/inbox/comments/{postId}?accountId=… — filet de sécurité quand le
// webhook comment.received n'est pas (ou mal) configuré. Les champs sont lus
// de façon tolérante : la forme exacte n'a pas pu être testée avec une vraie clé.
export async function zernioGetPostComments(postId: string, accountId: string): Promise<ZernioComment[]> {
  const res = await fetch(
    `${ZERNIO_BASE}/inbox/comments/${encodeURIComponent(postId)}?accountId=${encodeURIComponent(accountId)}`,
    { headers: zernioHeaders() }
  );
  if (!res.ok) throw await zernioError(res, "Zernio get comments error");
  const data = await res.json().catch(() => null);
  const list: Array<Record<string, unknown>> = Array.isArray(data?.comments) ? data.comments : [];
  return list
    .map((c) => {
      const from = (c.from ?? c.author ?? {}) as Record<string, unknown>;
      return {
        id: String(c.id ?? c._id ?? ""),
        text: String(c.message ?? c.text ?? ""),
        createdAt: (c.createdTime ?? c.createdAt ?? null) as string | null,
        authorId: from.id ? String(from.id) : null,
        authorName: (from.name ?? from.displayName ?? null) as string | null,
        authorUsername: (from.username ?? null) as string | null,
        parentId: (c.parentId ?? c.parentCommentId ?? null) as string | null,
        raw: c,
      };
    })
    .filter((c) => c.id && c.text);
}
