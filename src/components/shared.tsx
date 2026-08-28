import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AccountStatus } from "../lib/agenthub";

/* ---------- card section ---------- */
export function Section({
  title,
  tag,
  right,
  children,
  className = "",
  bodyClassName = "",
}: {
  title: string;
  tag?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-md border border-ink-700/80 bg-ink-900/70 backdrop-blur-sm ${className}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-ink-700/70 bg-ink-800/60 px-3.5 py-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.18em] text-ink-100">
            {title}
          </h2>
          {tag && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">{tag}</span>
          )}
        </div>
        {right}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/* ---------- status pill ---------- */
const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  connected: { label: "Connected", cls: "text-mint-300 border-mint-500/40 bg-mint-500/10", dot: "bg-mint-400 dot-live" },
  stale: { label: "Stale — refresh", cls: "text-amberx-300 border-amberx-500/40 bg-amberx-500/10", dot: "bg-amberx-400 dot-warn" },
  sequence_gap: { label: "Sequence gap", cls: "text-rosex-300 border-rosex-500/40 bg-rosex-500/10", dot: "bg-rosex-400 dot-warn" },
  disconnected: { label: "Disconnected", cls: "text-rosex-300 border-rosex-500/40 bg-rosex-500/10", dot: "bg-rosex-400" },
  enrollment_required: { label: "Perpl enrollment required", cls: "text-amberx-300 border-amberx-500/40 bg-amberx-500/10", dot: "bg-amberx-400 dot-warn" },
};

export function StatusPill({ status }: { status?: AccountStatus }) {
  const meta = (status && STATUS_META[status]) || {
    label: status ? String(status) : "Idle",
    cls: "text-ink-300 border-ink-600 bg-ink-800",
    dot: "bg-ink-400",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium ${meta.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

/* ---------- stat ---------- */
export function Stat({
  label,
  value,
  tone = "default",
  sub,
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "mint" | "rose" | "amber" | "cy";
  sub?: ReactNode;
}) {
  const toneCls =
    tone === "mint"
      ? "text-mint-300"
      : tone === "rose"
        ? "text-rosex-300"
        : tone === "amber"
          ? "text-amberx-300"
          : tone === "cy"
            ? "text-cy-300"
            : "text-ink-50";
  return (
    <div className="rounded-md border border-ink-700/70 bg-ink-800/50 px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">{label}</div>
      <div className={`font-mono text-lg font-semibold leading-tight ${toneCls}`}>{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[10px] text-ink-400">{sub}</div>}
    </div>
  );
}

/* ---------- flash-on-change value ---------- */
export function FlashValue({
  value,
  display,
  className = "",
}: {
  value: number | null | undefined;
  display: string;
  className?: string;
}) {
  const prev = useRef<number | null | undefined>(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (value == null || prev.current == null) {
      prev.current = value;
      return;
    }
    if (value > prev.current) setDir("up");
    else if (value < prev.current) setDir("down");
    prev.current = value;
    setNonce((n) => n + 1);
    const t = setTimeout(() => setDir(null), 700);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <span key={nonce} className={`${className} ${dir === "up" ? "flash-up" : dir === "down" ? "flash-down" : ""}`}>
      {display}
    </span>
  );
}

/* ---------- buttons ---------- */
export function Btn({
  children,
  onClick,
  variant = "ghost",
  disabled,
  className = "",
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "mint" | "outline";
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded border font-mono text-[12px] font-medium tracking-wide transition-all duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 px-3 py-1.5";
  const variants: Record<string, string> = {
    primary:
      "border-cy-500/60 bg-cy-500/15 text-cy-300 hover:bg-cy-500/25 hover:border-cy-400 hover:shadow-[0_0_18px_rgba(34,211,238,0.25)]",
    mint: "border-mint-500/60 bg-mint-500/15 text-mint-300 hover:bg-mint-500/25 hover:border-mint-400",
    danger:
      "border-rosex-500/60 bg-rosex-500/15 text-rosex-300 hover:bg-rosex-500/30 hover:border-rosex-400 hover:shadow-[0_0_18px_rgba(244,63,94,0.3)]",
    ghost: "border-ink-600 bg-ink-800/60 text-ink-200 hover:border-ink-500 hover:text-ink-50 hover:bg-ink-700/60",
    outline: "border-ink-500 bg-transparent text-ink-100 hover:border-cy-400 hover:text-cy-300",
  };
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

/* ---------- empty state ---------- */
export function EmptyState({ icon, title, note }: { icon: ReactNode; title: string; note?: string }) {
  return (
    <div className="flex h-full min-h-[90px] flex-col items-center justify-center gap-1.5 p-6 text-center">
      <div className="text-ink-500">{icon}</div>
      <div className="font-mono text-[12px] text-ink-300">{title}</div>
      {note && <div className="max-w-[260px] text-[11px] leading-relaxed text-ink-400">{note}</div>}
    </div>
  );
}

/* ---------- open/closed badge ---------- */
export function OpenBadge({ open }: { open: boolean }) {
  return open ? (
    <span className="inline-flex items-center gap-1 rounded-sm border border-mint-500/40 bg-mint-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-mint-300">
      <span className="h-1 w-1 rounded-full bg-mint-400" /> Open
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-sm border border-rosex-500/40 bg-rosex-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-rosex-300">
      <span className="h-1 w-1 rounded-full bg-rosex-400" /> Closed
    </span>
  );
}
