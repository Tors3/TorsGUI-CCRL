import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { isTauri } from "../lib/api";

type Resize = {
  onGripDown: (e: React.PointerEvent) => void;
  reset: () => void;
  toggleFullscreen: () => void;
  fullscreen: boolean;
};
const Ctx = createContext<Resize | null>(null);
/** The resize grip and full-screen button of the board inside a BoardColumn (null elsewhere). */
export const useBoardResize = () => useContext(Ctx);

const read = (key: string): number | null => {
  try {
    const v = Number(localStorage.getItem(key));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
};

/**
 * The board column of a page (player bars, board, controls): its width follows the grip in the
 * board's bottom-right corner, remembered per page (`id`), and it can go full screen. The width
 * is the `--board-col` variable of the parent grid, whose first column uses it.
 */
export function BoardColumn({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = `torsgui.boardWidth.${id}`;
  const [width, setWidth] = useState<number | null>(() => read(key));
  const [fullscreen, setFullscreen] = useState(false);
  const latest = useRef(width);
  latest.current = width;
  useEffect(() => setWidth(read(key)), [key]);
  useLayoutEffect(() => {
    const grid = ref.current?.parentElement;
    if (!grid) return;
    if (width) grid.style.setProperty("--board-col", `${width}px`);
    else grid.style.removeProperty("--board-col");
  }, [width]);

  const onGripDown = useCallback(
    (e: React.PointerEvent) => {
      const col = ref.current;
      const grid = col?.parentElement;
      if (!col || !grid || document.fullscreenElement) return;
      e.preventDefault();
      e.stopPropagation();
      const start = col.getBoundingClientRect().width;
      const sx = e.clientX;
      const sy = e.clientY;
      // side by side: leave room for the other column; stacked: the whole width
      const sideBySide = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length > 1;
      // and the board no taller than the window (the bars and buttons stay visible; full screen goes further)
      const extra = col.getBoundingClientRect().height - (col.querySelector(".board-box")?.getBoundingClientRect().height ?? 0);
      const max = Math.max(280, Math.min(grid.clientWidth - (sideBySide ? 320 : 0), window.innerHeight - extra - 24 + (start - (col.querySelector(".board-box")?.getBoundingClientRect().width ?? start))));
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        setWidth(Math.round(Math.min(max, Math.max(260, start + d))));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.classList.remove("board-resizing");
        try {
          if (latest.current) localStorage.setItem(key, String(latest.current));
        } catch {
          /* storage unavailable */
        }
      };
      document.body.classList.add("board-resizing");
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [key],
  );
  const reset = useCallback(() => {
    setWidth(null);
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }, [key]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else ref.current?.requestFullscreen?.().catch(() => {});
  }, []);
  useEffect(() => {
    const on = () => {
      const fs = document.fullscreenElement === ref.current;
      setFullscreen(fs);
      // the desktop app: the window itself goes full screen too
      if (isTauri())
        import("@tauri-apps/api/window")
          .then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(fs))
          .catch(() => {});
    };
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  return (
    <Ctx.Provider value={{ onGripDown, reset, toggleFullscreen, fullscreen }}>
      <div ref={ref} className={`board-column min-w-0 ${className ?? ""}`} data-testid={`board-column-${id}`}>
        {children}
      </div>
    </Ctx.Provider>
  );
}
