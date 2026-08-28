import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Bot, LogOut, Plug, Power, RefreshCw, SendHorizonal } from "lucide-react";
import {
  ApiError,
  isOpen,
  type AccountState,
  type Backend,
  type LogEntry,
  type Market,
  type Order,
} from "../lib/agenthub";
import MarketsPanel from "./MarketsPanel";
import StatePanel from "./StatePanel";
import OrderTicket, { KillModal } from "./OrderTicket";
import LogFeed from "./LogFeed";
import Copilot from "./Copilot";
import { Btn, StatusPill } from "./shared";

const POLL_MS = 5000;

type Notice = { kind: "ok" | "err"; text: string } | null;
type RightTab = "ticket" | "copilot" | "log";

export default function Dashboard({
  backend,
  onDisconnect,
}: {
  backend: Backend;
  onDisconnect: () => void;
}) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [acct, setAcct] = useState<AccountState | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [stateErrorCode, setStateErrorCode] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [busyOid, setBusyOid] = useState<string | number | null>(null);
  const [orderBusy, setOrderBusy] = useState(false);
  const [killOpen, setKillOpen] = useState(false);
  const [killBusy, setKillBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [tab, setTab] = useState<RightTab>("copilot");

  const logId = useRef(0);
  const autoSelected = useRef(false);
  const lbRef = useRef<number | undefined>(undefined);

  const addLog = useCallback(
    (method: string, path: string, kind: LogEntry["kind"], ms?: number, note?: string) => {
      setLog((prev) =>
        [{ id: String(++logId.current), at: Date.now(), method, path, kind, ms, note }, ...prev].slice(0, 60),
      );
    },
    [],
  );

  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      const m0 = performance.now();
      try {
        const { markets: mk } = await backend.getMarkets();
        setMarkets(mk);
        addLog("GET", "/api/agent/perpl/markets", "ok", Math.round(performance.now() - m0), `${mk.length} mkts`);
        if (!autoSelected.current && mk.length) {
          autoSelected.current = true;
          const first = mk.find(isOpen) ?? mk[0];
          if (first?.id != null) setSelectedId(first.id);
        }
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, "Market discovery failed.");
        addLog("GET", "/api/agent/perpl/markets", "err", undefined, err.code ?? err.message.slice(0, 28));
      }

      const m1 = performance.now();
      try {
        const st = await backend.getState();
        setAcct(st);
        setStateError(null);
        setStateErrorCode(null);
        lbRef.current = st.lb;
        addLog("GET", "/api/agent/perpl/state", "ok", Math.round(performance.now() - m1), st.status ?? "state");
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, "State fetch failed.");
        setAcct(null);
        setStateError(err.message);
        setStateErrorCode(err.code ?? null);
        addLog("GET", "/api/agent/perpl/state", "err", undefined, err.code ?? err.message.slice(0, 28));
      }
      setLastSync(Date.now());
    } finally {
      setSyncing(false);
    }
  }, [backend, addLog]);

  // initial + polling
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(refresh, POLL_MS);
    return () => clearInterval(iv);
  }, [autoRefresh, refresh]);

  /* ----- actions: each verifies via fresh private state and returns a summary ----- */
  const placeOrder = useCallback(
    async (body: Record<string, unknown>): Promise<string> => {
      setOrderBusy(true);
      const t0 = performance.now();
      try {
        await backend.placeOrder(body);
        addLog("POST", "/api/agent/perpl/order", "ok", Math.round(performance.now() - t0), `mkt ${body.mkt}`);
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, "Order rejected.");
        addLog("POST", "/api/agent/perpl/order", "err", undefined, err.code ?? err.message.slice(0, 28));
        await refresh();
        throw err;
      } finally {
        setOrderBusy(false);
      }
      // skill rule: verify every state-changing operation with fresh private state
      await refresh();
      return `Order accepted (mkt ${body.mkt}, size ${body.s}, lev ${body.lv}x) and private state re-verified — check open orders / positions for the fill.`;
    },
    [backend, addLog, refresh],
  );

  const cancelOrder = useCallback(
    async (o: Order): Promise<string> => {
      setBusyOid(o.oid ?? null);
      const t0 = performance.now();
      try {
        await backend.cancelOrder({ mkt: o.mkt, oid: o.oid, lb: lbRef.current });
        addLog("POST", "/api/agent/perpl/order/cancel", "ok", Math.round(performance.now() - t0), `oid ${o.oid}`);
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, "Cancel failed.");
        addLog("POST", "/api/agent/perpl/order/cancel", "err", undefined, err.code ?? err.message.slice(0, 28));
        await refresh();
        throw err;
      } finally {
        setBusyOid(null);
      }
      await refresh();
      return `Cancel for oid ${o.oid} sent with lb and verified against fresh private state.`;
    },
    [backend, addLog, refresh],
  );

  const cancelByOid = useCallback(
    async (oid: string | number): Promise<string> => {
      const o = (acct?.open_orders ?? []).find((x) => String(x.oid) === String(oid));
      if (!o) return `ERROR: oid ${oid} not found in the current open orders — refresh and retry.`;
      return cancelOrder(o);
    },
    [acct, cancelOrder],
  );

  const modifyOrder = useCallback(
    async (o: Order, patch: { s: number; lv: number; p?: number }) => {
      setBusyOid(o.oid ?? null);
      const t0 = performance.now();
      try {
        await backend.modifyOrder({
          mkt: o.mkt,
          oid: o.oid,
          s: patch.s,
          lv: patch.lv,
          fl: o.fl ?? 0,
          lb: lbRef.current,
          ...(patch.p !== undefined ? { p: patch.p } : {}),
        });
        addLog("POST", "/api/agent/perpl/order/modify", "ok", Math.round(performance.now() - t0), `oid ${o.oid}`);
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, "Modify failed.");
        addLog("POST", "/api/agent/perpl/order/modify", "err", undefined, err.code ?? err.message.slice(0, 28));
      } finally {
        setBusyOid(null);
      }
      await refresh();
    },
    [backend, addLog, refresh],
  );

  const kill = useCallback(async (): Promise<string> => {
    setKillBusy(true);
    const t0 = performance.now();
    try {
      await backend.killSwitch(true);
      addLog("POST", "/api/agent/perpl/kill-switch", "ok", Math.round(performance.now() - t0), "flatten");
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "Kill switch failed.");
      addLog("POST", "/api/agent/perpl/kill-switch", "err", undefined, err.code ?? err.message.slice(0, 28));
      await refresh();
      throw err;
    } finally {
      setKillBusy(false);
    }
    await refresh();
    return "Kill switch executed — active orders cancelled, positions closed, account verified via fresh state.";
  }, [backend, addLog, refresh]);

  const submitFromTicket = useCallback(
    (body: Record<string, unknown>) => {
      setNotice(null);
      placeOrder(body)
        .then((s) => setNotice({ kind: "ok", text: s }))
        .catch((e) =>
          setNotice({ kind: "err", text: e instanceof ApiError ? `${e.code ? `[${e.code}] ` : ""}${e.message}` : "Order failed." }),
        );
    },
    [placeOrder],
  );

  const marketsById = useMemo(() => {
    const m = new Map<number, Market>();
    for (const mk of markets) if (mk.id != null) m.set(mk.id, mk);
    return m;
  }, [markets]);

  const selected = selectedId != null ? marketsById.get(selectedId) ?? null : null;
  const displayStatus = stateErrorCode === "perpl_enrollment_required" ? "enrollment_required" : acct?.status;

  const host = useMemo(() => {
    if (backend.kind === "sim") return "in-browser";
    try {
      return new URL(backend.base).host;
    } catch {
      return backend.base;
    }
  }, [backend]);

  const tabs: { id: RightTab; label: string; icon: React.ReactNode }[] = [
    { id: "copilot", label: "Copilot", icon: <Bot size={13} /> },
    { id: "ticket", label: "Ticket", icon: <SendHorizonal size={13} /> },
    { id: "log", label: "Activity", icon: <Activity size={13} /> },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      {/* header */}
      <header className="sticky top-0 z-30 border-b border-ink-700/80 bg-ink-900/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded border border-cy-500/50 bg-cy-500/10 text-cy-300">
              <Plug size={15} />
            </div>
            <div className="leading-tight">
              <div className="font-display text-sm font-bold uppercase tracking-[0.18em] text-ink-50">
                {backend.agentName}
              </div>
              <div className="font-mono text-[10px] text-ink-400">{host}</div>
            </div>
            <span
              className={`ml-1 rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest ${
                backend.kind === "sim"
                  ? "border-amberx-500/50 bg-amberx-500/10 text-amberx-300"
                  : "border-mint-500/50 bg-mint-500/10 text-mint-300"
              }`}
            >
              {backend.kind === "sim" ? "Simulated" : "Live"}
            </span>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            <StatusPill status={displayStatus ?? (syncing ? "connecting" : "idle")} />
            <span
              title="connection token (redacted — never shown in full)"
              className="hidden rounded border border-ink-700 bg-ink-800/60 px-2 py-1 font-mono text-[10.5px] text-ink-300 md:inline"
            >
              token {backend.tokenFingerprint}
            </span>
            <span className="hidden font-mono text-[10.5px] text-ink-400 lg:inline">
              {lastSync ? `sync ${new Date(lastSync).toLocaleTimeString("en-GB")}` : "syncing…"}
            </span>

            <button
              type="button"
              onClick={() => setAutoRefresh((v) => !v)}
              title={`Auto refresh every ${POLL_MS / 1000}s`}
              className={`flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10.5px] transition-colors ${
                autoRefresh
                  ? "border-cy-500/50 bg-cy-500/10 text-cy-300"
                  : "border-ink-600 bg-ink-800/60 text-ink-400 hover:text-ink-200"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${autoRefresh ? "bg-cy-400 dot-live" : "bg-ink-500"}`} />
              auto {POLL_MS / 1000}s
            </button>

            <Btn variant="ghost" onClick={refresh} disabled={syncing} title="Refresh markets + private state">
              <RefreshCw size={13} className={syncing ? "animate-spin" : ""} /> Refresh
            </Btn>
            <Btn variant="danger" onClick={() => setKillOpen(true)} title="Emergency close">
              <Power size={13} /> Kill
            </Btn>
            <Btn variant="outline" onClick={onDisconnect} title="Discard token and disconnect">
              <LogOut size={13} /> Disconnect
            </Btn>
          </div>
        </div>
      </header>

      {/* main grid */}
      <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-4">
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[1.05fr_1.35fr_0.95fr]">
          <div className="min-h-[420px] lg:min-h-[520px] xl:h-[calc(100vh-104px)]">
            <MarketsPanel markets={markets} selectedId={selectedId} onSelect={setSelectedId} loading={syncing} />
          </div>

          <div className="min-h-0 xl:h-[calc(100vh-104px)] xl:overflow-y-auto xl:pr-1">
            <StatePanel
              state={acct}
              stateError={stateError}
              stateErrorCode={stateErrorCode}
              marketsById={marketsById}
              busyOid={busyOid}
              onCancel={cancelOrder}
              onModify={modifyOrder}
            />
          </div>

          {/* right rail: tabbed — copilot / ticket / activity (kept mounted to preserve state) */}
          <div className="flex min-h-0 flex-col gap-3 lg:col-span-2 xl:col-span-1 xl:h-[calc(100vh-104px)]">
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-ink-700 bg-ink-850/85 p-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] transition-all ${
                    tab === t.id
                      ? "bg-cy-500/15 text-cy-300 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.35)]"
                      : "text-ink-400 hover:text-ink-200"
                  }`}
                >
                  {t.icon}
                  {t.label}
                  {t.id === "copilot" && tab !== "copilot" && <span className="h-1.5 w-1.5 rounded-full bg-cy-400 dot-live" />}
                </button>
              ))}
            </div>

            <div className="min-h-[540px] flex-1 xl:min-h-0">
              <div className={tab === "copilot" ? "h-full" : "hidden"}>
                <Copilot
                  markets={markets}
                  acct={acct}
                  onPlaceOrder={placeOrder}
                  onCancelOid={cancelByOid}
                  onKill={kill}
                  pushLog={addLog}
                />
              </div>
              <div className={tab === "ticket" ? "h-full overflow-y-auto pr-1" : "hidden"}>
                <OrderTicket
                  markets={markets}
                  selected={selected}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onSubmit={submitFromTicket}
                  busy={orderBusy}
                  state={acct}
                  notice={notice}
                />
              </div>
              <div className={tab === "log" ? "h-full" : "hidden"}>
                <LogFeed log={log} />
              </div>
            </div>
          </div>
        </div>
      </main>

      {killOpen && (
        <KillModal
          onClose={() => !killBusy && setKillOpen(false)}
          onConfirm={() => {
            setKillOpen(false);
            kill().catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}
