import { fmtNum, isOpen, maxLeverage, type AccountState, type Market } from "./agenthub";

/* ------------------------------------------------------------------ */
/* Qwen (DashScope, OpenAI-compatible) client for the AgentHub agent.  */
/* The API key lives only in memory (or sessionStorage if the user     */
/* opts in) and is sent only to the model endpoint configured below.   */
/* ------------------------------------------------------------------ */

export interface QwenToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface QwenMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: QwenToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatResult {
  content: string;
  toolCalls: QwenToolCall[];
  tokens?: { prompt: number; completion: number };
}

export const QWEN_BASES = [
  { id: "intl", label: "Intl · Singapore", url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
  { id: "cn", label: "China · Beijing", url: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
] as const;

export const QWEN_MODELS = ["qwen3-max", "qwen-plus", "qwen-turbo", "qwen-flash"];

export const AGENT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_markets",
      description:
        "Return the live Perpl market snapshot (id, symbol, open/closed, mid/bid/ask, open interest, funding, max leverage). Read-only.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_account",
      description:
        "Return private account state: status, lb sequence, balance/equity/available/locked, open orders, positions. Read-only.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "place_order",
      description:
        "Place an order on a live-discovered market. The console validates market open state, leverage caps and fresh private state, then asks the user to approve before sending. Omit price for a market order.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Market symbol exactly as it appears in the live snapshot (e.g. BTC-PERP)." },
          side: { type: "string", enum: ["buy", "sell"], description: "buy = long, sell = short." },
          size: { type: "number", description: "Positive order size in market units." },
          leverage: { type: "number", description: "Positive leverage, at or below the market's max leverage." },
          price: { type: "number", description: "Optional limit price. Omit for a market order." },
          flags: { type: "number", enum: [0, 1, 2, 4], description: "Order flags per connector: 0 none, 1 post-only, 2 IOC, 4 FOK. Default 0." },
        },
        required: ["symbol", "side", "size", "leverage"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "cancel_order",
      description: "Cancel an open order by its oid using the latest lb from private state. Requires user approval.",
      parameters: {
        type: "object",
        properties: { oid: { type: ["number", "string"], description: "Order id from the open orders list." } },
        required: ["oid"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "kill_switch",
      description:
        "Emergency close: cancel all active orders and close all positions, then verify flat. Requires explicit user approval.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

export const SYSTEM_PROMPT = `You are the trading copilot inside the AgentHub Agent Console, operating a delegated Perpl account through the AgentHub connector.

Operating rules (non-negotiable):
- Only use markets, ids and prices from the LIVE CONTEXT snapshot or from get_markets/get_account results. Never invent identifiers or numbers.
- Never trade a market whose config.is_open is false.
- Never trade when private state status is not "connected" (stale / sequence_gap / disconnected → tell the user to refresh).
- Leverage must not exceed the market's max leverage derived from initial_margin (1000 = 10% = 10x).
- Respect available balance and existing positions; sizes must be positive and match market size_decimals.
- After place/cancel/kill, the console re-fetches private state automatically — report the verified result, never assume a fill.
- State-changing tools (place_order, cancel_order, kill_switch) are gated: the UI asks the user to approve. Do not ask "shall I proceed?" yourself — call the tool with exact parameters and let the UI gate it.
- If the user's request lacks market, side, size or leverage, ask for the missing parameters instead of guessing. Size/leverage must come from the user.
- Be concise, numeric, and reply in the user's language.`;

/** Compact live snapshot injected as fresh context on every turn. */
export function buildSnapshot(markets: Market[], acct: AccountState | null): string {
  const mkts = markets
    .map((m) => {
      const st = m.state ?? {};
      return {
        id: m.id,
        symbol: m.symbol,
        open: isOpen(m),
        mid: st.mid,
        bid: st.bid,
        ask: st.ask,
        oi: st.oi,
        funding: m.funding?.rate,
        max_lev: maxLeverage(m),
      };
    });
  const account = acct
    ? {
        status: acct.status,
        lb: acct.lb,
        trading_enabled: acct.trading_enabled !== false,
        balance: (acct.account as { balance?: number }).balance,
        equity: (acct.account as { equity?: number }).equity,
        available: (acct.account as { available?: number }).available,
        locked: (acct.account as { locked?: number }).locked,
        open_orders: (acct.open_orders ?? []).map((o) => ({ oid: o.oid, mkt: o.mkt, side: o.side, s: o.s, p: o.p, lv: o.lv })),
        positions: acct.positions ?? [],
      }
    : { status: "unavailable", note: "private state not synchronized — public markets still valid" };
  return `LIVE CONTEXT (fetched ${new Date().toISOString()}):\n${JSON.stringify({ markets: mkts, account }, (k, v) => (v === undefined ? null : v))}`;
}

/** Redacted host of the model endpoint, for display/logging only. */
export function qwenHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export async function qwenChat(
  cfg: { baseUrl: string; apiKey: string; model: string },
  messages: QwenMessage[],
): Promise<ChatResult> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      tools: AGENT_TOOLS,
      temperature: 0.35,
      max_tokens: 900,
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(raw);
      msg = j?.error?.message ?? j?.message ?? msg;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  let data: {
    choices?: { message?: { content?: string | null; tool_calls?: QwenToolCall[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Unparseable response from the model endpoint.");
  }
  const m = data.choices?.[0]?.message ?? {};
  return {
    content: typeof m.content === "string" ? m.content : "",
    toolCalls: Array.isArray(m.tool_calls) ? m.tool_calls : [],
    tokens:
      data.usage?.prompt_tokens != null && data.usage?.completion_tokens != null
        ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens }
        : undefined,
  };
}

export function formatNum(v: unknown): string {
  return fmtNum(v as number | string | undefined);
}
