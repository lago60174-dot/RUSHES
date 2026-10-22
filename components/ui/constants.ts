export const C = {
  // Flare Studio — warm editorial orange with ink and cream surfaces
  bg:           "#F8F6F2",
  bgAlt:        "#F1EEE8",
  surface:      "#FFFEFC",
  surfaceAlt:   "#F6F2EC",
  card:         "#FFFEFC",
  cardHover:    "#F5EDE4",
  border:       "#E7DED3",
  borderLight:  "#D9CABC",

  green:        "#EA580C",
  greenLight:   "#F97316",
  greenBg:      "rgba(234,88,12,0.09)",
  greenGlow:    "rgba(234,88,12,0.20)",

  orange:       "#EA580C",
  orangeLight:  "#FB923C",
  orangeBg:     "rgba(234,88,12,0.10)",
  orangeGlow:   "rgba(234,88,12,0.22)",

  emerald:      "#0F766E",
  emeraldBg:    "rgba(15,118,110,0.10)",

  coral:        "#DC2626",
  coralBg:      "rgba(220,38,38,0.08)",

  amber:        "#B7791F",
  amberBg:      "rgba(183,121,31,0.10)",

  success:      "#0F766E",
  error:        "#DC2626",

  textPrimary:   "#211A16",
  textSecondary: "#66584E",
  textMuted:     "#9A8D82",
};

export const FONT_DISPLAY = "'Plus Jakarta Sans', 'Space Grotesk', system-ui, -apple-system, sans-serif";
export const FONT_MONO    = "'IBM Plex Mono', 'SFMono-Regular', monospace";

export const PLATFORMS: Record<string, { label: string; short: string; color: string }> = {
  tiktok:    { label: "TikTok",          short: "TT", color: "#4DD9D2" },
  instagram: { label: "Instagram",       short: "IG", color: "#D6457D" },
  youtube:   { label: "YouTube Shorts",  short: "YT", color: "#E25555" },
  facebook:  { label: "Facebook",        short: "FB", color: "#5B8DEF" },
};

export const TABS = [
  { key: "calendar",  label: "Planning",     icon: "📅" },
  { key: "dashboard", label: "Performances", icon: "📊" },
  { key: "history",   label: "Publications",      icon: "🏆" },
  { key: "ai",        label: "Studio IA",      icon: "✦" },
  { key: "library",   label: "Médiathèque",     icon: "🎞" },
];

export const MIN_VIDEOS_FOR_ANALYSIS = 5;
