import { useState } from "react";
import { AlertTriangle, Check, Inbox, X } from "lucide-react";
import { fmtNum, fmtPrice, type AccountState, type Market, type Order } from "../lib/agenthub";
import { Btn, EmptyState, Section, Stat, StatusPill } from "./shared";

export default function StatePanel({
  state,
  stateError,
  stateErrorCode,
  marketsById,
  busyOid,
  onCancel,
  onModify,
}: {
  state: AccountState | null;
  stateError: string | null;
  stateErrorCode: string | null;
  marketsById: Map<number, Market>;
  busyOid: string | number | null;
  onCancel: (o: Order) => void;
  onModify: (o: Order, patch: { s: number; lv: number; p?: number }) => void;
}) {
  const acct = state?.account ?? {};
  const orders = state?.open_orders ?? [];
  const positions = state?.positions ?? [];
  const upl = positions.reduce((a, p) => a + (Number(p.upl) || 0), 0);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/* enrollment / state error banner */}
      {stateError && (
        <div className="flex items-start gap-2.5 rounded-md border border-amberx-500/40 bg-amberx-500/10 p-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amberx-400" />
          <div className="text-[12px] leading-relaxed text-amberx-300">
            <div className="font-mono font-semibold">
              {stateErrorCode === "perpl_enrollment_required" ? "Perpl enrollment required" : "Private state unavailable"}
            </div>
            {stateErrorCode === "perpl_enrollment_required" ? (
              <>
                Your Perpl API credentials aren't connected to AgentHub yet. Create a read+trade key (
                <a className="underline hover:text-amberx-200" href="https://app.perpl.xyz/apikeys" target="_blank" rel="noreferrer">
                  mainnet
                </a>{" "}
                /{" "}
                <a className="underline hover:text-amberx-200" href="https://testnet.perpl.xyz/apikeys" target="_blank" rel="noreferrer">
                  testnet
                </a>
                ) and add it in AgentHub. Markets remain available — this only affects your private account. Never use a wallet
                seed phrase or wallet private key.
              </>
            ) : (
              <>The private Perpl session isn't synchronized. {stateError} Public market data is unaffected.</>
            )}
          </div>
        </div>
      )}

      {/* account stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Balance" value={fmtNum(acct.balance)} sub="USDC" />
        <Stat label="Equity" value={fmtNum(acct.equity)} tone="cy" />
        <Stat label="Available" value={fmtNum(acct.available)} tone="mint" sub={`locked ${fmtNum(acct.locked)}`} />
        <Stat label="Open uPnL" value={fmtNum(upl)} tone={upl >= 0 ? "mint" : "rose"} sub={`${positions.length} position${positions.length === 1 ? "" : "s"}`} />
      </div>

      {/* open orders */}
      <Section
        title="Open orders"
        tag={state?.lb != null ? `lb ${state.lb}` : undefined}
        bodyClassName="overflow-y-auto max-h-52"
        right={<StatusPill status={state?.status} />}
      >
        {orders.length === 0 ? (
          <EmptyState icon={<Inbox size={20} />} title="No open orders" note="Working limit orders will appear here with cancel/modify controls." />
        ) : (
          <table className="w-full border-collapse font-mono text-[12px]">
            <thead className="sticky top-0 bg-ink-800/95 text-left">
              <tr className="text-[10px] uppercase tracking-[0.12em] text-ink-400">
                <th className="px-3 py-2 font-medium">OID</th>
                <th className="px-2 py-2 font-medium">Market</th>
                <th className="px-2 py-2 text-right font-medium">Size</th>
                <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">Price</th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">Lev</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <OrderRow
                  key={String(o.oid)}
                  o={o}
                  symbol={marketsById.get(Number(o.mkt))?.symbol ?? `#${o.mkt}`}
                  busy={busyOid === o.oid}
                  onCancel={() => onCancel(o)}
                  onModify={(patch) => onModify(o, patch)}
                />
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* positions */}
      <Section title="Positions" bodyClassName="overflow-y-auto max-h-52">
        {positions.length === 0 ? (
          <EmptyState icon={<Inbox size={20} />} title="Flat — no open positions" note="Filled orders land here, marked to market." />
        ) : (
          <table className="w-full border-collapse font-mono text-[12px]">
            <thead className="sticky top-0 bg-ink-800/95 text-left">
              <tr className="text-[10px] uppercase tracking-[0.12em] text-ink-400">
                <th className="px-3 py-2 font-medium">Market</th>
                <th className="px-2 py-2 font-medium">Side</th>
                <th className="px-2 py-2 text-right font-medium">Size</th>
                <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">Entry</th>
                <th className="px-3 py-2 text-right font-medium">uPnL</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p, i) => {
                const long = String(p.side).toLowerCase() !== "short" && String(p.side).toLowerCase() !== "sell";
                return (
                  <tr key={i} className="border-b border-ink-800/70">
                    <td className="px-3 py-2.5 font-semibold text-ink-50">{p.symbol ?? `#${p.mkt}`}</td>
                    <td className={`px-2 py-2.5 font-semibold uppercase ${long ? "text-mint-300" : "text-rosex-300"}`}>
                      {long ? "Long" : "Short"}
                    </td>
                    <td className="px-2 py-2.5 text-right text-ink-200">{fmtNum(p.s, 4)}</td>
                    <td className="hidden px-2 py-2.5 text-right text-ink-300 sm:table-cell">{fmtPrice(p.entry)}</td>
                    <td className={`px-3 py-2.5 text-right font-semibold ${(Number(p.upl) || 0) >= 0 ? "text-mint-300" : "text-rosex-300"}`}>
                      {(Number(p.upl) || 0) >= 0 ? "+" : ""}
                      {fmtNum(p.upl)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function OrderRow({
  o,
  symbol,
  busy,
  onCancel,
  onModify,
}: {
  o: Order;
  symbol: string;
  busy: boolean;
  onCancel: () => void;
  onModify: (patch: { s: number; lv: number; p?: number }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [s, setS] = useState(String(o.s ?? ""));
  const [lv, setLv] = useState(String(o.lv ?? ""));
  const [p, setP] = useState(o.p != null ? String(o.p) : "");

  const buy = String(o.side).toLowerCase() === "buy" || String(o.side).toLowerCase() === "long";

  function save() {
    const size = Number(s);
    const lev = Number(lv);
    if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(lev) || lev <= 0) return;
    onModify({ s: size, lv: lev, p: p !== "" ? Number(p) : undefined });
    setEditing(false);
  }

  const cell = "px-2 py-2";
  if (editing) {
    return (
      <tr className="border-b border-ink-800/70 bg-cy-500/5">
        <td className="px-3 py-1.5 text-ink-400">#{String(o.oid)}</td>
        <td className={cell}>{symbol}</td>
        <td className={cell}>
          <input className="w-16 rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-right text-[11px] outline-none focus:border-cy-400" value={s} onChange={(e) => setS(e.target.value)} />
        </td>
        <td className={`${cell} hidden sm:table-cell`}>
          <input className="w-20 rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-right text-[11px] outline-none focus:border-cy-400" value={p} onChange={(e) => setP(e.target.value)} placeholder="price" />
        </td>
        <td className={`${cell} hidden md:table-cell`}>
          <input className="w-12 rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-right text-[11px] outline-none focus:border-cy-400" value={lv} onChange={(e) => setLv(e.target.value)} />
        </td>
        <td className="px-3 py-1.5 text-right">
          <span className="inline-flex gap-1.5">
            <Btn variant="mint" onClick={save} disabled={busy} className="px-2 py-1 text-[10.5px]">
              <Check size={12} /> Save
            </Btn>
            <Btn variant="ghost" onClick={() => setEditing(false)} className="px-2 py-1 text-[10.5px]">
              <X size={12} />
            </Btn>
          </span>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-ink-800/70 transition-colors hover:bg-ink-800/50">
      <td className="px-3 py-2.5 text-ink-400">#{String(o.oid)}</td>
      <td className="px-2 py-2.5">
        <span className="font-semibold text-ink-50">{symbol}</span>{" "}
        <span className={`text-[10px] font-semibold uppercase ${buy ? "text-mint-300" : "text-rosex-300"}`}>{buy ? "buy" : "sell"}</span>
      </td>
      <td className="px-2 py-2.5 text-right text-ink-200">{fmtNum(o.s, 4)}</td>
      <td className="hidden px-2 py-2.5 text-right text-ink-300 sm:table-cell">{o.p != null ? fmtPrice(o.p) : "mkt"}</td>
      <td className="hidden px-2 py-2.5 text-right text-ink-300 md:table-cell">{o.lv != null ? `${o.lv}x` : "—"}</td>
      <td className="px-3 py-2.5 text-right">
        <span className="inline-flex gap-1.5">
          <Btn variant="ghost" onClick={() => setEditing(true)} disabled={busy} className="px-2 py-1 text-[10.5px]">
            Modify
          </Btn>
          <Btn variant="danger" onClick={onCancel} disabled={busy} className="px-2 py-1 text-[10.5px]">
            {busy ? "…" : "Cancel"}
          </Btn>
        </span>
      </td>
    </tr>
  );
}
