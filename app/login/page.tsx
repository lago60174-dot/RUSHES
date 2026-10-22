"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { C } from "@/components/ui/constants";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const supabase = createSupabaseBrowserClient();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "forbidden") {
      setError("Accès refusé : cette application est privée.");
    }
  }, []);

  async function handleSubmit() {
    setError("");
    if (!email.trim() || !password) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) {
      setError("Email ou mot de passe incorrect.");
    } else {
      window.location.href = "/";
    }
  }

  const inputStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    background: C.card,
    border: `1px solid ${C.border}`,
    color: C.textPrimary,
    borderRadius: 12,
    padding: "12px 16px",
    fontSize: "0.9rem",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };

  return (
    <div
      style={{
        background: C.bg,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 24,
          padding: 40,
          width: "100%",
          maxWidth: 400,
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: `linear-gradient(135deg, ${C.orange}, #C2410C)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ color: "#fff", fontSize: "1.2rem", fontWeight: 900 }}>R</span>
          </div>
          <div>
            <div style={{ color: C.textPrimary, fontWeight: 700, fontSize: "1rem", letterSpacing: "0.1em" }}>
              FLARE
            </div>
            <div style={{ color: C.textMuted, fontSize: "0.75rem" }}>Social content studio</div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: "#450A0A", border: "1px solid #991B1B", borderRadius: 10, padding: "10px 14px", marginBottom: 20, color: C.error, fontSize: "0.82rem" }}>
            {error}
          </div>
        )}

        {/* Email */}
        <label style={{ display: "block", color: C.textMuted, fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontFamily: "'IBM Plex Mono', monospace" }}>
          Adresse email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="toi@exemple.com"
          style={{ ...inputStyle, marginBottom: 16 }}
        />

        {/* Password */}
        <label style={{ display: "block", color: C.textMuted, fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontFamily: "'IBM Plex Mono', monospace" }}>
          Mot de passe
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
          placeholder="••••••••"
          style={{ ...inputStyle, marginBottom: 24 }}
        />

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading || !email.trim() || !password}
          style={{
            width: "100%",
            background: `linear-gradient(135deg, ${C.orange}, #C2410C)`,
            color: "#fff",
            border: "none",
            borderRadius: 12,
            padding: "13px 0",
            fontSize: "0.9rem",
            fontWeight: 700,
            cursor: "pointer",
            opacity: loading || !email.trim() || !password ? 0.6 : 1,
            fontFamily: "inherit",
          }}
        >
          {loading ? "Chargement…" : "Se connecter →"}
        </button>
      </div>
    </div>
  );
}
