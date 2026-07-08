import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { zernioCreatePost } from "@/lib/zernio";

const FREE_PLAN_LIMIT = 5; // publications/mois

export async function POST(request: Request) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createSupabaseAdminClient();

  // ── Vérification du plan et des limites ───────────────────
  const now = new Date().toISOString();

  const { data: activeSub } = await db
    .from("subscriptions")
    .select("id, plan")
    .eq("user_id", user.id)
    .in("plan", ["pro", "business"])
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .limit(1)
    .single();

  // Pro et Business ont tous les deux un accès illimité — seul Freemium
  // est bridé (5 publications/mois, 1 seul réseau à la fois).
  const isPro = !!activeSub;

  if (!isPro) {
    // Compter les publications ce mois-ci
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count } = await db
      .from("videos")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "published")
      .gte("published_date", startOfMonth.toISOString().slice(0, 10));

    if ((count ?? 0) >= FREE_PLAN_LIMIT) {
      return NextResponse.json(
        {
          error: `Tu as atteint la limite de ${FREE_PLAN_LIMIT} publications/mois du plan Freemium. Passe au plan Pro pour publier sans limite.`,
          limitReached: true,
          upgradePath: "/pricing",
        },
        { status: 403 }
      );
    }
  }

  // ── Publication normale ────────────────────────────────────
  const body = await request.json();
  const { videoId, caption, videoUrl, scheduledFor } = body;

  const targets: Array<{ platform: string; accountId: string }> =
    Array.isArray(body.targets) && body.targets.length > 0
      ? body.targets
      : body.accountId && body.platform
        ? [{ platform: body.platform, accountId: body.accountId }]
        : [];

  if (!videoId || !caption || targets.length === 0) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // ── Vérification limite multi-réseaux (Freemium = 1 réseau) ─
  if (!isPro && targets.length > 1) {
    return NextResponse.json(
      {
        error: "Le plan Freemium est limité à 1 réseau social. Passe au Pro pour publier sur plusieurs réseaux simultanément.",
        limitReached: true,
        upgradePath: "/pricing",
      },
      { status: 403 }
    );
  }

  try {
    const post = await zernioCreatePost({
      content: caption,
      platforms: targets,
      mediaUrl: videoUrl || undefined,
      scheduledFor: scheduledFor || undefined,
    });

    const { error } = await db
      .from("videos")
      .update({
        zernio_post_id: post._id,
        zernio_account_id: targets[0].accountId,
        zernio_targets: targets,
        video_url: videoUrl || null,
        status: scheduledFor ? "planned" : "published",
        published_date: scheduledFor ? null : new Date().toISOString().slice(0, 10),
        published_time: scheduledFor ? null : new Date().toTimeString().slice(0, 5),
        zernio_error: null,
        zernio_error_category: null,
      })
      .eq("id", videoId)
      .eq("user_id", user.id);

    if (error) throw new Error(error.message);
    return NextResponse.json({ postId: post._id, targets });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
