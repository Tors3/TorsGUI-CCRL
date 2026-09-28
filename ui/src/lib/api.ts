// Single entry point to the Rust backend: Tauri IPC in the desktop app,
// HTTP (`torsgui-server`) in the browser. Command names and payloads mirror
// `torsgui_core::api::App::call`; the payload types live in ../bindings.
import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauri = () => typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

export async function call<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>("api", { cmd, args });
  }
  const r = await fetch(`/api/${cmd}`, { method: "POST", body: JSON.stringify(args) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j as T;
}

/** Polls a command; `interval` 0 = once. Keeps the previous data while refreshing. */
export function usePoll<T>(cmd: string | null, args: Record<string, unknown> = {}, interval = 3000) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(args);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    if (!cmd) return;
    try {
      const d = await call<T>(cmd, JSON.parse(key));
      if (alive.current) {
        setData(d);
        setError(undefined);
      }
    } catch (e) {
      if (alive.current) setError(String((e as Error).message ?? e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [cmd, key]);
  useEffect(() => {
    alive.current = true;
    setLoading(true);
    refresh();
    if (!interval) return () => { alive.current = false; };
    const t = setInterval(() => {
      if (document.visibilityState !== "hidden") refresh();
    }, interval);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [refresh, interval]);
  return { data, error, loading, refresh, setData };
}
