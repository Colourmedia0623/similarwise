import type { CSSProperties } from "react";

// Colours for the web version's dashboard, picked by each person from the
// sidebar. Each is a light and a darker shade; "ink" is the text colour that
// reads on it. Violet is SimilarWise's own.

export type Theme = { key: string; name: string; light: string; dark: string; ink: string; grad?: string };

export const THEMES: Theme[] = [
  { key: "violet", name: "SimilarWise violet", light: "#6d5dfc", dark: "#2f7bff", ink: "#fff", grad: "linear-gradient(135deg, #6d5dfc 0%, #2f7bff 55%, #22c1ee 100%)" },
  { key: "blue-jeans", name: "Blue jeans", light: "#5D9CEC", dark: "#4A89DC", ink: "#fff" },
  { key: "aqua", name: "Aqua", light: "#4FC1E9", dark: "#3BAFDA", ink: "#fff" },
  { key: "mint", name: "Mint", light: "#48CFAD", dark: "#37BC9B", ink: "#fff" },
  { key: "grass", name: "Grass", light: "#A0D468", dark: "#8CC152", ink: "#fff" },
  { key: "sunflower", name: "Sunflower", light: "#FFCE54", dark: "#F6BB42", ink: "#0b1020" },
  { key: "bittersweet", name: "Bittersweet", light: "#FC6E51", dark: "#E9573F", ink: "#fff" },
  { key: "grapefruit", name: "Grapefruit", light: "#ED5565", dark: "#DA4453", ink: "#fff" },
  { key: "lavender", name: "Lavender", light: "#AC92EC", dark: "#967ADC", ink: "#fff" },
  { key: "pink-rose", name: "Pink rose", light: "#EC87C0", dark: "#D770AD", ink: "#fff" },
  { key: "light-gray", name: "Light grey", light: "#F5F7FA", dark: "#E6E9ED", ink: "#0b1020" },
  { key: "medium-gray", name: "Medium grey", light: "#CCD1D9", dark: "#AAB2BD", ink: "#0b1020" },
  { key: "dark-gray", name: "Dark grey", light: "#656D78", dark: "#434A54", ink: "#fff" },
];

export const DEFAULT_THEME = "violet";

export const themeFor = (key: string | null | undefined) => THEMES.find((t) => t.key === key) ?? THEMES[0];

// The CSS variables the shell and pages colour themselves with: the
// sidebar in the colour, the page behind the cards tinted with it, and
// highlights and buttons in it. Violet keeps SimilarWise's dark sidebar.
export function themeStyle(key: string | null | undefined): CSSProperties {
  const t = themeFor(key);
  // Very pale colours stand out too little as a highlight, so they use their darker shade.
  const pale = t.ink !== "#fff";
  const vars: Record<string, string> = {
    "--sw-accent": pale ? t.dark : t.light,
    "--sw-accent-2": t.dark,
    "--sw-grad": t.grad ?? `linear-gradient(135deg, ${t.light} 0%, ${t.dark} 100%)`,
    "--sw-ink": t.ink,
    // Text in the colour, on white: pale colours are darkened so it reads.
    "--sw-text": pale ? `color-mix(in srgb, ${t.dark} 40%, #0b1020)` : t.dark,
  };
  if (t.key !== DEFAULT_THEME) {
    const strong = pale ? "#0b1020" : "#ffffff";
    Object.assign(vars, {
      "--sw-side": `linear-gradient(180deg, ${t.dark} 0%, ${t.light} 100%)`,
      "--sw-side-strong": strong,
      "--sw-side-ink": `color-mix(in srgb, ${strong} 85%, transparent)`,
      "--sw-side-muted": `color-mix(in srgb, ${strong} 60%, transparent)`,
      "--sw-side-active": `color-mix(in srgb, ${strong} 20%, transparent)`,
      "--sw-page": `color-mix(in srgb, ${t.light} ${pale ? 30 : 12}%, #f5f6fb)`,
    });
  }
  return vars as CSSProperties;
}
