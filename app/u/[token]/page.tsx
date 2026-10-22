import { verifyUploadToken } from "@/lib/upload-token";
import UploadClient from "./UploadClient";

export const metadata = { title: "Envoyer une vidéo", robots: { index: false, follow: false } };

export default async function UploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = verifyUploadToken(decodeURIComponent(token));
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#F8F6F2", color: "#211A16", fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>🎬 Envoyer une vidéo</h1>
        <p style={{ fontSize: 12, letterSpacing: "0.1em", color: "#EA580C", fontWeight: 700, margin: "0 0 16px" }}>FLARE STUDIO</p>
        {valid
          ? <UploadClient token={decodeURIComponent(token)} />
          : <p style={{ opacity: 0.8 }}>Ce lien a expiré. Renvoie ta vidéo au bot Telegram pour en obtenir un nouveau.</p>}
      </div>
    </main>
  );
}
