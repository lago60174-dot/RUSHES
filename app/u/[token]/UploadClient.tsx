"use client";

import { useState } from "react";

export default function UploadClient({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  async function onPick(file: File | undefined) {
    if (!file) return;
    setState("uploading"); setProgress(0); setMessage("");
    try {
      const pre = await fetch("/api/upload/presign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, fileName: file.name, fileType: file.type || "video/mp4", fileSize: file.size }),
      });
      const p = await pre.json();
      if (!pre.ok) throw new Error(p.error || "Préparation de l'envoi impossible.");

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", p.uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
        xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Envoi refusé (${xhr.status}). Vérifie la config CORS de R2.`)));
        xhr.onerror = () => reject(new Error("Connexion interrompue pendant l'envoi."));
        xhr.send(file);
      });

      const done = await fetch("/api/upload/complete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, mediaId: p.mediaId }),
      });
      if (!done.ok) throw new Error("Vidéo envoyée, mais le bot n'a pas pu être prévenu.");
      setState("done");
    } catch (e) {
      setMessage((e as Error).message); setState("error");
    }
  }

  if (state === "done") return <p style={{ fontSize: 16 }}>✅ Vidéo envoyée ! Retourne dans Telegram : le bot t'a prévenu.</p>;
  return (
    <div>
      <p style={{ opacity: 0.8, marginBottom: 16 }}>Choisis la vidéo à envoyer. Elle part directement vers ton stockage.</p>
      <label style={{ display: "inline-block", padding: "12px 20px", borderRadius: 12, background: "linear-gradient(135deg, #EA580C, #C2410C)", color: "#fff", fontWeight: 700, cursor: state === "uploading" ? "default" : "pointer", opacity: state === "uploading" ? 0.6 : 1 }}>
        {state === "uploading" ? `Envoi… ${progress}%` : "Choisir une vidéo"}
        <input type="file" accept="video/*" hidden disabled={state === "uploading"} onChange={(e) => onPick(e.target.files?.[0])} />
      </label>
      {state === "uploading" && <div style={{ marginTop: 16, height: 6, borderRadius: 3, background: "#E7DED3" }}><div style={{ width: `${progress}%`, height: "100%", borderRadius: 3, background: "#EA580C" }} /></div>}
      {state === "error" && <p style={{ marginTop: 16, color: "#DC2626" }}>⚠️ {message}</p>}
    </div>
  );
}
