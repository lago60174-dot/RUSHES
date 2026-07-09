export const C = {
  bg:           "#FFFFFF",
  bgAlt:        "#F7F7F8",
  surface:      "#FFFFFF",
  surfaceAlt:   "#F4F4F5",
  card:         "#F4F4F5",
  cardHover:    "#E9E9EC",
  border:       "#E4E4E7",
  borderLight:  "#D4D4D8",

  green:        "#16A34A",
  greenLight:   "#22C55E",
  greenBg:      "rgba(22,163,74,0.10)",
  greenGlow:    "rgba(22,163,74,0.22)",

  orange:       "#EA580C",
  orangeLight:  "#F97316",
  orangeBg:     "rgba(234,88,12,0.10)",
  orangeGlow:   "rgba(234,88,12,0.22)",

  emerald:      "#16A34A",
  emeraldBg:    "rgba(22,163,74,0.10)",

  coral:        "#DC2626",
  coralBg:      "rgba(220,38,38,0.08)",

  amber:        "#CA8A04",
  amberBg:      "rgba(202,138,4,0.10)",

  success:      "#16A34A",
  error:        "#DC2626",

  textPrimary:   "#18181B",
  textSecondary: "#52525B",
  textMuted:     "#A1A1AA",
};

export const FONT_DISPLAY = "'Space Grotesk', system-ui, -apple-system, sans-serif";
export const FONT_MONO    = "'IBM Plex Mono', 'SFMono-Regular', monospace";

export const PLATFORMS: Record<string, { label: string; short: string; color: string }> = {
  tiktok:    { label: "TikTok",          short: "TT", color: "#4DD9D2" },
  instagram: { label: "Instagram",       short: "IG", color: "#D6457D" },
  youtube:   { label: "YouTube Shorts",  short: "YT", color: "#E25555" },
  facebook:  { label: "Facebook",        short: "FB", color: "#5B8DEF" },
};

export const TABS = [
  { key: "calendar",  label: "Calendrier",     icon: "📅" },
  { key: "dashboard", label: "Tableau de bord", icon: "📊" },
  { key: "history",   label: "Historique",      icon: "🏆" },
  { key: "ai",        label: "Analyse IA",      icon: "✦" },
  { key: "library",   label: "Médiathèque",     icon: "🎞" },
];

export const MIN_VIDEOS_FOR_ANALYSIS = 5;
