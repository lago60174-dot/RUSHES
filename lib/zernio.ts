import { createHmac, timingSafeEqual } from "crypto";

const ZERNIO_BASE = "https://zernio.com/api/v1";

// Vérifie la signature HMAC-SHA256 envoyée par Zernio dans l'en-tête
// `X-Zernio-Signature` sur chaque appel webhook, pour s'assurer que la
// requête vient bien de Zernio (et pas d'un tiers qui devinerait l'URL).
export function verifyZernioWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  // Le header peut être préfixé (ex: "sha256=...") selon la config Zernio
  const provided = signatureHeader.includes("=") ? signatureHeader.split("=").pop()! : signatureHeader;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function zernioHeaders() {
  return {
    Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// Get connected accounts
// Demande une URL d'upload direct (jusqu'à 5 Go) + l'URL publique finale du fichier
// ⚠️ Zernio attend bien fileName/fileType (pas filename/contentType) — vérifié
// contre l'implémentation fonctionnelle de RUSHES-complet, à ne pas renommer.
export async function zernioGetMediaPresignUrl(fileName: string, fileType: string) {
  const res = await fetch(`${ZERNIO_BASE}/media/presign`, {
    method: "POST",
    headers: zernioHeaders(),
    body: JSON.stringify({ fileName, fileType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Zernio presign error: ${res.status}`);
  }
  return res.json() as Promise<{ uploadUrl: string; publicUrl: string; expires: string }>;
}

// List connected social accounts. Passer un profileId scope la liste au
// profil (= à l'utilisateur RUSHES) au lieu de renvoyer tous les comptes
// de toute l'app — indispensable pour l'isolation multi-utilisateur.
export async function zernioListAccounts(profileId?: string) {
  const url = profileId
    ? `${ZERNIO_BASE}/accounts?profileId=${encodeURIComponent(profileId)}`
    : `${ZERNIO_BASE}/accounts`;
  const res = await fetch(url, {
    headers: zernioHeaders(),
  });
  if (!res.ok) throw new Error(`Zernio accounts error: ${res.status}`);
  const data = await res.json();
  return data.accounts as Array<{
    _id: string;
    platform: string;
    name: string;
    username: string;
    profilePicture?: string;
  }>;
}

// Crée un profil Zernio (conteneur de comptes sociaux). Un profil par
// utilisateur RUSHES permet d'isoler leurs comptes sociaux respectifs
// tout en gardant une seule clé API partagée au niveau de l'app.
export async function zernioCreateProfile(name: string, description?: string) {
  const res = await fetch(`${ZERNIO_BASE}/profiles`, {
    method: "POST",
    headers: zernioHeaders(),
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Zernio create profile error: ${res.status}`);
  }
  const data = await res.json();
  // Selon les endpoints Zernio, l'objet créé peut être renvoyé directement
  // ou sous une clé "profile" — on couvre les deux cas.
  return (data.profile || data) as { _id: string; name: string };
}

// Get OAuth URL to connect a platform account, scopé à un profil précis.
// redirectUrl (optionnel) : où Zernio renvoie l'utilisateur une fois
// l'autorisation terminée (sinon Zernio utilise son propre écran par défaut).
export async function zernioGetConnectUrl(platform: string, profileId: string, redirectUrl?: string) {
  const params = new URLSearchParams({ profileId });
  if (redirectUrl) params.set("redirect_url", redirectUrl);
  const res = await fetch(
    `${ZERNIO_BASE}/connect/${platform}?${params.toString()}`,
    { headers: zernioHeaders() }
  );
  if (!res.ok) throw new Error(`Zernio connect error: ${res.status}`);
  const data = await res.json();
  return data.authUrl as string;
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
  const data = await res.json();
  return data.post as { _id: string; [key: string]: unknown };
}

// Récupère l'état actuel d'un post (utile pour vérifier manuellement
// si une publication programmée est bien partie, en complément — ou en
// l'absence — des webhooks). Chaque plateforme cible a son propre statut
// et, en cas d'échec, un message d'erreur détaillé.
export async function zernioGetPost(postId: string) {
  const res = await fetch(`${ZERNIO_BASE}/posts/${postId}`, {
    headers: zernioHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Zernio get post error: ${res.status}`);
  }
  const data = await res.json();
  return data.post as {
    _id: string;
    status: "scheduled" | "published" | "failed" | "partial" | "cancelled" | string;
    platforms: Array<{
      platform: string;
      accountId: string | { _id: string; username?: string };
      status: string;
      errorMessage?: string;
      errorCategory?: string;
      platformPostUrl?: string;
    }>;
    publishedAt?: string;
  };
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
