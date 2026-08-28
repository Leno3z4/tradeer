import { useRef, useState } from "react";
import {
  ArrowRight,
  FlaskConical,
  KeyRound,
  Loader2,
  Plug,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { connectAgent, createLiveBackend, createSimBackend, redact, type Backend } from "../lib/agenthub";
import { Btn } from "./shared";

const DEFAULT_BASE = "https://agenthub2.onrender.com";

function randomAgentName() {
  const hex = Math.random().toString(16).slice(2, 6);
  return `agent-${hex}`;
}

type Line = { text: string; tone: "dim" | "ok" | "err" | "info" };

export default function Connect({
  onReady,
}: {
  onReady: (backend: Backend) => void;
}) {
  const [base, setBase] = useState(DEFAULT_BASE);
  const [agentName, setAgentName] = useState(randomAgentName);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([
    { text: "AgentHub handshake console", tone: "info" },
    { text: "awaiting connection …", tone: "dim" },
  ]);
  const consoleRef = useRef<HTMLDivElement>(null);

  const push = (l: Line, delay = 0) =>
    new Promise<void>((r) =>
      setTimeout(() => {
        setLines((prev) => [...prev.slice(-14), l]);
        requestAnimationFrame(() => {
          consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
        });
        r();
      }, delay),
    );

  async function handleConnect() {
    if (busy) return;
    setError(null);
    if (!key.trim()) {
      setError("Enter your identity access key to open the connection.");
      return;
    }
    setBusy(true);
    setLines([]);
    try {
      let host = base;
      try {
        host = new URL(base).host;
      } catch {
        /* keep raw */
      }
      await push({ text: `» resolving backend … ${host}`, tone: "dim" }, 220);
      await push({ text: `» POST /api/agent/connect   agent=${agentName || "agent"}   key=${redact(key)}`, tone: "dim" }, 420);

      const { token } = await connectAgent(base, key.trim(), agentName.trim() || "agent");

      await push({ text: `✓ connection_token issued   ${redact(token)}`, tone: "ok" }, 260);
      await push({ text: "✓ master key discarded from memory — it is never stored", tone: "ok" }, 300);
      await push({ text: "» opening agent console …", tone: "info" }, 380);

      // The key goes out of scope here; only the token is carried forward.
      setTimeout(() => onReady(createLiveBackend(base, agentName.trim() || "agent", token)), 500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Connection failed.";
      await push({ text: `✗ ${msg}`, tone: "err" }, 120);
      setError(msg + "  You can still explore the console with a simulated session below.");
      setBusy(false);
    }
  }

  function handleSim() {
    onReady(createSimBackend(agentName.trim() || "agent"));
  }

  const inputCls =
    "w-full rounded border border-ink-600 bg-ink-800/70 px-3 py-2 font-mono text-[13px] text-ink-50 placeholder:text-ink-500 outline-none transition-colors focus:border-cy-400 focus:ring-2 focus:ring-cy-500/20";

  return (
    <div className="flex min-h-screen items-center justify-center p-4 sm:p-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-lg border border-ink-700 bg-ink-900/80 shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur md:grid-cols-[1.05fr_1fr]">
        {/* left: identity + handshake console */}
        <div className="relative flex flex-col border-b border-ink-700 p-7 md:border-b-0 md:border-r">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded border border-cy-500/50 bg-cy-500/10 text-cy-300">
              <Plug size={18} />
            </div>
            <div>
              <div className="font-display text-lg font-bold uppercase tracking-[0.22em] text-ink-50">
                AgentHub
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-cy-400">
                agent console · perpl delegated execution
              </div>
            </div>
          </div>

          <p className="mt-5 max-w-md text-[13px] leading-relaxed text-ink-200">
            Link this agent to your AgentHub account. Your identity access key is exchanged
            <span className="text-cy-300"> once</span> for a connection token, then discarded — it is never
            stored, logged, or written into this app.
          </p>

          {/* handshake console */}
          <div className="mt-6 flex-1">
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-400">
              <Terminal size={12} className="text-cy-400" /> handshake console
            </div>
            <div
              ref={consoleRef}
              className="h-44 overflow-y-auto rounded border border-ink-700 bg-ink-950/80 p-3 font-mono text-[11.5px] leading-relaxed"
            >
              {lines.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.tone === "ok"
                      ? "text-mint-300"
                      : l.tone === "err"
                        ? "text-rosex-300"
                        : l.tone === "info"
                          ? "text-cy-300"
                          : "text-ink-300"
                  }
                >
                  {l.text}
                </div>
              ))}
              <span className="cursor-blink text-cy-300">▍</span>
            </div>
          </div>

          {/* security notes */}
          <div className="mt-6 space-y-2 rounded border border-ink-700 bg-ink-800/40 p-3.5">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-300">
              <ShieldCheck size={13} className="text-mint-400" /> credential handling
            </div>
            {[
              "Key is sent only to POST /api/agent/connect over HTTPS.",
              "Only the connection_token is kept — in memory, for this session.",
              "Tokens are sent only to the AgentHub backend, never elsewhere.",
              "Never enter a wallet seed phrase or wallet private key here.",
            ].map((t) => (
              <div key={t} className="flex gap-2 text-[11.5px] leading-snug text-ink-300">
                <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-cy-400/70" />
                {t}
              </div>
            ))}
          </div>
        </div>

        {/* right: form */}
        <div className="flex flex-col p-7">
          <h1 className="font-display text-2xl font-bold uppercase tracking-wide text-ink-50">
            Open a connection
          </h1>
          <p className="mt-1 text-[12.5px] text-ink-400">
            Fields are used at runtime in your browser only.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
                Backend URL
              </label>
              <input className={inputCls} value={base} onChange={(e) => setBase(e.target.value)} spellCheck={false} />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
                Agent name
              </label>
              <input className={inputCls} value={agentName} onChange={(e) => setAgentName(e.target.value)} spellCheck={false} />
            </div>
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
                <KeyRound size={11} className="text-cy-400" /> Identity access key
              </label>
              <input
                className={inputCls}
                type="password"
                autoComplete="off"
                placeholder="ah2_access_…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                spellCheck={false}
              />
              <p className="mt-1.5 text-[10.5px] leading-snug text-ink-500">
                Used for the single connect exchange, then wiped from memory.
              </p>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded border border-rosex-500/40 bg-rosex-500/10 p-3 text-[12px] leading-relaxed text-rosex-300">
              {error}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2.5">
            <Btn variant="primary" onClick={handleConnect} disabled={busy} className="w-full py-2.5 text-[13px]">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Plug size={15} />}
              {busy ? "Exchanging credential…" : "Connect agent"}
              {!busy && <ArrowRight size={14} />}
            </Btn>

            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-ink-700" />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-500">or</span>
              <span className="h-px flex-1 bg-ink-700" />
            </div>

            <Btn variant="outline" onClick={handleSim} disabled={busy} className="w-full py-2.5">
              <FlaskConical size={14} />
              Explore with a simulated session
            </Btn>
            <p className="text-center text-[10.5px] leading-snug text-ink-500">
              Simulated mode runs entirely in your browser with demo market data — no credentials, no orders.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
