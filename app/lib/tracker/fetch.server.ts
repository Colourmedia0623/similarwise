import { lookup } from "node:dns/promises";
import net from "node:net";

// Fetches public storefront pages only. Merchants type the addresses, so
// every hop (redirects included) must resolve to a public IP address, never
// to this server's own network.

const USER_AGENT = "Mozilla/5.0 (compatible; SimilarwiseBot/1.0)";
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 4;

export type Fetcher = (url: string, accept: string) => Promise<{ status: number; url: string; body: string }>;

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

async function assertPublicHost(hostname: string) {
  if (net.isIP(hostname) || hostname === "localhost" || !hostname.includes(".")) {
    throw new Error(`${hostname} isn't a public web address`);
  }
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`${hostname} isn't a public web address`);
  }
}

export const fetchPublic: Fetcher = async (start, accept) => {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Unsupported address");
    await assertPublicHost(parsed.hostname);
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, accept },
      signal: AbortSignal.timeout(20_000),
    });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, url).toString();
      continue;
    }
    const length = Number(res.headers.get("content-length") || 0);
    if (length > MAX_BYTES) throw new Error("Page too large");
    const body = await res.text();
    if (body.length > MAX_BYTES) throw new Error("Page too large");
    return { status: res.status, url, body };
  }
  throw new Error("Too many redirects");
};
