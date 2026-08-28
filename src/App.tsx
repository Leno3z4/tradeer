import { useState } from "react";
import Connect from "./components/Connect";
import Dashboard from "./components/Dashboard";
import type { Backend } from "./lib/agenthub";

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null);

  return (
    <div className="bg-terminal scanlines relative min-h-screen">
      <div className="sweep-line" aria-hidden />
      {backend ? (
        <Dashboard backend={backend} onDisconnect={() => setBackend(null)} />
      ) : (
        <Connect onReady={setBackend} />
      )}
    </div>
  );
}
