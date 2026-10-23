import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { EngineEntry } from "../bindings/EngineEntry";
import { useT } from "../i18n";
import { call } from "../lib/api";
import { GithubDialog, type GithubTarget } from "../pages/Engines";

/**
 * Installs the engines of a CCRL list one after the other without leaving the page: for each
 * name its repository is looked up and the GitHub dialog opens, to install, skip or stop.
 * `names` empty: nothing to do. `onEngine` gets each engine installed, `onFinish` all of them.
 */
export function DownloadQueue({ names, list, onEngine, onFinish }: { names: string[]; list: string; onEngine?: (e: EngineEntry) => void; onFinish: (installed: EngineEntry[]) => void }) {
  const t = useT();
  const [idx, setIdx] = useState(0);
  const [target, setTarget] = useState<GithubTarget | null>(null);
  const installed = useRef<EngineEntry[]>([]);
  // the dialog closes itself after an install: that is not a stop
  const justInstalled = useRef(false);
  const key = names.join("\n");
  useEffect(() => {
    setIdx(0);
    installed.current = [];
    // a new list of engines
  }, [key]);
  useEffect(() => {
    if (!names.length) return setTarget(null);
    if (idx >= names.length) {
      setTarget(null);
      if (installed.current.length) toast.success(t("engines.gh.queueDone", { count: installed.current.length }));
      onFinish(installed.current);
      return;
    }
    let live = true;
    const id = toast.loading(t("engines.gh.queueLooking", { name: names[idx], n: idx + 1, total: names.length }));
    call<GithubTarget>("ccrl_repo_for", { name: names[idx], list })
      .then((g) => live && setTarget(g))
      .catch((e) => {
        toast.error((e as Error).message);
        if (live) setIdx((i) => i + 1);
      })
      .finally(() => toast.dismiss(id));
    return () => {
      live = false;
      toast.dismiss(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, key]);
  const next = () => {
    setTarget(null);
    setIdx((i) => i + 1);
  };
  return (
    <GithubDialog
      open={!!target}
      target={target}
      queue={names.length > 1 ? { n: idx + 1, total: names.length, onSkip: next } : undefined}
      onDone={(e) => {
        justInstalled.current = true;
        if (e) {
          installed.current = [...installed.current, e];
          onEngine?.(e);
        }
        next();
      }}
      setOpen={(o) => {
        if (o) return;
        if (justInstalled.current) {
          justInstalled.current = false;
          return;
        }
        // stopped: the engines installed so far
        setTarget(null);
        setIdx(names.length);
      }}
    />
  );
}
