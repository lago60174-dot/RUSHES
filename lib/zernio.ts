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
// couvrir TikTok (c'est ce qui causait les 0/0 : la requête réussissait
// mais renvoyait une réponse vide pour ce compte-là).
// ⚠️ Reconstruite d'après la doc publique Zernio — pas testée avec une vraie
// clé API. Si le nom du paramètre de requête ou la forme de la réponse
// diffère chez toi, ajuste ci-dessous.
async function zernioGetTikTokAccountInsights(accountId: string): Promise<FollowerStats> {
  const res = await fetch(`${ZERNIO_BASE}/analytics/tiktok/account-insights?accountId=${accountId}`, {
    headers: zernioHeaders(),
  });
  if (!res.ok) throw new Error(`Zernio account-insights error: ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Zernio est indisponible (réponse invalide sur /analytics/tiktok/account-insights).");
  const raw = Array.isArray(data.accounts) ? data.accounts[0] : (data.insights ?? data.stats ?? data);
  return normalizeFollowerStats(raw);
}

// Endpoint générique (comptes hors TikTok, ou fallback si l'endpoint
// TikTok-spécifique échoue).
async function zernioGetGenericFollowerStats(accountId: string): Promise<FollowerStats> {
  const res = await fetch(`${ZERNIO_BASE}/accounts/follower-stats?accountId=${accountId}`, {
    headers: zernioHeaders(),
  });
  if (!res.ok) throw new Error(`Zernio follower-stats error: ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Zernio est indisponible (réponse invalide sur /accounts/follower-stats).");
  const raw = Array.isArray(data.accounts) ? data.accounts[0] : (data.stats ?? data);
  return normalizeFollowerStats(raw);
}

// Stats publiques du compte (abonnés, likes cumulés, nb de vidéos, etc.).
// platform est optionnel pour rester compatible avec les appels existants,
// mais il faut le passer pour TikTok afin d'utiliser le bon endpoint.
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
export async function zernioListAccounts(profileId?: string) {
  const url = profileId
    ? `${ZERNIO_BASE}/accounts?profileId=${encodeURIComponent(profileId)}`
    : `${ZERNIO_BASE}/accounts`;
  const res = await fetch(url, {
    headers: zernioHeaders(),
  });
  if (!res.ok) throw new Error(`Zernio accounts error: ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Zernio est indisponible (réponse invalide sur /accounts).");
  return data.accounts as Array<{
    _id: string;
    platform: string;
    name: string;
    username: string;
    profilePicture?: string;
  }>;
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
  return data.profiles as Array<{ id: string; name: string; isDefault: boolean }>;
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
  // Rattache explicitement le post au bon profile Zernio si connu — évite
  // toute ambiguïté si la clé API a accès à plusieurs profiles.
  if (process.env.ZERNIO_PROFILE_ID) {
    body.profileId = process.env.ZERNIO_PROFILE_ID;
  }
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

// Get analytics for a specific post
export async function zernioGetPostAnalytics(postId: string) {
  const res = await fetch(`${ZERNIO_BASE}/analytics/${postId}`, {
    headers: zernioHeaders(),
  });
  if (!res.ok) throw new Error(`Zernio analytics error: ${res.status}`);
  return res.json() as Promise<{
    postId: string;
    platforms: Record<
      string,
      {
        views?: number;
        impressions?: number;
        likes?: number;
        comments?: number;
        shares?: number;
        saves?: number;
        newFollowers?: number;
        avgWatchTime?: number;
        completionRate?: number;
      }
    >;
  }>;
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
