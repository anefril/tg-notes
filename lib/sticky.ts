// Shared sticky-note styling constants, used by the wall canvas (notes-wall.tsx)
// and the Keep-style colored cards in the list view (note-card.tsx).

// Sticky-note palette — bright pastels kept the same in light & dark (real-paper feel).
export const STICKY_COLORS: { key: string; bg: string; label: string }[] = [
  { key: "white", bg: "#ffffff", label: "White" },
  { key: "yellow", bg: "#fde68a", label: "Yellow" },
  { key: "green", bg: "#bbf7d0", label: "Green" },
  { key: "pink", bg: "#fbcfe8", label: "Pink" },
  { key: "purple", bg: "#e9d5ff", label: "Lilac" },
  { key: "blue", bg: "#bfdbfe", label: "Blue" },
  { key: "orange", bg: "#fed7aa", label: "Orange" },
  { key: "gray", bg: "#e5e7eb", label: "Gray" },
];
export const COLOR_MAP: Record<string, string> = Object.fromEntries(
  STICKY_COLORS.map((c) => [c.key, c.bg])
);
export const DEFAULT_COLOR = "yellow";

// CSS class that paints a note in its sticky colour (handles light/dark via
// globals.css). Returns "" for no colour so the card stays the default surface.
export function noteColorClass(key: string | null | undefined): string {
  return key && COLOR_MAP[key] ? `note-${key}` : "";
}

export const STICKY_FONTS: { key: string; css: string; label: string }[] = [
  { key: "sans", css: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", label: "Sans" },
  { key: "serif", css: "Georgia, 'Times New Roman', serif", label: "Serif" },
  { key: "mono", css: "ui-monospace, 'Cascadia Code', 'Courier New', monospace", label: "Mono" },
  { key: "hand", css: "'Comic Sans MS', 'Segoe Print', 'Bradley Hand', cursive", label: "Handwritten" },
];
export const FONT_MAP: Record<string, string> = Object.fromEntries(
  STICKY_FONTS.map((f) => [f.key, f.css])
);
export const DEFAULT_FONT = "sans";
