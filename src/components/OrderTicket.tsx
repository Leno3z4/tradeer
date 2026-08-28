import { useMemo, useState } from "react";
import { AlertTriangle, Power, Send, Zap } from "lucide-react";
import {
  fmtPrice,
  isOpen,
  maxLeverage,
  ORDER_FLAGS,
  ORDER_TYPES,
  type AccountState,
  type Market,
} from "../lib/agenthub";
import { Btn, Section } from "./shared";

export default function OrderTicket({
  markets,
  selected,
  selectedId,
  onSelect,
  onSubmit,
  busy,
  state,
  notice,
}: {
  markets: Market[];
  selected: Market | null;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onSubmit: (body: Record<string, unknown>) => void;
  busy: boolean;
  state: AccountState | null;
  notice: { kind: "ok" | "err"; text: string } | null;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState(1);
  const [size, setSize] = useState("");
  const [lev, setLev] = useState("");
  const [flags, setFlags] = useState(0);
  const [price, setPrice] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const openMarkets = markets;
  const maxLev = selected ? maxLeverage(selected) : null;
  const isLimit = type !== 1;

  const marketOk = !!selected && isOpen(selected);
  const stateOk = state?.status === "connected";
  const tradeEnabled = state?.trading_enabled !== false;
  const canTrade = marketOk && stateOk && tradeEnabled;

  const hint = useMemo(() => {
    if (!selected) return "Select an open market from the list to build an order.";
    if (!isOpen(selected)) return `${selected.symbol} is closed — closed markets can't be traded.`;
    if (!stateOk) return "Private state isn't connected/fresh. Refresh before trading.";
    if (!tradeEnabled) return "Trading is disabled on this account.";
    return null;
  }, [selected, stateOk, tradeEnabled]);

  function submit() {
    setErr(null);
    if (!selected || selected.id == null) return setErr("Select a market.");
    if (!isOpen(selected)) return setErr("That market is closed.");
    if (!stateOk) return setErr("Private state is not connected and fresh — refresh first.");
    const s = Number(size);
    const lv = Number(lev);
    if (!Number.isFinite(s) || s <= 0) return setErr("Size must be a positive number.");
    if (!Number.isFinite(lv) || lv <= 0) return setErr("Leverage must be a positive number.");
    if (maxLev != null && lv > maxLev) return setErr(`Leverage exceeds the market max of ${maxLev}x (initial margin).`);
    if (isLimit) {
      const p = Number(price);
      if (!Number.isFinite(p) || p <= 0) return setErr("Limit orders need a positive price.");
    }
    const body: Record<string, unknown> = {
      mkt: selected.id,
      t: type,
      s,
      lv,
      fl: flags,
      side,
    };
    if (isLimit) body.p = Number(price);
    onSubmit(body);
    setSize("");
    setPrice("");
  }

  const inputCls =
    "w-full rounded border border-ink-600 bg-ink-800/70 px-2.5 py-1.5 font-mono text-[12.5px] text-ink-50 placeholder:text-ink-500 outline-none transition-colors focus:border-cy-400";
  const labelCls = "mb-1 block font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-400";

  return (
    <>
      <Section title="Order ticket" tag={selected ? selected.symbol : "no market"} className="h-full">
        <div className="flex flex-col gap-3.5 p-4">
          {/* market */}
          <div>
            <label className={labelCls}>Market (live discovery)</label>
            <select
              className={inputCls}
              value={selectedId ?? ""}
              onChange={(e) => onSelect(Number(e.target.value))}
            >
              <option value="" disabled>
                Select market…
              </option>
              {openMarkets.map((m) => (
                <option key={String(m.id)} value={m.id} disabled={!isOpen(m)}>
                  {m.symbol} {isOpen(m) ? "" : "(closed)"} · id {m.id}
                </option>
              ))}
            </select>
            {selected && (
              <div className="mt-1 flex items-center justify-between font-mono text-[10.5px] text-ink-400">
                <span>
                  mid <span className="text-ink-100">{fmtPrice(selected.state?.mid, selected.config?.price_decimals)}</span>
                </span>
                <span>{maxLev != null ? `max lev ${maxLev}x` : "max lev —"}</span>
              </div>
            )}
          </div>

          {/* side */}
          <div>
            <label className={labelCls}>Side</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSide("buy")}
                className={`rounded border py-2 font-mono text-[12px] font-semibold uppercase tracking-wider transition-all ${
                  side === "buy"
                    ? "border-mint-500/70 bg-mint-500/15 text-mint-300 shadow-[0_0_16px_rgba(16,185,129,0.2)]"
                    : "border-ink-600 bg-ink-800/60 text-ink-400 hover:text-ink-200"
                }`}
              >
                Buy / Long
              </button>
              <button
                type="button"
                onClick={() => setSide("sell")}
                className={`rounded border py-2 font-mono text-[12px] font-semibold uppercase tracking-wider transition-all ${
                  side === "sell"
                    ? "border-rosex-500/70 bg-rosex-500/15 text-rosex-300 shadow-[0_0_16px_rgba(244,63,94,0.2)]"
                    : "border-ink-600 bg-ink-800/60 text-ink-400 hover:text-ink-200"
                }`}
              >
                Sell / Short
              </button>
            </div>
          </div>

          {/* type + flags */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={labelCls}>Order type</label>
              <select className={inputCls} value={type} onChange={(e) => setType(Number(e.target.value))}>
                {ORDER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Flags</label>
              <select className={inputCls} value={flags} onChange={(e) => setFlags(Number(e.target.value))}>
                {ORDER_FLAGS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* size + leverage */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={labelCls}>Size</label>
              <input className={inputCls} inputMode="decimal" placeholder="0.00" value={size} onChange={(e) => setSize(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Leverage {maxLev != null ? `(≤${maxLev}x)` : ""}</label>
              <div className="flex gap-1.5">
                <input className={inputCls} inputMode="decimal" placeholder="5" value={lev} onChange={(e) => setLev(e.target.value)} />
                {maxLev != null && (
                  <button
                    type="button"
                    onClick={() => setLev(String(maxLev))}
                    className="shrink-0 rounded border border-ink-600 bg-ink-800 px-2 font-mono text-[10px] text-cy-300 transition-colors hover:border-cy-400"
                  >
                    MAX
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* price */}
          <div className={isLimit ? "" : "opacity-40"}>
            <label className={labelCls}>Price {isLimit ? "(required)" : "(market)"}</label>
            <input
              className={inputCls}
              inputMode="decimal"
              placeholder={selected ? fmtPrice(selected.state?.mid, selected.config?.price_decimals) : "—"}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={!isLimit}
            />
          </div>

          {hint && (
            <div className="flex items-start gap-2 rounded border border-ink-600 bg-ink-800/50 p-2.5 text-[11.5px] leading-snug text-ink-300">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amberx-400" />
              {hint}
            </div>
          )}
          {err && (
            <div className="rounded border border-rosex-500/40 bg-rosex-500/10 p-2.5 text-[11.5px] text-rosex-300">{err}</div>
          )}
          {notice && (
            <div
              className={`rounded border p-2.5 font-mono text-[10.5px] leading-relaxed ${
                notice.kind === "ok"
                  ? "border-mint-500/40 bg-mint-500/10 text-mint-300"
                  : "border-rosex-500/40 bg-rosex-500/10 text-rosex-300"
              }`}
            >
              {notice.text}
            </div>
          )}

          <Btn variant={side === "buy" ? "mint" : "danger"} onClick={submit} disabled={busy || !canTrade} className="w-full py-2.5 text-[13px]">
            {busy ? <Zap size={14} className="animate-pulse" /> : <Send size={14} />}
            {busy ? "Submitting…" : `Submit ${side === "buy" ? "buy" : "sell"} · mkt ${selected?.id ?? "—"}`}
          </Btn>

          <p className="text-center font-mono text-[9.5px] leading-relaxed text-ink-500">
            Every fill is verified against fresh private state. Type/flag semantics follow the AgentHub connector (1–7, 0/1/2/4).
          </p>
        </div>
      </Section>
    </>
  );
}

export function KillModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-rosex-500/50 bg-ink-900 p-6 shadow-[0_0_60px_rgba(244,63,94,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded border border-rosex-500/60 bg-rosex-500/15 text-rosex-300">
            <Power size={17} />
          </div>
          <div>
            <div className="font-display text-base font-bold uppercase tracking-widest text-rosex-300">Kill switch</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-400">emergency close · /kill-switch</div>
          </div>
        </div>
        <p className="mt-4 text-[12.5px] leading-relaxed text-ink-200">
          This cancels all active orders and closes all active positions, then verifies the account is flat. It requires{" "}
          <span className="font-mono text-rosex-300">trade:write</span> and <span className="font-mono text-rosex-300">position:close</span>.
        </p>
        <label className="mt-4 flex cursor-pointer items-center gap-2.5 rounded border border-ink-600 bg-ink-800/60 p-3">
          <input type="checkbox" checked={armed} onChange={(e) => setArmed(e.target.checked)} className="h-4 w-4 accent-rose-500" />
          <span className="text-[12px] text-ink-200">I understand this will flatten the delegated account.</span>
        </label>
        <div className="mt-5 flex gap-2.5">
          <Btn variant="ghost" onClick={onClose} className="flex-1 py-2">
            Stand down
          </Btn>
          <Btn variant="danger" onClick={onConfirm} disabled={!armed} className="flex-1 py-2">
            <Power size={14} /> Flatten account
          </Btn>
        </div>
      </div>
    </div>
  );
}
