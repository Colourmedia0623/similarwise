import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { claudeJson } from "../lib/ideas/claude.server";
import {
  MAX_PROMPTS,
  addPrompt,
  aiClient,
  aiVisibility,
  deletePrompt,
  detectAiBrand,
  editPrompt,
  setAiBrand,
  startAiCheck,
  suggestPrompts,
} from "../lib/ai/mentions.server";

// AI mentions: whether ChatGPT, Gemini and Perplexity name the shop when
// shoppers ask them for what it sells, next to its competitors, and the
// sites they quote.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await detectAiBrand(session.shop, async () => {
    const res = (await (await admin.graphql(`#graphql
      query ShopName { shop { name } }`)).json()) as { data?: { shop?: { name?: string } } };
    return res.data?.shop?.name ?? null;
  });
  return { on: aiClient() != null, writer: claudeJson() != null, max: MAX_PROMPTS, ...(await aiVisibility(session.shop)) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  const text = (k: string) => String(form.get(k) ?? "");
  if (intent === "brand") {
    await setAiBrand(shop, text("brand"));
    return { intent, ok: true as const };
  }
  if (intent === "check") return { intent, ...(await startAiCheck(shop)) };
  if (intent === "add") return { intent, ...(await addPrompt(shop, text("prompt"))) };
  if (intent === "edit") return { intent, id, ...(await editPrompt(shop, id, text("prompt"))) };
  if (intent === "delete") {
    await deletePrompt(shop, id);
    return { intent, id, ok: true as const };
  }
  if (intent === "suggest") {
    try {
      return { intent, ...(await suggestPrompts(shop)) };
    } catch (err) {
      console.error("Couldn't suggest AI questions", shop, err);
      return { intent, error: "Couldn't think of questions just now. Try again in a minute." };
    }
  }
  return { error: "Unknown action" };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;

const ago = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const pct = (v: number | null) => (v == null ? "–" : `${v}%`);

export default function AiMentions() {
  const d = useLoaderData<typeof loader>();
  const check = useFetcher<typeof action>();
  const brand = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const checking = d.running || (check.state !== "idle" && check.formData?.get("intent") === "check") || (check.data != null && "started" in check.data && !d.checkedAt);
  const checkError = check.state === "idle" && check.data && "error" in check.data ? check.data.error : null;
  const you = d.brands.find((b) => b.key === "you");
  const change = you?.share != null && you.before != null ? you.share - you.before : null;
  const [name, setName] = useState(d.brand);

  // Answers come in over a few minutes, so keep looking while a check runs.
  useEffect(() => {
    if (!d.running) return;
    const t = setInterval(() => revalidator.revalidate(), 10_000);
    return () => clearInterval(t);
  }, [d.running, revalidator]);

  return (
    <s-page heading="AI mentions">
      {d.on && (
        <s-button
          slot="primary-action"
          variant="primary"
          loading={checking}
          disabled={!d.prompts.length}
          onClick={() => check.submit({ intent: "check" }, { method: "post" })}
        >
          Check now
        </s-button>
      )}
      {!d.on && <s-banner tone="info">AI mentions aren&apos;t switched on for this app yet.</s-banner>}
      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            More shoppers now ask ChatGPT, Gemini and Perplexity what to buy and where. Each week SimilarWise asks them the questions below, the
            way a shopper in {d.market} would, and shows which shops they name and which sites they quote. Being named, and being quoted on the
            sites they trust, is how you show up.
          </s-paragraph>
          <s-stack direction="inline" gap="small" alignItems="end">
            <div style={{ flex: "1 1 260px", maxWidth: 420 }}>
              <s-text-field
                label="Your shop's name, as people say it"
                value={name}
                details={d.domain ? `Mentions of ${d.domain} count too.` : "Add your website on the Keyword gap page so mentions of it count too."}
                onInput={(e) => setName(e.currentTarget.value)}
              />
            </div>
            {name !== d.brand && (
              <s-button loading={brand.state !== "idle"} onClick={() => brand.submit({ intent: "brand", brand: name }, { method: "post" })}>
                Save
              </s-button>
            )}
          </s-stack>
          {checking && <s-banner tone="info">Asking ChatGPT, Gemini and Perplexity your questions. This takes a few minutes; the page updates by itself.</s-banner>}
          {checkError && <s-banner tone="warning">{checkError}</s-banner>}
          {d.error && !checking && <s-banner tone="warning">{d.error}</s-banner>}
          {d.checkedAt && !checking && (
            <s-text color="subdued">
              Last checked {ago(d.checkedAt)}, {d.answered} answers. Checked again every week.
            </s-text>
          )}
        </s-stack>
      </s-section>

      {d.checkedAt && you && (
        <s-section heading="How often AI names you">
          <div className="sw-ai-top">
            <div className="sw-ai-hero">
              <strong>{pct(you.share)}</strong>
              <span>of AI answers name you</span>
              {change != null && (
                <em className={change > 0 ? "sw-up" : change < 0 ? "sw-down" : ""}>
                  {change > 0 ? `Up ${change} points` : change < 0 ? `Down ${-change} points` : "No change"} since the check before
                </em>
              )}
            </div>
            <div className="sw-ai-platforms">
              {you.platforms.map((p) => (
                <div key={p.name}>
                  <span>{p.name}</span>
                  <strong>{pct(p.share)}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="sw-ai-bars">
            {d.brands.map((b) => (
              <div key={b.key} className={`sw-ai-bar${b.key === "you" ? " sw-ai-you" : ""}`}>
                <span className="sw-ai-name">{b.key === "you" ? `${b.name} (you)` : b.name}</span>
                <span className="sw-ai-track">
                  <i style={{ width: `${b.share ?? 0}%` }} />
                </span>
                <span className="sw-ai-pct">{pct(b.share)}</span>
              </div>
            ))}
          </div>
          {d.history.length > 1 && (
            <div className="sw-ai-history" aria-label="How often you were named on each check">
              {d.history.map((h) => (
                <div key={h.at} title={`${ago(h.at)}: ${pct(h.you)}`}>
                  <b>{pct(h.you)}</b>
                  <i style={{ height: `${Math.max(4, h.you ?? 0)}%` }} />
                  <span>{new Date(h.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                </div>
              ))}
            </div>
          )}
        </s-section>
      )}

      <s-section heading={`Questions shoppers ask (${d.prompts.length} of ${d.max})`}>
        <s-stack gap="base">
          {d.prompts.length === 0 && <s-paragraph>No questions yet. Press Suggest questions, or write the questions your customers would ask.</s-paragraph>}
          {d.prompts.map((p) => (
            <PromptCard key={p.id} p={p} />
          ))}
          <AddPrompt writer={d.writer} full={d.prompts.length >= d.max} />
        </s-stack>
      </s-section>

      {d.sources.length > 0 && (
        <s-section heading="Sites AI assistants quote">
          <s-stack gap="small">
            <s-paragraph>
              The pages the assistants cited in their answers, most quoted first. A mention or a link on these is the surest way into their
              answers.
            </s-paragraph>
            {d.sources.map((s) => (
              <SourceRow key={s.domain} s={s} />
            ))}
          </s-stack>
        </s-section>
      )}
      <style>{CSS}</style>
    </s-page>
  );
}

function PromptCard({ p }: { p: Data["prompts"][number] }) {
  const act = useFetcher<typeof action>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.prompt);
  const [open, setOpen] = useState<string | null>(null);
  const error = act.state === "idle" && act.data && "error" in act.data ? act.data.error : null;
  if (act.state !== "idle" && act.formData?.get("intent") === "delete") return null;
  const shown = p.answers.find((a) => a.platform === open);

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small">
        {editing ? (
          <s-stack gap="small">
            <s-text-field label="Question" value={draft} onInput={(e) => setDraft(e.currentTarget.value)} details="Changing it starts its answers again." />
            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                onClick={() => {
                  act.submit({ intent: "edit", id: p.id, prompt: draft }, { method: "post" });
                  setEditing(false);
                }}
              >
                Save
              </s-button>
              <s-button variant="tertiary" onClick={() => setEditing(false)}>
                Cancel
              </s-button>
            </s-stack>
          </s-stack>
        ) : (
          <div className="sw-ai-q">
            <strong>“{p.prompt}”</strong>
            <span>
              <s-button variant="tertiary" onClick={() => setEditing(true)}>
                Change
              </s-button>
              <s-button variant="tertiary" tone="critical" onClick={() => act.submit({ intent: "delete", id: p.id }, { method: "post" })}>
                Delete
              </s-button>
            </span>
          </div>
        )}
        {error && <s-banner tone="warning">{error}</s-banner>}
        <div className="sw-ai-answers">
          {p.answers.map((a) => (
            <button
              key={a.platform}
              type="button"
              className={`sw-ai-ans${a.platform === open ? " sw-ai-open" : ""}${!a.asked || a.error ? " sw-ai-none" : a.you ? " sw-ai-yes" : " sw-ai-no"}`}
              disabled={!a.asked || !!a.error}
              onClick={() => setOpen(open === a.platform ? null : a.platform)}
            >
              <span className="sw-ai-plat">{a.platform}</span>
              <strong>{!a.asked ? "Not asked yet" : a.error ? "Didn't answer" : a.you ? `Named you${a.named.length > 1 ? ` (#${a.you} of ${a.named.length})` : ""}` : "Didn't name you"}</strong>
              {a.named.filter((n) => n.key !== "you").length > 0 && (
                <span className="sw-ai-others">
                  Named{" "}
                  {a.named
                    .filter((n) => n.key !== "you")
                    .map((n) => n.name)
                    .join(", ")}
                </span>
              )}
              {a.asked && !a.error && <span className="sw-ai-read">{a.platform === open ? "Hide the answer" : "Read the answer"}</span>}
            </button>
          ))}
        </div>
        {shown && (
          <div className="sw-ai-text">
            <p>{shown.text || "The answer had no words in it."}</p>
            {shown.sources.length > 0 && (
              <div className="sw-ai-cites">
                <span>Sources it quoted:</span>
                {shown.sources.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                    {s.domain}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </s-stack>
    </s-box>
  );
}

function AddPrompt({ writer, full }: { writer: boolean; full: boolean }) {
  const add = useFetcher<typeof action>();
  const suggest = useFetcher<typeof action>();
  const [prompt, setPrompt] = useState("");
  const addError = add.state === "idle" && add.data && "error" in add.data ? add.data.error : null;
  const suggestData = suggest.state === "idle" ? suggest.data : undefined;
  if (full) return <s-text color="subdued">That&apos;s the most questions. Delete one to ask another.</s-text>;
  return (
    <s-stack gap="small">
      <s-stack direction="inline" gap="small" alignItems="end">
        <div style={{ flex: "1 1 320px" }}>
          <s-text-field label="Add a question" placeholder="Where can I buy luxury gift boxes in the UK?" value={prompt} onInput={(e) => setPrompt(e.currentTarget.value)} />
        </div>
        <s-button
          loading={add.state !== "idle"}
          disabled={!prompt.trim()}
          onClick={() => {
            add.submit({ intent: "add", prompt }, { method: "post" });
            setPrompt("");
          }}
        >
          Add
        </s-button>
        {writer && (
          <s-button variant="secondary" loading={suggest.state !== "idle"} onClick={() => suggest.submit({ intent: "suggest" }, { method: "post" })}>
            Suggest questions
          </s-button>
        )}
      </s-stack>
      {addError && <s-banner tone="warning">{addError}</s-banner>}
      {suggestData && "error" in suggestData && <s-banner tone="warning">{suggestData.error}</s-banner>}
      {suggestData && "count" in suggestData && <s-banner tone="success">{suggestData.count} questions added. Press Check now to ask them.</s-banner>}
    </s-stack>
  );
}

function SourceRow({ s }: { s: Data["sources"][number] }) {
  const pitch = useFetcher<{ id?: string; error?: string }>();
  const started = pitch.data && "id" in pitch.data;
  return (
    <div className="sw-ai-src">
      <a href={`https://${s.domain}`} target="_blank" rel="noreferrer">
        {s.domain}
      </a>
      <span className="sw-ai-count">{s.count === 1 ? "Quoted once" : `Quoted ${s.count} times`}</span>
      {s.brand === "you" ? (
        <s-badge tone="success">Your site</s-badge>
      ) : s.brand ? (
        <s-badge tone="warning">Competitor</s-badge>
      ) : started ? (
        <s-link href="/app/outreach">Email written. Open Outreach emails</s-link>
      ) : (
        <s-button variant="tertiary" loading={pitch.state !== "idle"} onClick={() => pitch.submit({ intent: "start", domain: s.domain }, { method: "post", action: "/app/outreach" })}>
          Ask them to mention you
        </s-button>
      )}
      {pitch.data?.error && <s-text tone="critical">{pitch.data.error}</s-text>}
    </div>
  );
}

const CSS = `
.sw-ai-top { display: flex; flex-wrap: wrap; gap: 16px; align-items: stretch; margin-bottom: 16px; }
.sw-ai-hero { flex: 1 1 220px; display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; border-radius: 12px; background: #f4f8fd; border: 1px solid #c9dcf3; }
.sw-ai-hero strong { font-size: 34px; line-height: 1.1; color: #1f5199; }
.sw-ai-hero span { color: #303030; }
.sw-ai-hero em { font-style: normal; font-size: 12px; color: #616161; margin-top: 4px; }
.sw-ai-hero em.sw-up { color: #0f6e45; } .sw-ai-hero em.sw-down { color: #c4291c; }
.sw-ai-platforms { flex: 2 1 300px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.sw-ai-platforms div { display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 12px 14px; border: 1px solid #e3e3e3; border-radius: 12px; font-size: 12px; color: #616161; }
.sw-ai-platforms strong { font-size: 22px; color: #303030; }
.sw-ai-bars { display: flex; flex-direction: column; gap: 8px; }
.sw-ai-bar { display: grid; grid-template-columns: minmax(90px, 200px) 1fr 44px; gap: 10px; align-items: center; font-size: 13px; color: #303030; }
.sw-ai-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sw-ai-track { height: 10px; border-radius: 4px; background: #f1f1f1; overflow: hidden; }
.sw-ai-track i { display: block; height: 100%; border-radius: 4px; background: #8a8a8a; }
.sw-ai-you .sw-ai-track i { background: #2a78d6; }
.sw-ai-you .sw-ai-name { font-weight: 600; }
.sw-ai-pct { text-align: right; font-variant-numeric: tabular-nums; }
.sw-ai-history { display: flex; align-items: flex-end; gap: 6px; height: 110px; margin-top: 18px; padding-top: 6px; border-top: 1px solid #f1f1f1; }
.sw-ai-history div { flex: 1; max-width: 44px; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; }
.sw-ai-history b { font-size: 11px; font-weight: 600; color: #303030; }
.sw-ai-history i { display: block; width: 100%; max-height: calc(100% - 34px); border-radius: 4px 4px 0 0; background: #2a78d6; }
.sw-ai-history span { font-size: 10px; color: #8a8a8a; white-space: nowrap; }
.sw-ai-q { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; }
.sw-ai-q strong { font-size: 14px; color: #303030; }
.sw-ai-answers { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
.sw-ai-ans { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border: 1px solid #e3e3e3; border-left-width: 4px; border-radius: 10px; background: #fff; text-align: left; font: inherit; font-size: 12px; color: #616161; cursor: pointer; }
.sw-ai-ans strong { font-size: 13px; color: #303030; }
.sw-ai-ans:disabled { cursor: default; }
.sw-ai-yes { border-left-color: #1baf7a; background: #f3fbf7; }
.sw-ai-no { border-left-color: #e5484d; }
.sw-ai-none { border-left-color: #d4d4d4; background: #fafafa; }
.sw-ai-open { outline: 2px solid #2a78d6; outline-offset: 1px; }
.sw-ai-plat { font-weight: 600; color: #4a4a4a; }
.sw-ai-read { color: #2a78d6; margin-top: 2px; }
.sw-ai-text { padding: 12px 14px; border-radius: 10px; background: #f7f7f7; font-size: 13px; line-height: 1.5; color: #303030; }
.sw-ai-text p { margin: 0; white-space: pre-wrap; max-height: 360px; overflow: auto; }
.sw-ai-cites { display: flex; flex-wrap: wrap; gap: 6px 10px; margin-top: 10px; font-size: 12px; color: #616161; }
.sw-ai-cites a { color: #2a78d6; }
.sw-ai-src { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 8px 0; border-bottom: 1px solid #f1f1f1; font-size: 13px; }
.sw-ai-src a { color: #2a78d6; font-weight: 600; min-width: 160px; }
.sw-ai-count { color: #616161; min-width: 110px; }
`;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
