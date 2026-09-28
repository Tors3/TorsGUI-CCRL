import { Palette } from "lucide-react";
import { useState } from "react";
import { BOARD_THEMES, PIECE_LABEL, PIECE_SETS, THEME_LABEL, pieceUrl, setBoardPrefs, useBoardPrefs } from "../lib/boardPrefs";
import { Board } from "./Board";
import { Modal } from "./ui";

const PREVIEW_FEN = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 1 5";

/** Board theme, piece set, animation, coordinates, arrows and sound. */
export function BoardAppearance() {
  const p = useBoardPrefs();
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 1fr) 260px" }}>
      <div className="flex flex-col gap-3 min-w-0">
        <div>
          <div className="kpi-label mb-1.5">Board</div>
          <div className="flex flex-wrap gap-2">
            {BOARD_THEMES.map((t) => (
              <button key={t} className="flex flex-col items-center gap-1" onClick={() => setBoardPrefs({ theme: t })} aria-label={THEME_LABEL[t]} data-testid={`theme-${t}`}>
                <div className={`swatch board-theme-${t} ${p.theme === t ? "active" : ""}`}>
                  <span style={{ background: "var(--sq-light)" }} />
                  <span style={{ background: "var(--sq-dark)" }} />
                  <span style={{ background: "var(--sq-dark)" }} />
                  <span style={{ background: "var(--sq-light)" }} />
                </div>
                <span className="text-[11px] muted">{THEME_LABEL[t]}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="kpi-label mb-1.5">Pieces</div>
          <div className="flex flex-wrap gap-2">
            {PIECE_SETS.map((s) => (
              <button key={s} className={`panel px-2 py-1 flex flex-col items-center gap-0.5 ${p.pieces === s ? "" : ""}`} style={{ boxShadow: p.pieces === s ? "0 0 0 2px var(--accent)" : undefined }} onClick={() => setBoardPrefs({ pieces: s })} data-testid={`pieces-${s}`}>
                <span className="flex">
                  <img src={pieceUrl(s, "w", "N")} width={26} height={26} alt="" />
                  <img src={pieceUrl(s, "b", "Q")} width={26} height={26} alt="" />
                </span>
                <span className="text-[11px] muted">{PIECE_LABEL[s]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-[12.5px]">
          <label className="flex flex-col gap-1">
            <span className="kpi-label">Animation {p.animation ? `${p.animation} ms` : "off"}</span>
            <input type="range" min={0} max={600} step={20} value={p.animation} onChange={(e) => setBoardPrefs({ animation: Number(e.target.value) })} aria-label="Animation speed" />
          </label>
          <div className="flex flex-col gap-1.5 justify-end">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={p.coordinates} onChange={(e) => setBoardPrefs({ coordinates: e.target.checked })} /> Coordinates
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={p.arrows} onChange={(e) => setBoardPrefs({ arrows: e.target.checked })} /> Engine arrows (PV)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={p.sound} onChange={(e) => setBoardPrefs({ sound: e.target.checked })} /> Move sound
            </label>
          </div>
        </div>
      </div>
      <Board fen={PREVIEW_FEN} lastMove="f1c4" arrows={[{ uci: "e1g1", brush: "green" }, { uci: "f6g4", brush: "yellow" }]} />
    </div>
  );
}

export function BoardSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-icon" aria-label="Board appearance" title="Board appearance" onClick={() => setOpen(true)}>
        <Palette size={15} />
      </button>
      <Modal open={open} onOpenChange={setOpen} title="Board appearance" width={760}>
        <BoardAppearance />
      </Modal>
    </>
  );
}
