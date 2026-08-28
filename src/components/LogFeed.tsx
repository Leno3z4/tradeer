import { useEffect, useRef } from "react";
import { Activity } from "lucide-react";
import type { LogEntry } from "../lib/agenthub";
import { EmptyState, Section } from "./shared";

export default function LogFeed({ log }: { log: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [log.length]);

  return (
    <Section title="Activity" tag="redacted · no secrets" className="h-full" bodyClassName="overflow-hidden">
      <div ref={ref} className="h-full overflow-y-auto p-2.5">
        {log.length === 0 ? (
          <EmptyState
            icon={<Activity size={20} />}
            title="No activity yet"
            note="API calls appear here with method, path, status and latency. Credentials and tokens are never logged."
          />
        ) : (
          <ul className="space-y-1.5">
            {log.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-2 rounded border border-ink-800 bg-ink-800/40 px-2.5 py-1.5 font-mono text-[11px] animate-[fadeSlide_0.25s_ease-out]"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    e.kind === "ok" ? "bg-mint-400" : e.kind === "err" ? "bg-rosex-400" : "bg-cy-400"
                  }`}
                />
                <span
                  className={`w-11 shrink-0 font-semibold ${
                    e.method === "GET" ? "text-cy-300" : e.method === "AI" ? "text-mint-300" : "text-amberx-300"
                  }`}
                >
                  {e.method}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-200">{e.path}</span>
                {e.note && <span className="shrink-0 max-w-[110px] truncate text-ink-400">{e.note}</span>}
                {e.ms != null && <span className="shrink-0 text-ink-500">{e.ms}ms</span>}
                <span className="shrink-0 text-ink-600">{new Date(e.at).toLocaleTimeString("en-GB")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
