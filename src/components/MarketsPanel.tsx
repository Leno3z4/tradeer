import { fmtCompact, fmtPct, fmtPrice, isOpen, maxLeverage, type Market } from "../lib/agenthub";
import { EmptyState, FlashValue, OpenBadge, Section } from "./shared";
import { Radar } from "lucide-react";

export default function MarketsPanel({
  markets,
  selectedId,
  onSelect,
  loading,
}: {
  markets: Market[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  loading: boolean;
}) {
  return (
    <Section
      title="Markets"
      tag="perpl · live discovery"
      className="h-full"
      bodyClassName="overflow-y-auto"
      right={
        loading ? (
          <span className="flex items-end gap-[3px]">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="eq-bar w-[3px] rounded-sm bg-cy-400"
                style={{ height: 12, animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
        ) : (
          <span className="font-mono text-[10px] text-ink-400">{markets.length} mkts</span>
        )
      }
    >
      {markets.length === 0 ? (
        <EmptyState
          icon={<Radar size={22} />}
          title={loading ? "Discovering markets…" : "No markets returned"}
          note="Market discovery is independent of your private Perpl session. Refresh to retry."
        />
      ) : (
        <table className="w-full border-collapse font-mono text-[12px]">
          <thead className="sticky top-0 z-10 bg-ink-800/95 text-left">
            <tr className="text-[10px] uppercase tracking-[0.12em] text-ink-400">
              <th className="px-3 py-2 font-medium">Market</th>
              <th className="px-2 py-2 text-right font-medium">Mid</th>
              <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">Bid / Ask</th>
              <th className="hidden px-2 py-2 text-right font-medium lg:table-cell">OI</th>
              <th className="hidden px-2 py-2 text-right font-medium md:table-cell">Funding</th>
              <th className="px-3 py-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => {
              const open = isOpen(m);
              const sel = m.id === selectedId;
              const fr = m.funding?.rate;
              return (
                <tr
                  key={String(m.id ?? m.symbol)}
                  onClick={() => m.id != null && onSelect(m.id)}
                  className={`cursor-pointer border-b border-ink-800/70 transition-colors ${
                    sel ? "bg-cy-500/10" : "hover:bg-ink-800/60"
                  } ${open ? "" : "opacity-60"}`}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${sel ? "bg-cy-400" : "bg-ink-600"}`} />
                      <div>
                        <div className="font-semibold text-ink-50">{m.symbol ?? "—"}</div>
                        <div className="text-[10px] text-ink-400">
                          id {m.id ?? "—"} · {maxLeverage(m) ? `${maxLeverage(m)}x max` : "lev —"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold text-ink-50">
                    <FlashValue
                      value={m.state?.mid ?? null}
                      display={fmtPrice(m.state?.mid, m.config?.price_decimals)}
                    />
                  </td>
                  <td className="hidden px-2 py-2.5 text-right text-ink-300 sm:table-cell">
                    <span className="text-mint-300/90">{fmtPrice(m.state?.bid, m.config?.price_decimals)}</span>
                    <span className="mx-1 text-ink-500">/</span>
                    <span className="text-rosex-300/90">{fmtPrice(m.state?.ask, m.config?.price_decimals)}</span>
                  </td>
                  <td className="hidden px-2 py-2.5 text-right text-ink-300 lg:table-cell">
                    {fmtCompact(m.state?.oi)}
                  </td>
                  <td
                    className={`hidden px-2 py-2.5 text-right md:table-cell ${
                      (fr ?? 0) > 0 ? "text-mint-300" : (fr ?? 0) < 0 ? "text-rosex-300" : "text-ink-400"
                    }`}
                  >
                    {fmtPct(fr)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <OpenBadge open={open} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}
