import db from "../db.server";
import { NETWORK_NAME, type Network } from "./social/networks";
import { authorizeUrl, providerApproved, providerOn, type Provider } from "./social/networks.server";
import { signState } from "./social/seal.server";
import { canvaAccount, canvaAuthorizeUrl, canvaOn } from "./social/canva.server";
import { inboxOpen } from "./inbox/inbox.server";
import { googleApproved, googleAuthorizeUrl, googleOn, googleOverview } from "./google/google.server";
import { adAuthorizeUrl, adNetworkApproved, adNetworkOn } from "./paidsocial/networks.server";
import type { AdNetwork } from "./paidsocial/paid";
import { canTestConnections } from "./web/admin.server";
import { isWebShop } from "./web/shop";

// The Setup page's steps: every account a shop can connect, whether it's
// connected yet, and the sign-in links, built the same way as on each
// connection's own page (Social accounts, Google, Paid social ads).

const SIGN_IN_FOR = 30 * 60_000;

export type StepKey = "website" | "meta" | "tiktok" | "pinterest" | "linkedin" | "canva" | "google" | "ads" | "competitors";

export type Step = {
  key: StepKey;
  done: boolean;
  // What's connected, e.g. Page and profile names.
  connected: string[];
  // Sign-in links, opened in a new tab. Empty when the connection isn't open yet.
  links: { label: string; href: string }[];
  // Not available to this shop yet, so it doesn't count towards progress.
  soon: boolean;
  // Something left to do after signing in, and where.
  todo?: { text: string; href: string } | null;
};

export async function setupSteps(shop: string, now = Date.now()): Promise<Step[]> {
  const exp = now + SIGN_IN_FOR;
  const tester = await canTestConnections(shop);
  const open = (p: Provider) => providerOn(p) && (providerApproved(p) || tester);
  const inbox = (p: Provider) => (p === "meta" ? inboxOpen(shop, "facebook") || inboxOpen(shop, "instagram") : inboxOpen(shop, p));
  const socialLink = (p: Provider) => (open(p) ? authorizeUrl(p, signState({ shop, network: p, exp }), { inbox: inbox(p) }) : null);
  const adLink = (n: AdNetwork) => (adNetworkOn(n) && (adNetworkApproved(n) || tester) ? adAuthorizeUrl(n, signState({ shop, network: `${n}-ads`, exp })) : null);
  const googleOpen = googleOn() && (googleApproved() || tester);

  const [accounts, canva, google, adAccounts, competitors, workspace, pinterestBoards] = await Promise.all([
    db.socialAccount.findMany({ where: { shop }, select: { network: true, name: true }, orderBy: { name: "asc" } }),
    canvaAccount(shop),
    googleOverview(shop),
    db.adAccount.findMany({ where: { shop }, select: { network: true, name: true }, orderBy: { name: "asc" } }),
    db.competitor.count({ where: { shop } }),
    isWebShop(shop) ? db.workspace.findUnique({ where: { shop }, select: { website: true } }) : null,
    db.socialAccount.count({ where: { shop, network: "pinterest" } }),
  ]);

  const named = (...networks: Network[]) =>
    accounts.filter((a) => networks.includes(a.network as Network)).map((a) => `${a.name} (${NETWORK_NAME[a.network as Network]})`);

  const social = (key: Provider, networks: Network[], label: string): Step => {
    const href = socialLink(key);
    const connected = named(...networks);
    return { key, done: connected.length > 0, connected, links: href ? [{ label, href }] : [], soon: !href && !connected.length };
  };

  const pinterest = social("pinterest", ["pinterest"], "Connect Pinterest");
  // Pinterest posts go to a board; signing in with none brings nothing through.
  if (pinterest.links.length && !pinterestBoards) pinterest.todo = { text: "No boards came through yet? Make one on Pinterest or on Social accounts, then connect again.", href: "/app/social" };

  const googleStep: Step = {
    key: "google",
    done: !!google,
    connected: google ? [google.email, google.gaName, google.adsName].filter((s): s is string => !!s) : [],
    links: googleOpen ? [{ label: google ? "Sign in again" : "Connect Google", href: googleAuthorizeUrl(signState({ shop, network: "google", exp })) }] : [],
    soon: !googleOpen && !google,
    todo: google && !google.gaProperty && !google.adsCustomer ? { text: "Choose which Analytics property and Ads account to show.", href: "/app/google?choose" } : null,
  };

  const adLinks = (["meta", "tiktok"] as const).flatMap((n) => {
    const href = adLink(n);
    return href ? [{ label: n === "meta" ? "Connect Meta ads" : "Connect TikTok ads", href }] : [];
  });

  const steps: Step[] = [
    {
      key: "website",
      done: workspace ? !!workspace.website : true,
      connected: workspace ? (workspace.website ? [workspace.website] : []) : [shop],
      links: [],
      soon: false,
    },
    social("meta", ["facebook", "instagram"], "Connect Facebook and Instagram"),
    social("tiktok", ["tiktok"], "Connect TikTok"),
    pinterest,
    social("linkedin", ["linkedin"], "Connect LinkedIn"),
    {
      key: "canva",
      done: !!canva,
      connected: canva ? [canva.name] : [],
      links: canvaOn() ? [{ label: canva ? "Sign in again" : "Connect Canva", href: canvaAuthorizeUrl(shop, now) }] : [],
      soon: !canvaOn() && !canva,
    },
    googleStep,
    {
      key: "ads",
      done: adAccounts.length > 0,
      connected: adAccounts.map((a) => `${a.name} (${a.network === "meta" ? "Meta" : "TikTok"})`),
      links: adLinks,
      soon: !adLinks.length && !adAccounts.length,
    },
    { key: "competitors", done: competitors > 0, connected: competitors ? [`${competitors} ${competitors === 1 ? "competitor" : "competitors"}`] : [], links: [], soon: false },
  ];
  return steps;
}
