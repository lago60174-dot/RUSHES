import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { zernioGetMediaPresignUrl } from "@/lib/zernio";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { fileName, fileType } = await request.json().catch(() => ({}));
  if (!fileName || !fileType) {
    return NextResponse.json({ error: "fileName et fileType requis" }, { status: 400 });
  }
  if (!fileType.startsWith("video/")) {
    return NextResponse.json({ error: "Seuls les fichiers vidéo sont acceptés" }, { status: 400 });
  }

  try {
    const { uploadUrl, publicUrl, expires } = await zernioGetMediaPresignUrl(fileName, fileType);
    return NextResponse.json({ uploadUrl, publicUrl, expires });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
