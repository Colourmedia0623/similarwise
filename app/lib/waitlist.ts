// The early-access waitlist on the public landing page: an email address and,
// if they give it, the store's website.

export type Signup = { email: string; store: string | null };

const text = (v: FormDataEntryValue | null, max: number) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

export function parseSignup(form: FormData): { ok: true; signup: Signup } | { ok: false; error: string } {
  const email = text(form.get("email"), 200)?.toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Please enter a valid email address." };
  return { ok: true, signup: { email, store: text(form.get("store"), 200) } };
}
