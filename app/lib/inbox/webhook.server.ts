import { createHmac, timingSafeEqual } from "node:crypto";

// Checking and reading the notes Meta sends to /meta/webhook.

export function signedByMeta(body: string, header: string | null, secret = process.env.META_APP_SECRET ?? "") {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return want.length === got.length && timingSafeEqual(want, got);
}

// The Page or Instagram account ids the note is about.
export function webhookIds(body: string): string[] {
  try {
    const json = JSON.parse(body) as { object?: string; entry?: { id?: string }[] };
    if (json.object !== "page" && json.object !== "instagram") return [];
    return [...new Set((json.entry ?? []).map((e) => e.id).filter((id): id is string => typeof id === "string" && /^\d+$/.test(id)))];
  } catch {
    return [];
  }
}
