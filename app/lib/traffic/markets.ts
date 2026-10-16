// The countries traffic and keyword numbers can be for, with DataForSEO's
// location code and the language its Google results are read in.

export type Market = { code: string; name: string; location: number; language: string };

export const MARKETS: Market[] = [
  { code: "US", name: "United States", location: 2840, language: "en" },
  { code: "GB", name: "United Kingdom", location: 2826, language: "en" },
  { code: "CA", name: "Canada", location: 2124, language: "en" },
  { code: "AU", name: "Australia", location: 2036, language: "en" },
  { code: "NZ", name: "New Zealand", location: 2554, language: "en" },
  { code: "IE", name: "Ireland", location: 2372, language: "en" },
  { code: "DE", name: "Germany", location: 2276, language: "de" },
  { code: "FR", name: "France", location: 2250, language: "fr" },
  { code: "NL", name: "Netherlands", location: 2528, language: "nl" },
  { code: "ES", name: "Spain", location: 2724, language: "es" },
  { code: "IT", name: "Italy", location: 2380, language: "it" },
];

export function marketFor(code: string | null | undefined): Market {
  return MARKETS.find((m) => m.code === code) ?? MARKETS[0];
}
