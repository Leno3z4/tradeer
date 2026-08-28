/**
 * AgentHub agent client.
 *
 * Security model (per the AgentHub skill):
 *  - The identity access key is used for exactly ONE call: POST /api/agent/connect.
 *    It is never stored, logged, or rendered after that exchange.
 *  - Only the returned `connection_token` is kept (in memory) and sent as a Bearer
 *    token to the AgentHub backend — nowhere else.
 *  - All log lines produced by this module are redacted; secrets never appear.
 */

export interface MarketConfig {
  is_open?: boolean;
  price_decimals?: number;
  size_decimals?: number;
  initial_margin?: number; // bps; 1000 = 10% => 10x max leverage
  maintenance_margin?: number;
  order_max_market_slippage_bps?: number;
  [k: string]: unknown;
}

export interface MarketState {
  bid?: number;
  ask?: number;
  mid?: number;
  mrk?: number;
  orl?: number;
  lst?: number;
  dv?: number;
  dva?: number;
  oi?: number;
  tvl?: number;
  [k: string]: unknown;
}

export interface Market {
  id?: number;
  instance_id?: number | string;
  perpetual_id?: number | string;
  symbol?: string;
  name?: string;
  config?: MarketConfig;
  state?: MarketState;
  funding?: { rate?: number; [k: string]: unknown };
  [k: string]: unknown;
}

export interface Order {
  oid?: string | number;
  mkt?: number;
  side?: string;
  t?: number;
  s?: number;
  p?: number;
  lv?: number;
  fl?: number;
  [k: string]: unknown;
}

export interface Position {
  mkt?: number;
  symbol?: string;
  side?: string;
  s?: number;
  entry?: number;
  upl?: number;
  [k: string]: unknown;
}

export type AccountStatus =
  | "connected"
  | "stale"
  | "sequence_gap"
  | "disconnected"
  | "enrollment_required"
  | string;

export interface AccountState {
  status?: AccountStatus;
  account?: {
    balance?: number;
    equity?: number;
    available?: number;
    locked?: number;
    [k: string]: unknown;
  };
  open_orders?: Order[];
  positions?: Position[];
  lb?: number; // latest sequence head; required for cancel/modify
  trading_enabled?: boolean;
  [k: string]: unknown;
}

export interface LogEntry {
  id: string;
  at: number;
  method: string;
  path: string;
  kind: "ok" | "err" | "info";
  ms?: number;
  note?: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ---------------- redaction & formatting ---------------- */

export function redact(s?: string | null, keep = 4): string {
  if (!s) return "••••";
  const str = String(s);
  if (str.length <= keep * 2) return "••••••••";
  return `${str.slice(0, keep)}…${str.slice(-keep)}`;
}

function num(n: unknown): number | null {
  if (n === null || n === undefined || n === "") return null;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

export function fmtNum(n: unknown, d = 2): string {
  const v = num(n);
  if (v === null) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

export function fmtCompact(n: unknown): string {
  const v = num(n);
  if (v === null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(2);
}

export function fmtPrice(n: unknown, decimals?: number): string {
  const v = num(n);
  if (v === null) return "—";
  const d = decimals ?? (Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 3 : 5);
  return v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

export function fmtPct(n: unknown, d = 4): string {
  const v = num(n);
  if (v === null) return "—";
  return (v * 100).toFixed(d) + "%";
}

export function isOpen(m: Market): boolean {
  return m.config?.is_open === true;
}

/** initial_margin is in bps (1000 = 10% margin = 10x). */
export function maxLeverage(m: Market): number | null {
  const im = num(m.config?.initial_margin);
  if (im === null || im <= 0) return null;
  return 10000 / im;
}

export const ORDER_TYPES: { value: number; label: string }[] = [
  { value: 1, label: "Type 1 · Market" },
  { value: 2, label: "Type 2 · Limit" },
  { value: 3, label: "Type 3" },
  { value: 4, label: "Type 4" },
  { value: 5, label: "Type 5" },
  { value: 6, label: "Type 6" },
  { value: 7, label: "Type 7" },
];

export const ORDER_FLAGS: { value: number; label: string }[] = [
  { value: 0, label: "0 · Default" },
  { value: 1, label: "1 · Post-only" },
  { value: 2, label: "2 · IOC" },
  { value: 4, label: "4 · FOK" },
];

/* ---------------- backend abstraction ---------------- */

export interface Backend {
  kind: "live" | "sim";
  base: string;
  agentName: string;
  tokenFingerprint: string;
  getMarkets(): Promise<{ markets: Market[] }>;
  getState(): Promise<AccountState>;
  placeOrder(body: Record<string, unknown>): Promise<unknown>;
  cancelOrder(body: Record<string, unknown>): Promise<unknown>;
  modifyOrder(body: Record<string, unknown>): Promise<unknown>;
  killSwitch(enabled: boolean): Promise<unknown>;
}

async function req(
  base: string,
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(base.replace(/\/+$/, "") + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      0,
      "No response from the AgentHub backend. It may be offline, the URL may be wrong, or it may not allow CORS from this origin.",
      "network",
    );
  }
  let data: Record<string, unknown> | null = null;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const code =
      typeof data?.code === "string" ? data.code : typeof data?.error === "string" ? data.error : undefined;
    const message =
      (typeof data?.message === "string" && data.message) ||
      (typeof data?.error === "string" && data.error) ||
      `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message, code);
  }
  return data;
}

/**
 * Exchange the identity access key for a connection token. The key is used here
 * and only here; callers must discard it immediately afterwards.
 */
export async function connectAgent(
  base: string,
  identityKey: string,
  agentName: string,
): Promise<{ token: string; raw: unknown }> {
  const data = (await req(base, null, "POST", "/api/agent/connect", {
    identity_access_key: identityKey,
    agent_name: agentName,
  })) as Record<string, unknown> | null;

  const token =
    (typeof data?.connection_token === "string" && data.connection_token) ||
    (typeof data?.token === "string" && data.token) ||
    (typeof (data?.agent as Record<string, unknown> | undefined)?.connection_token === "string" &&
      (data!.agent as Record<string, string>).connection_token) ||
    null;

  if (!token) {
    throw new ApiError(502, "The backend responded but did not return a connection_token.");
  }
  return { token, raw: data };
}

export function createLiveBackend(base: string, agentName: string, token: string): Backend {
  const call = (method: string, path: string, body?: unknown) =>
    req(base, token, method, path, body);
  return {
    kind: "live",
    base,
    agentName,
    tokenFingerprint: redact(token),
    getMarkets: async () => {
      const d = (await call("GET", "/api/agent/perpl/markets")) as { markets?: Market[] } | Market[];
      const markets = Array.isArray(d) ? d : d?.markets ?? [];
      return { markets };
    },
    getState: async () => (await call("GET", "/api/agent/perpl/state")) as AccountState,
    placeOrder: (body) => call("POST", "/api/agent/perpl/order", body),
    cancelOrder: (body) => call("POST", "/api/agent/perpl/order/cancel", body),
    modifyOrder: (body) => call("POST", "/api/agent/perpl/order/modify", body),
    killSwitch: (enabled) => call("POST", "/api/agent/perpl/kill-switch", { enabled }),
  };
}

/* ---------------- simulator (clearly-labelled, offline demo) ---------------- */

const SIM_MARKETS: Market[] = [
  {
    id: 1,
    symbol: "BTC-PERP",
    name: "Bitcoin Perpetual",
    config: { is_open: true, price_decimals: 1, size_decimals: 4, initial_margin: 1000, maintenance_margin: 500, order_max_market_slippage_bps: 150 },
    state: { bid: 67412.4, ask: 67419.1, mid: 67415.7, mrk: 67415.0, orl: 67410.2, lst: 67414.8, oi: 1284.55, tvl: 86_500_000, dv: 0.0001, dva: 0.0001 },
    funding: { rate: 0.00012 },
  },
  {
    id: 2,
    symbol: "ETH-PERP",
    name: "Ethereum Perpetual",
    config: { is_open: true, price_decimals: 2, size_decimals: 3, initial_margin: 1000, maintenance_margin: 500, order_max_market_slippage_bps: 150 },
    state: { bid: 3521.44, ask: 3521.9, mid: 3521.67, mrk: 3521.6, orl: 3520.1, lst: 3521.5, oi: 9412.1, tvl: 33_100_000, dv: 0.001, dva: 0.001 },
    funding: { rate: 0.00008 },
  },
  {
    id: 3,
    symbol: "SOL-PERP",
    name: "Solana Perpetual",
    config: { is_open: true, price_decimals: 3, size_decimals: 2, initial_margin: 2000, maintenance_margin: 1000, order_max_market_slippage_bps: 200 },
    state: { bid: 172.41, ask: 172.47, mid: 172.44, mrk: 172.43, orl: 172.2, lst: 172.4, oi: 58_210, tvl: 10_050_000, dv: 0.01, dva: 0.01 },
    funding: { rate: -0.00004 },
  },
  {
    id: 4,
    symbol: "ARB-PERP",
    name: "Arbitrum Perpetual",
    config: { is_open: true, price_decimals: 4, size_decimals: 1, initial_margin: 2000, maintenance_margin: 1000, order_max_market_slippage_bps: 250 },
    state: { bid: 1.1284, ask: 1.129, mid: 1.1287, mrk: 1.1286, orl: 1.127, lst: 1.1285, oi: 412_300, tvl: 465_000, dv: 0.0001, dva: 0.0001 },
    funding: { rate: 0.00003 },
  },
  {
    id: 5,
    symbol: "DOGE-PERP",
    name: "Dogecoin Perpetual",
    config: { is_open: false, price_decimals: 5, size_decimals: 0, initial_margin: 2500, maintenance_margin: 1250, order_max_market_slippage_bps: 300 },
    state: { bid: 0.15842, ask: 0.15851, mid: 0.15846, mrk: 0.15845, orl: 0.158, lst: 0.1584, oi: 1_204_000, tvl: 190_000, dv: 0.00001, dva: 0.00001 },
    funding: { rate: 0 },
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jit = (v: number, amt: number) => v + (Math.random() - 0.5) * amt;

export function createSimBackend(agentName: string): Backend {
  let lb = 4211;
  let balance = 10_000;
  let locked = 620;
  let oidSeq = 9001;

  const markets: Market[] = SIM_MARKETS.map((m) => ({
    ...m,
    config: { ...m.config },
    state: { ...m.state },
    funding: { ...m.funding },
  }));

  const openOrders: Order[] = [
    { oid: 9001, mkt: 2, side: "buy", t: 2, s: 1.5, p: 3490, lv: 5, fl: 1 },
  ];

  const positions: Position[] = [
    { mkt: 1, symbol: "BTC-PERP", side: "long", s: 0.085, entry: 66210, upl: 102.4 },
    { mkt: 3, symbol: "SOL-PERP", side: "short", s: 24, entry: 176.9, upl: 107.0 },
  ];

  const byId = (id: number) => markets.find((m) => m.id === id);

  function tick() {
    for (const m of markets) {
      const st = m.state!;
      const mid = jit(st.mid!, Math.abs(st.mid!) * 0.0009);
      const half = Math.abs(mid) * 0.00006;
      st.mid = mid;
      st.bid = mid - half;
      st.ask = mid + half;
      st.mrk = mid;
      st.lst = mid;
    }
    // mark positions to market
    for (const p of positions) {
      const m = byId(p.mkt!);
      if (!m) continue;
      const px = m.state!.mid!;
      const dir = p.side === "long" ? 1 : -1;
      p.upl = (px - (p.entry as number)) * (p.s as number) * dir;
    }
  }

  function snapshotState(): AccountState {
    const equity = balance + positions.reduce((a, p) => a + (p.upl ?? 0), 0);
    return {
      status: "connected",
      lb,
      trading_enabled: true,
      account: {
        balance,
        equity,
        available: balance - locked,
        locked,
      },
      open_orders: openOrders.map((o) => ({ ...o })),
      positions: positions.map((p) => ({ ...p })),
    };
  }

  return {
    kind: "sim",
    base: "simulated",
    agentName,
    tokenFingerprint: "sim_0000…0000",
    getMarkets: async () => {
      await sleep(180 + Math.random() * 220);
      tick();
      return { markets: markets.map((m) => ({ ...m, state: { ...m.state } })) };
    },
    getState: async () => {
      await sleep(140 + Math.random() * 180);
      return snapshotState();
    },
    placeOrder: async (body) => {
      await sleep(240 + Math.random() * 200);
      const mkt = Number(body.mkt);
      const m = byId(mkt);
      if (!m) throw new ApiError(400, "Unknown market id.", "unknown_market");
      if (!isOpen(m)) throw new ApiError(409, `Market ${m.symbol} is closed.`, "market_closed");
      const t = Number(body.t);
      const s = Number(body.s);
      const lv = Number(body.lv);
      const oid = ++oidSeq;
      lb += 1;
      if (t === 1) {
        // market order fills immediately into a position
        const dir = (body as { side?: string }).side === "sell" ? "short" : "long";
        const px = m.state!.mid!;
        const existing = positions.find((p) => p.mkt === mkt && p.side === dir);
        if (existing) {
          existing.s = (existing.s as number) + s;
        } else {
          positions.push({ mkt, symbol: m.symbol, side: dir, s, entry: px, upl: 0 });
        }
        return { oid, status: "filled", mkt, s, lv };
      }
      openOrders.push({ oid, mkt, side: (body as { side?: string }).side ?? "buy", t, s, p: Number(body.p) || undefined, lv, fl: Number(body.fl) });
      return { oid, status: "working", mkt, s, lv };
    },
    cancelOrder: async (body) => {
      await sleep(180 + Math.random() * 160);
      const i = openOrders.findIndex((o) => String(o.oid) === String(body.oid));
      if (i === -1) throw new ApiError(404, "Order not found.", "order_not_found");
      if (Number(body.lb) < lb) throw new ApiError(409, "Stale lb — refresh state.", "stale_lb");
      openOrders.splice(i, 1);
      lb += 1;
      return { oid: body.oid, status: "cancelled" };
    },
    modifyOrder: async (body) => {
      await sleep(180 + Math.random() * 160);
      const o = openOrders.find((x) => String(x.oid) === String(body.oid));
      if (!o) throw new ApiError(404, "Order not found.", "order_not_found");
      if (Number(body.lb) < lb) throw new ApiError(409, "Stale lb — refresh state.", "stale_lb");
      o.s = Number(body.s);
      o.lv = Number(body.lv);
      o.fl = Number(body.fl);
      if (body.p !== undefined) o.p = Number(body.p);
      lb += 1;
      return { oid: o.oid, status: "modified" };
    },
    killSwitch: async () => {
      await sleep(420 + Math.random() * 200);
      openOrders.length = 0;
      positions.length = 0;
      locked = 0;
      lb += 1;
      return { status: "flat", cancelled: true, positions_closed: true };
    },
  };
}
