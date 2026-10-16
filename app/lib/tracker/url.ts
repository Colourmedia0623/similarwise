// Turns what a merchant types ("rival.com", "https://www.rival.com/collections/all")
// into the store's origin, or null when it isn't a usable web address.
export function normalizeStoreUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 300) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // A public domain name: at least one dot, letters in the last label (no IP addresses).
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || host.split(".").some((l) => !l)) return null;
  return `https://${host}`;
}

export function hostOf(origin: string): string {
  return new URL(origin).hostname.replace(/^www\./, "");
}
