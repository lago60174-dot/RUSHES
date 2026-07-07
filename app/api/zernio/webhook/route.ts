import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { verifyZernioWebhookSignature } from "@/lib/zernio";

// Endpoint appelé par Zernio (pas par le navigateur de l'utilisateur) à
// chaque changement de statut d'un post : programmé, publié, échoué,
// partiellement publié, ou annulé. C'est ce qui permet à RUSHES de savoir
// qu'une publication programmée est *réellement* partie, sans que
// l'utilisateur ait besoin de revenir vérifier manuellement.
//
// À configurer une seule fois dans le dashboard Zernio :
//   Settings → Webhooks → Add webhook
//   URL     : https://<ton-domaine>/api/zernio/webhook
//   Events  : post.scheduled, post.published, post.failed, post.partial, post.cancelled
//   Secret  : la même valeur que ZERNIO_WEBHOOK_SECRET côté Vercel

type ZernioPlatformResult = {
  platform: string;
  accountId?: string | { _id: string };
  status: string;
  errorMessage?: string;
  errorCategory?: string;
};

type ZernioPost = {
  _id: string;
  status?: string;
  platforms?: ZernioPlatformResult[];
  publishedAt?: string;
};

function extractPost(body: Record<string, unknown>): ZernioPost | null {
  const candidate =
    (body.data as Record<string, unknown> | undefined)?.post ??
    (body.data as ZernioPost | undefined) ??
    body.post ??
    body;
  if (candidate && typeof candidate === "object" && "_id" in candidate) {
    return candidate as ZernioPost;
  }
  return null;
}

function summarizeErrors(platforms: ZernioPlatformResult[] | undefined) {
  const failed = (platforms || []).filter(
    (p) => p.status === "failed" || p.errorMessage
  );
  if (failed.length === 0) return { message: null as string | null, category: null as string | null };
  const message = failed
    .map((p) => `${p.platform} : ${p.errorMessage || "échec inconnu"}`)
    .join(" · ");
  return { message, category: failed[0].errorCategory || null };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-zernio-signature");

  if (!verifyZernioWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = (body.event || body.type) as string | undefined;
  const post = extractPost(body);

  // Webhook de test depuis le dashboard Zernio, ou évènement non lié à un post
  if (!event || !post?._id) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const db = createSupabaseAdminClient();
  const { data: video } = await db
    .from("videos")
    .select("id")
    .eq("zernio_post_id", post._id)
    .maybeSingle();

  if (!video) {
    // Post inconnu de RUSHES (autre app utilisant le même compte Zernio, par ex.)
    return NextResponse.json({ ok: true, ignored: true });
  }

  const { message, category } = summarizeErrors(post.platforms);
  const now = new Date();

  let update: Record<string, unknown> | null = null;

  switch (event) {
    case "post.published":
      update = {
        status: "published",
        published_date: (post.publishedAt || now.toISOString()).slice(0, 10),
        published_time: (post.publishedAt ? new Date(post.publishedAt) : now).toTimeString().slice(0, 5),
        zernio_error: null,
        zernio_error_category: null,
        zernio_platform_status: post.platforms || [],
      };
      break;

    case "post.partial":
      // Publié sur au moins une plateforme, échoué sur au moins une autre :
      // on marque quand même "published" (une partie est bien en ligne) mais
      // on conserve le détail de l'échec pour que l'utilisateur le voie.
      update = {
        status: "published",
        published_date: (post.publishedAt || now.toISOString()).slice(0, 10),
        published_time: (post.publishedAt ? new Date(post.publishedAt) : now).toTimeString().slice(0, 5),
        zernio_error: message,
        zernio_error_category: category,
        zernio_platform_status: post.platforms || [],
      };
      break;

    case "post.failed":
      update = {
        status: "failed",
        zernio_error: message || "La publication a échoué sur Zernio.",
        zernio_error_category: category,
        zernio_platform_status: post.platforms || [],
      };
      break;

    case "post.cancelled":
      update = {
        status: "failed",
        zernio_error: "La publication programmée a été annulée sur Zernio.",
        zernio_error_category: "cancelled",
        zernio_platform_status: post.platforms || [],
      };
      break;

    case "post.scheduled":
      // Confirmation que la programmation est bien enregistrée côté Zernio.
      update = { status: "planned", zernio_error: null, zernio_error_category: null };
      break;

    default:
      return NextResponse.json({ ok: true, ignored: true });
  }

  const { error } = await db.from("videos").update(update).eq("id", video.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
