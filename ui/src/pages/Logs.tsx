import { useEffect, useState } from "react";
import type { EventRecord } from "../bindings/EventRecord";
import type { TournamentSummary } from "../bindings/TournamentSummary";
import { Empty, PageHeader, Panel, Seg } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { bytes } from "../lib/format";

type LogFile = { path: string; name: string; bytes: number; modified: string | null };

export function Logs() {
  const [level, setLevel] = useState("all");
  const [tid, setTid] = useState("");
  const { data: events } = usePoll<EventRecord[]>("events_recent", { limit: 500, tournament_id: tid || null }, 3000);
  const { data: ts } = usePoll<TournamentSummary[]>("tournaments_list", {}, 0);
  const { data: files } = usePoll<LogFile[]>(tid ? "logs_list" : null, { id: tid }, 5000);
  const [file, setFile] = useState<string>("");
  const [text, setText] = useState("");
  useEffect(() => {
    if (!file) return;
    const load = () => call<{ text: string }>("log_tail", { path: file, bytes: 96 * 1024 }).then((r) => setText(r.text)).catch((e) => setText(String(e.message)));
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [file]);
  const rows = (events ?? []).filter((e) => level === "all" || e.level === level);
  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader
        title="Logs"
        sub="Events from the runners and the app, runner logs and per-game fastchess logs"
        actions={
          <>
            <select className="select" style={{ width: 300 }} value={tid} onChange={(e) => { setTid(e.target.value); setFile(""); setText(""); }} aria-label="Tournament">
              <option value="">All tournaments</option>
              {(ts ?? []).map((t) => (
                <option key={t.record.id} value={t.record.id}>
                  {t.record.name}
                </option>
              ))}
            </select>
            <Seg value={level} onChange={setLevel} options={[{ value: "all", label: "All" }, { value: "error", label: "Errors" }, { value: "warn", label: "Warnings" }, { value: "success", label: "Success" }, { value: "info", label: "Info" }]} />
          </>
        }
      />
      <div className="grid gap-3" style={{ gridTemplateColumns: tid ? "1fr 1fr" : "1fr" }}>
        <Panel title={`${rows.length} events`} noPad>
          <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 170px)" }}>
            <table className="tbl" data-testid="events-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Level</th>
                  <th>Kind</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.seq}>
                    <td className="mono">{e.ts.slice(0, 19).replace("T", " ")}</td>
                    <td>
                      <span className={`chip ${e.level === "error" ? "chip-loss" : e.level === "warn" ? "chip-warn" : e.level === "success" ? "chip-win" : ""}`}>{e.level}</span>
                    </td>
                    <td className="mono muted">{e.kind}</td>
                    <td className="whitespace-normal">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <Empty>No event.</Empty>}
          </div>
        </Panel>
        {tid && (
          <Panel title="Log files" noPad>
            <div className="grid" style={{ gridTemplateColumns: "240px 1fr", height: "calc(100vh - 170px)" }}>
              <div className="overflow-auto" style={{ borderRight: "1px solid var(--border)" }}>
                {(files ?? []).map((f) => (
                  <button key={f.path} className="w-full text-left px-2.5 py-1.5 text-[12px]" style={{ background: f.path === file ? "var(--accent-bg)" : undefined, borderBottom: "1px solid var(--border)" }} onClick={() => setFile(f.path)}>
                    <div className="mono truncate">{f.name}</div>
                    <div className="muted text-[11px]">
                      {bytes(f.bytes)} · {f.modified}
                    </div>
                  </button>
                ))}
              </div>
              <pre className="mono text-[11px] p-2 overflow-auto whitespace-pre-wrap">{text || "Select a file (the last 96 KB are shown and refreshed)."}</pre>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
