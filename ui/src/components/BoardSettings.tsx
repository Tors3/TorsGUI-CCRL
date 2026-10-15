import { FolderInput, Palette, Trash2, Volume2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { UserPieceSet } from "../bindings/UserPieceSet";
import { call } from "../lib/api";
import { getUserPieceSets, setUserPieceSets } from "../lib/boardPrefs";
import { BUNDLED_PIECE_SETS } from "../lib/pieceSets";
import type { CSSProperties } from "react";
import type React from "react";
import { BOARD_THEMES, pieceUrl, setBoardPrefs, themeStyle, useBoardPrefs, type CoordsStyle } from "../lib/boardPrefs";
import { playEvent, preloadSounds, SOUND_SETS, type SoundSet } from "../lib/sound";
import { Board } from "./Board";
import { Modal } from "./ui";
import { useT, type Key } from "../i18n";

const PREVIEW_FEN = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 1 5";

/** Board theme, piece set, animation, coordinates, arrows and sound. */
export function BoardAppearance() {
  const p = useBoardPrefs();
  const tr = useT();
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 1fr) 260px" }}>
      <div className="flex flex-col gap-3 min-w-0">
        <div>
          <div className="kpi-label mb-1.5">{tr("board.board")}</div>
          <div className="flex flex-wrap gap-2">
            {BOARD_THEMES.map((t) => (
              <button key={t} className="flex flex-col items-center gap-1" onClick={() => setBoardPrefs({ theme: t })} aria-label={tr(`board.theme.${t}` as Key)} data-testid={`theme-${t}`}>
                <div className={`swatch board-theme-${t} ${p.theme === t ? "active" : ""}`} style={themeStyle(p, t) as CSSProperties}>
                  <span style={{ background: "var(--sq-light)" }} />
                  <span style={{ background: "var(--sq-dark)" }} />
                  <span style={{ background: "var(--sq-dark)" }} />
                  <span style={{ background: "var(--sq-light)" }} />
                </div>
                <span className="text-[11px] muted">{tr(`board.theme.${t}` as Key)}</span>
              </button>
            ))}
          </div>
          {p.theme === "custom" && (
            <div className="flex items-center gap-4 mt-2 text-[12.5px]">
              <label className="flex items-center gap-2">
                <input type="color" value={p.customLight} onChange={(e) => setBoardPrefs({ customLight: e.target.value })} aria-label={tr("board.light")} /> {tr("board.light")}
              </label>
              <label className="flex items-center gap-2">
                <input type="color" value={p.customDark} onChange={(e) => setBoardPrefs({ customDark: e.target.value })} aria-label={tr("board.dark")} /> {tr("board.dark")}
              </label>
              <button className="btn btn-sm" onClick={() => setBoardPrefs({ customLight: "#e8e8e8", customDark: "#9e9e9e" })}>
                {tr("board.reset")}
              </button>
            </div>
          )}
        </div>
        <PiecePicker />
        <div className="grid grid-cols-2 gap-3 text-[12.5px]">
          <label className="flex flex-col gap-1">
            <span className="kpi-label">{tr("board.animation", { value: p.animation ? `${p.animation} ms` : tr("board.off") })}</span>
            <input type="range" min={0} max={600} step={20} value={p.animation} onChange={(e) => setBoardPrefs({ animation: Number(e.target.value) })} aria-label={tr("board.animationLabel")} />
          </label>
          <div className="flex flex-col gap-1.5 justify-end">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={p.coordinates} onChange={(e) => setBoardPrefs({ coordinates: e.target.checked })} /> {tr("board.coordinates")}
              <select
                className="select ml-auto !py-0.5 text-[12px]"
                value={p.coordsStyle}
                disabled={!p.coordinates}
                onChange={(e) => setBoardPrefs({ coordsStyle: e.target.value as CoordsStyle })}
                aria-label={tr("board.coordsWhere")}
                data-testid="coords-style"
              >
                <option value="frame">{tr("board.coordsFrame")}</option>
                <option value="inside">{tr("board.coordsInside")}</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={p.arrows} onChange={(e) => setBoardPrefs({ arrows: e.target.checked })} /> {tr("board.arrows")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={p.sound}
                onChange={(e) => {
                  setBoardPrefs({ sound: e.target.checked });
                  if (e.target.checked) preloadSounds(p.soundSet);
                }}
                data-testid="sound-toggle"
              />{" "}
              {tr("board.sounds")}
            </label>
          </div>
        </div>
        {p.sound && (
          <div className="flex flex-wrap items-end gap-3 text-[12.5px]" data-testid="sound-settings">
            <label className="flex flex-col gap-1">
              <span className="kpi-label">{tr("board.soundSet")}</span>
              <select
                className="select"
                value={p.soundSet}
                onChange={(e) => {
                  const set = e.target.value as SoundSet;
                  setBoardPrefs({ soundSet: set });
                  preloadSounds(set);
                  playEvent("move", set, p.soundVolume);
                }}
                data-testid="sound-set"
              >
                {SOUND_SETS.map((s) => (
                  <option key={s} value={s}>
                    {tr(`board.sets.${s}` as Key)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <span className="kpi-label">{tr("board.volume", { n: Math.round(p.soundVolume * 100) })}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(p.soundVolume * 100)}
                onChange={(e) => setBoardPrefs({ soundVolume: Number(e.target.value) / 100 })}
                aria-label={tr("board.volumeLabel")}
                data-testid="sound-volume"
              />
            </label>
            <div className="flex flex-wrap gap-1" aria-label={tr("board.test")}>
              {(
                [
                  ["move", "Move"],
                  ["capture", "Capture"],
                  ["castle", "Castling"],
                  ["check", "Check"],
                  ["promote", "Promotion"],
                  ["end", "Game end"],
                  ["lowtime", "Low time"],
                ] as const
              ).map(([ev]) => (
                <button key={ev} className="btn btn-sm" onClick={() => playEvent(ev, p.soundSet, p.soundVolume)} title={tr("board.playTip", { name: tr(`board.ev.${ev}` as Key) })}>
                  <Volume2 size={12} /> {tr(`board.ev.${ev}` as Key)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <Board fen={PREVIEW_FEN} lastMove="f1c4" arrows={[{ uci: "e1g1", brush: "green" }, { uci: "f6g4", brush: "yellow" }]} />
    </div>
  );
}

export function BoardSettingsButton() {
  const [open, setOpen] = useState(false);
  const tr = useT();
  return (
    <>
      <button className="btn btn-icon" aria-label={tr("board.appearance")} title={tr("board.appearance")} onClick={() => setOpen(true)}>
        <Palette size={15} />
      </button>
      <Modal open={open} onOpenChange={setOpen} title={tr("board.appearance")} width={760}>
        <BoardAppearance />
      </Modal>
    </>
  );
}

/** Bundled sets (searchable) and sets imported for personal use. */
function PiecePicker() {
  const p = useBoardPrefs();
  const tr = useT();
  const [q, setQ] = useState("");
  const [user, setUser] = useState<UserPieceSet[]>(getUserPieceSets());
  const [dir, setDir] = useState("");
  const [name, setName] = useState("");
  const [importing, setImporting] = useState(false);
  const reload = async () => {
    const u = await call<UserPieceSet[]>("piece_sets_user");
    setUserPieceSets(u);
    setUser(u);
  };
  const doImport = async () => {
    try {
      const n = await call<string>("piece_set_import", { dir, name: name || null });
      await reload();
      setBoardPrefs({ pieces: `user:${n}` });
      toast.success(tr("board.imported", { name: n }));
      setImporting(false);
      setDir("");
      setName("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const del = async (n: string) => {
    await call("piece_set_delete", { name: n });
    if (p.pieces === `user:${n}`) setBoardPrefs({ pieces: "cburnett" });
    await reload();
  };
  const ql = q.toLowerCase();
  const bundled = BUNDLED_PIECE_SETS.filter((s) => !ql || s.label.toLowerCase().includes(ql) || s.author.toLowerCase().includes(ql));
  const current = BUNDLED_PIECE_SETS.find((s) => s.id === p.pieces);
  const tile = (id: string, label: string, title: string, extra?: React.ReactNode) => (
    <button key={id} className="panel px-1.5 py-1 flex flex-col items-center gap-0.5 relative group" style={{ boxShadow: p.pieces === id ? "0 0 0 2px var(--accent)" : undefined, width: 86 }} onClick={() => setBoardPrefs({ pieces: id })} title={title} data-testid={`pieces-${id}`}>
      <span className="flex">
        <img src={pieceUrl(id, "w", "N")} width={26} height={26} alt="" loading="lazy" />
        <img src={pieceUrl(id, "b", "Q")} width={26} height={26} alt="" loading="lazy" />
      </span>
      <span className="text-[10.5px] muted truncate w-full text-center">{label}</span>
      {extra}
    </button>
  );
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="kpi-label">
          {tr("board.pieces", { count: BUNDLED_PIECE_SETS.length + user.length })}
        </div>
        <div className="flex gap-1.5">
          <input className="input !h-[26px] text-[12px]" style={{ width: 150 }} placeholder={tr("board.searchSets")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("board.searchLabel")} />
          <button className="btn btn-sm" onClick={() => setImporting((x) => !x)} title={tr("board.importTip")}>
            <FolderInput size={12} /> {tr("board.import")}
          </button>
        </div>
      </div>
      {importing && (
        <div className="panel p-2 mb-2 flex flex-col gap-1.5 text-[12px]">
          <div className="muted">
            {tr("board.importAbout1")}<span className="mono">wP.svg</span> … <span className="mono">bK.svg</span>{tr("board.importAbout2")}<span className="mono">pw.svg</span> … <span className="mono">kb.svg</span>{tr("board.importAbout3")}
          </div>
          <div className="flex gap-1.5">
            <input className="input mono" placeholder="…/sharechess/public/pieces/maestro" value={dir} onChange={(e) => setDir(e.target.value)} data-testid="piece-import-dir" />
            <input className="input" style={{ width: 130 }} placeholder={tr("board.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary" disabled={!dir.trim()} onClick={doImport}>
              {tr("board.import")}
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 overflow-auto pr-1" style={{ maxHeight: 250 }}>
        {user
          .filter((u) => !ql || u.name.toLowerCase().includes(ql))
          .map((u) =>
            tile(
              `user:${u.name}`,
              u.name,
              tr("board.personal", { name: u.name }),
              <span
                role="button"
                aria-label={tr("board.deleteSet", { name: u.name })}
                className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 btn btn-ghost btn-icon btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  del(u.name);
                }}
              >
                <Trash2 size={11} />
              </span>,
            ),
          )}
        {bundled.map((s) => tile(s.id, s.label, `${s.label} — ${s.author} (${s.license})`))}
      </div>
      <div className="muted text-[11px] mt-1">{current ? `${current.label}: ${current.author}, ${current.license}` : p.pieces.startsWith("user:") ? tr("board.importedSet") : ""}</div>
    </div>
  );
}
