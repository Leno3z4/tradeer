import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, Eye, EyeOff, KeyRound, Send, Settings2, ShieldCheck, Wrench } from "lucide-react";
import { isOpen, maxLeverage, type AccountState, type LogEntry, type Market } from "../lib/agenthub";
import {
  buildSnapshot,
  QWEN_BASES,
  QWEN_MODELS,
  qwenChat,
  qwenHost,
  SYSTEM_PROMPT,
  type ChatResult,
  type QwenMessage,
} from "../lib/qwen";

/* ------------------------------------------------------------------ */
/* Qwen copilot: the LLM sees a live market + account snapshot each    */
/* turn and may call agent tools. Read-only tools auto-execute; every  */
/* state-changing tool is gated behind an explicit user approval.      */
/* ------------------------------------------------------------------ */

interface ParsedCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface Msg {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  content: string;
  calls?: ParsedCall[];
  toolName?: string;
  callIdRef?: string;
  local?: boolean;
}

const READ_ONLY = new Set(["get_markets", "get_account"]);
const WELCOME: Omit<Msg, "id"> = {
  role: "assistant",
  local: true,
  content:
    "Copilot online. I read the live AgentHub context (markets, account, lb) on every turn and can look things up freely. Placing, cancelling or flattening always requires your explicit approval here — I never act alone.\n\nTry: “What markets are open?” or “Summarize my positions.”",
};

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  const s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return { _raw: raw };
  }
}

function toWire(msgs: Msg[]): QwenMessage[] {
  const out: QwenMessage[] = [];
  for (const m of msgs) {
    if (m.local || m.role === "error") continue;
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "tool")
      out.push({ role: "tool", tool_call_id: m.callIdRef ?? "", name: m.toolName, content: m.content });
    else if (m.calls && m.calls.length)
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })),
      });
    else out.push({ role: "assistant", content: m.content });
  }
  return out;
}

export default function Copilot({
  markets,
  acct,
  onPlaceOrder,
  onCancelOid,
  onKill,
  pushLog,
}: {
  markets: Market[];
  acct: AccountState | null;
  onPlaceOrder: (body: Record<string, unknown>) => Promise<string>;
  onCancelOid: (oid: string | number) => Promise<string>;
  onKill: () => Promise<string>;
  pushLog: (method: string, path: string, kind: LogEntry["kind"], ms?: number, note?: string) => void;
}) {
  /* --- settings (key never leaves this browser except to the model endpoint) --- */
  const [apiKey, setApiKey] = useState(() => {
    try {
      return sessionStorage.getItem("ahq.qwen") ?? "";
    } catch {
      return "";
    }
  });
  const [remember, setRemember] = useState(() => {
    try {
      return sessionStorage.getItem("ahq.qwen") != null;
    } catch {
      return false;
    }
  });
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState<string>(QWEN_BASES[0].url);
  const [model, setModel] = useState(QWEN_MODELS[0]);
  const [settingsOpen, setSettingsOpen] = useState(() => {
    try {
      return sessionStorage.getItem("ahq.qwen") == null;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      if (remember && apiKey) sessionStorage.setItem("ahq.qwen", apiKey);
      else sessionStorage.removeItem("ahq.qwen");
    } catch {
      /* private mode etc. */
    }
  }, [apiKey, remember]);

  /* --- conversation --- */
  const idRef = useRef(0);
  const convRef = useRef<Msg[]>([{ ...WELCOME, id: "welcome" }]);
  const [msgs, setMsgs] = useState<Msg[]>(convRef.current);
  const [pending, setPending] = useState<ParsedCall[] | null>(null);
  const [killArmed, setKillArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy, pending]);

  /* fresh-data refs so the async loop never reads stale props */
  const marketsRef = useRef(markets);
  const acctRef = useRef(acct);
  const cfgRef = useRef({ baseUrl, apiKey, model });
  marketsRef.current = markets;
  acctRef.current = acct;
  cfgRef.current = { baseUrl, apiKey, model };
  useEffect(() => setKillArmed(false), [pending]);

  function append(m: Omit<Msg, "id"> & { callIdRef?: string }) {
    convRef.current = [...convRef.current, { ...m, id: `m${++idRef.current}` }];
    setMsgs(convRef.current);
  }

  /* --- tool execution (same validated pipeline as the manual ticket) --- */
  async function execTool(c: ParsedCall): Promise<string> {
    const mkts = marketsRef.current;
    const acctNow = acctRef.current;
    if (c.name === "get_markets") {
      return JSON.stringify({
        note: "live snapshot",
        markets: mkts.map((m) => ({
          id: m.id,
          symbol: m.symbol,
          open: isOpen(m),
          mid: m.state?.mid,
          bid: m.state?.bid,
          ask: m.state?.ask,
          oi: m.state?.oi,
          funding: m.funding?.rate,
          max_lev: maxLeverage(m),
        })),
      });
    }
    if (c.name === "get_account") {
      return JSON.stringify({
        note: "private state snapshot",
        status: acctNow?.status ?? "unavailable",
        lb: acctNow?.lb ?? null,
        trading_enabled: acctNow?.trading_enabled !== false,
        account: acctNow?.account ?? null,
        open_orders: acctNow?.open_orders ?? [],
        positions: acctNow?.positions ?? [],
      });
    }
    if (c.name === "place_order") {
      const sym = String(c.args.symbol ?? "").toUpperCase();
      const m =
        mkts.find((x) => (x.symbol ?? "").toUpperCase() === sym) ??
        mkts.find((x) => sym.length > 1 && (x.symbol ?? "").toUpperCase().includes(sym));
      if (!m || m.id == null) return `ERROR: no market matches "${c.args.symbol}" in the live snapshot.`;
      if (!isOpen(m)) return `ERROR: ${m.symbol} is closed — closed markets cannot be traded.`;
      const s = Number(c.args.size);
      const lv = Number(c.args.leverage);
      if (!Number.isFinite(s) || s <= 0) return "ERROR: size must be a positive number.";
      if (!Number.isFinite(lv) || lv <= 0) return "ERROR: leverage must be a positive number.";
      const maxLev = maxLeverage(m);
      if (maxLev != null && lv > maxLev) return `ERROR: leverage ${lv}x exceeds ${m.symbol} max ${maxLev}x (initial margin).`;
      const fl = [0, 1, 2, 4].includes(Number(c.args.flags ?? 0)) ? Number(c.args.flags ?? 0) : 0;
      const side = c.args.side === "sell" ? "sell" : "buy";
      const p = c.args.price != null && c.args.price !== "" ? Number(c.args.price) : undefined;
      if (p !== undefined && (!Number.isFinite(p) || p <= 0)) return "ERROR: limit price must be positive.";
      const body: Record<string, unknown> = { mkt: m.id, t: p !== undefined ? 2 : 1, s, lv, fl, side };
      if (p !== undefined) body.p = p;
      return await onPlaceOrder(body);
    }
    if (c.name === "cancel_order") {
      const oid = c.args.oid as string | number;
      if (oid === undefined || oid === null || oid === "") return "ERROR: cancel_order needs an oid from the open orders list.";
      return await onCancelOid(oid);
    }
    if (c.name === "kill_switch") return await onKill();
    return `ERROR: unknown tool ${c.name}`;
  }

  /* --- model loop: up to 5 rounds; stops on text or gated actions --- */
  async function drive() {
    setBusy(true);
    try {
      for (let round = 0; round < 5; round++) {
        const wire: QwenMessage[] = [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildSnapshot(marketsRef.current, acctRef.current) },
          ...toWire(convRef.current),
        ];
        const t0 = performance.now();
        let res: ChatResult;
        try {
          res = await qwenChat(cfgRef.current, wire);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown error";
          pushLog("AI", "chat/completions", "err", undefined, msg.slice(0, 26));
          append({ role: "error", content: `Qwen call failed — ${msg}` });
          return;
        }
        pushLog(
          "AI",
          "chat/completions",
          "ok",
          Math.round(performance.now() - t0),
          res.toolCalls.length ? `tool:${res.toolCalls[0].function?.name}` : `${res.content.length}ch`,
        );

        if (res.toolCalls.length > 0) {
          const parsed: ParsedCall[] = res.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.function?.name ?? "?",
            args: parseArgs(tc.function?.arguments),
          }));
          append({ role: "assistant", content: res.content || "", calls: parsed });
          const auto = parsed.filter((c) => READ_ONLY.has(c.name));
          const gated = parsed.filter((c) => !READ_ONLY.has(c.name));
          for (const c of auto) {
            let out: string;
            try {
              out = await execTool(c);
            } catch (e) {
              out = `ERROR: ${e instanceof Error ? e.message : "execution failed"}`;
            }
            append({ role: "tool", toolName: c.name, content: out, callIdRef: c.id });
          }
          if (gated.length > 0) {
            setPending(gated);
            return;
          }
        } else {
          if (res.content) append({ role: "assistant", content: res.content });
          return;
        }
      }
      append({ role: "assistant", content: "Stopped after 5 tool rounds — ask again if you need more." });
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const text = input.trim();
    if (!text || busy || pending) return;
    if (!cfgRef.current.apiKey) {
      setSettingsOpen(true);
      append({
        role: "error",
        content: "Add your Qwen API key in copilot settings first. It stays in this browser and is sent only to the model endpoint.",
      });
      return;
    }
    setInput("");
    append({ role: "user", content: text });
    drive();
  }

  async function approve() {
    const calls = pending;
    if (!calls) return;
    setPending(null);
    setBusy(true);
    try {
      for (const c of calls) {
        let out: string;
        try {
          out = await execTool(c);
        } catch (e) {
          out = `ERROR: ${e instanceof Error ? e.message : "execution failed"}`;
        }
        append({ role: "tool", toolName: c.name, content: out, callIdRef: c.id });
      }
    } finally {
      setBusy(false);
    }
    drive();
  }

  function reject() {
    const calls = pending;
    if (!calls) return;
    setPending(null);
    for (const c of calls) {
      append({ role: "tool", toolName: c.name, content: "Rejected by user. Do not retry without new instructions.", callIdRef: c.id });
    }
    drive();
  }

  const hasKill = pending?.some((c) => c.name === "kill_switch") ?? false;
  const gatedLabel = pending ? (hasKill ? "KILL SWITCH" : `${pending.length} action${pending.length > 1 ? "s" : ""}`) : "";

  const inputCls =
    "w-full rounded border border-ink-600 bg-ink-800/70 px-2.5 py-1.5 font-mono text-[12px] text-ink-50 placeholder:text-ink-500 outline-none transition-colors focus:border-cy-400";

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-ink-700 bg-ink-850/85 shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-ink-700 px-3.5 py-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded border border-cy-500/50 bg-cy-500/10 text-cy-300">
          <Bot size={14} />
        </div>
        <div className="leading-tight">
          <div className="font-display text-[12.5px] font-bold uppercase tracking-[0.16em]">Qwen copilot</div>
          <div className="font-mono text-[9.5px] text-ink-400">
            {model} · ctx {markets.length} mkts / {acct?.status ?? "no state"}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${apiKey ? "bg-mint-400 dot-live" : "bg-rosex-400"}`}
            title={apiKey ? "API key set" : "No API key"}
          />
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className={`flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] transition-colors ${
              settingsOpen
                ? "border-cy-500/50 bg-cy-500/10 text-cy-300"
                : "border-ink-600 bg-ink-800/60 text-ink-400 hover:text-ink-200"
            }`}
          >
            <Settings2 size={11} /> setup
          </button>
        </div>
      </div>

      {/* settings drawer */}
      {settingsOpen && (
        <div className="border-b border-ink-700 bg-ink-900/70 px-3.5 py-3 animate-[fadeSlide_0.2s_ease-out]">
          <div className="grid gap-2.5 sm:grid-cols-[1fr_auto]">
            <div>
              <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.16em] text-ink-400">
                Model endpoint (OpenAI-compatible)
              </label>
              <input className={inputCls} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
              <div className="mt-1.5 flex gap-1.5">
                {QWEN_BASES.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBaseUrl(b.url)}
                    className={`rounded border px-2 py-0.5 font-mono text-[9.5px] transition-colors ${
                      baseUrl === b.url
                        ? "border-cy-500/60 bg-cy-500/10 text-cy-300"
                        : "border-ink-600 text-ink-400 hover:text-ink-200"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm:w-44">
              <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.16em] text-ink-400">Model</label>
              <select className={inputCls} value={model} onChange={(e) => setModel(e.target.value)}>
                {QWEN_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-2.5">
            <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.16em] text-ink-400">
              DashScope API key — <span className="text-cy-300">sk-…</span>
            </label>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <KeyRound size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500" />
                <input
                  className={`${inputCls} pl-7 pr-8`}
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  placeholder="paste key — never stored in code or logs"
                  onChange={(e) => setApiKey(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 transition-colors hover:text-ink-200"
                  title={showKey ? "Hide" : "Show"}
                >
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[10.5px] text-ink-300">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-500" />
              keep for this browser session only (sessionStorage — cleared when the tab closes)
            </label>
          </div>

          <p className="mt-2.5 flex items-start gap-1.5 font-mono text-[9.5px] leading-relaxed text-ink-500">
            <ShieldCheck size={11} className="mt-px shrink-0 text-mint-400" />
            The key is sent only to <span className="text-ink-300">{qwenHost(baseUrl)}</span> as a Bearer header — never to AgentHub,
            never to source control, never to the activity log. Get one from Alibaba Cloud Model Studio (Bailian).
          </p>
        </div>
      )}

      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3.5">
        {msgs.map((m) => (
          <MsgBubble key={m.id} m={m} />
        ))}
        {busy && !pending && (
          <div className="flex items-center gap-2 self-start rounded border border-ink-700 bg-ink-800/60 px-3 py-2">
            <Bot size={12} className="text-cy-300" />
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-cy-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </span>
            <span className="font-mono text-[10px] text-ink-400">thinking · {model}</span>
          </div>
        )}
      </div>

      {/* approval gate */}
      {pending && (
        <div className="border-t border-amberx-500/40 bg-amberx-500/10 px-3.5 py-3 animate-[fadeSlide_0.2s_ease-out]">
          <div className="flex items-center gap-2">
            <Wrench size={13} className="text-amberx-300" />
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-amberx-300">
              Approval required · {gatedLabel}
            </span>
          </div>
          <div className="mt-2 space-y-1.5">
            {pending.map((c) => (
              <div key={c.id} className="rounded border border-ink-600 bg-ink-900/70 px-2.5 py-1.5 font-mono text-[10.5px]">
                <span className={c.name === "kill_switch" ? "font-semibold text-rosex-300" : "font-semibold text-cy-300"}>{c.name}</span>
                <span className="ml-2 text-ink-300">{JSON.stringify(c.args)}</span>
              </div>
            ))}
          </div>
          {hasKill && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[10.5px] text-ink-200">
              <input type="checkbox" checked={killArmed} onChange={(e) => setKillArmed(e.target.checked)} className="h-3.5 w-3.5 accent-rose-500" />
              I understand this flattens the delegated account.
            </label>
          )}
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={approve}
              disabled={hasKill && !killArmed}
              className={`flex-1 rounded border py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition-all ${
                hasKill
                  ? "border-rosex-500/70 bg-rosex-500/15 text-rosex-300 hover:bg-rosex-500/25 disabled:opacity-40"
                  : "border-mint-500/70 bg-mint-500/15 text-mint-300 hover:bg-mint-500/25"
              }`}
            >
              Execute
            </button>
            <button
              type="button"
              onClick={reject}
              className="flex-1 rounded border border-ink-600 bg-ink-800/60 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-300 transition-colors hover:text-ink-100"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* input */}
      <div className="border-t border-ink-700 p-2.5">
        <div className="flex gap-2">
          <input
            className={`${inputCls} py-2`}
            placeholder={pending ? "Resolve the pending action first…" : "Ask about markets, positions, or instruct a trade…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={busy || !!pending}
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || !!pending || !input.trim()}
            className="flex w-20 shrink-0 items-center justify-center gap-1.5 rounded border border-cy-500/60 bg-cy-500/15 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-cy-300 transition-all hover:bg-cy-500/25 hover:shadow-[0_0_18px_rgba(34,211,238,0.25)] disabled:opacity-40 disabled:hover:shadow-none"
          >
            <Send size={12} /> Send
          </button>
        </div>
        <p className="mt-1.5 px-0.5 font-mono text-[9px] leading-relaxed text-ink-500">
          Fresh context injected each turn · trades execute through the same validated AgentHub pipeline ·{" "}
          <AlertTriangle size={9} className="inline text-amberx-400" /> nothing the model says is advice
        </p>
      </div>
    </div>
  );
}

function MsgBubble({ m }: { m: Msg }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end animate-[fadeSlide_0.2s_ease-out]">
        <div className="max-w-[88%] rounded border border-cy-500/40 bg-cy-500/10 px-3 py-2 text-[12.5px] leading-relaxed text-ink-50 whitespace-pre-wrap">
          {m.content}
        </div>
      </div>
    );
  }
  if (m.role === "error") {
    return (
      <div className="flex animate-[fadeSlide_0.2s_ease-out]">
        <div className="flex max-w-[92%] items-start gap-2 rounded border border-rosex-500/40 bg-rosex-500/10 px-3 py-2 text-[11.5px] leading-relaxed text-rosex-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {m.content}
        </div>
      </div>
    );
  }
  if (m.role === "tool") {
    let pretty = m.content;
    try {
      pretty = JSON.stringify(JSON.parse(m.content), null, 1);
    } catch {
      /* not json */
    }
    return (
      <details className="rounded border border-ink-700 bg-ink-900/60 animate-[fadeSlide_0.2s_ease-out]">
        <summary className="cursor-pointer select-none px-2.5 py-1.5 font-mono text-[10.5px] text-ink-400 transition-colors hover:text-ink-200">
          <span className="text-mint-300">↩ {m.toolName}</span>
          <span className="ml-2 text-ink-500">{m.content.startsWith("ERROR") ? m.content.slice(0, 70) : "result"}</span>
        </summary>
        <pre className="max-h-44 overflow-auto border-t border-ink-800 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-ink-300">
          {pretty}
        </pre>
      </details>
    );
  }
  /* assistant */
  return (
    <div className="flex animate-[fadeSlide_0.2s_ease-out]">
      <div className="max-w-[92%] rounded border border-ink-700 bg-ink-800/60 px-3 py-2">
        {m.calls && m.calls.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {m.calls.map((c) => (
              <span
                key={c.id}
                className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9.5px] ${
                  READ_ONLY.has(c.name)
                    ? "border-ink-600 bg-ink-900/70 text-ink-300"
                    : c.name === "kill_switch"
                      ? "border-rosex-500/50 bg-rosex-500/10 text-rosex-300"
                      : "border-amberx-500/50 bg-amberx-500/10 text-amberx-300"
                }`}
              >
                ⚙ {c.name}
                {c.args.symbol ? ` ${String(c.args.symbol)}` : ""}
                {c.args.side ? ` ${String(c.args.side)}` : ""}
                {c.args.size != null ? ` ${String(c.args.size)}` : ""}
                {c.args.leverage != null ? ` @${String(c.args.leverage)}x` : ""}
              </span>
            ))}
          </div>
        )}
        {m.content && <div className="text-[12.5px] leading-relaxed text-ink-100 whitespace-pre-wrap">{m.content}</div>}
      </div>
    </div>
  );
}
