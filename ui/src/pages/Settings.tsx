import { CheckCircle2, Download, GitBranch, HardDrive, RotateCcw, Save, Server, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Housekeeping } from "../bindings/Housekeeping";
import type { Settings } from "../bindings/Settings";
import type { Topology } from "../bindings/Topology";
import { BoardAppearance } from "../components/BoardSettings";
import { OpeningBooksPanel } from "../components/OpeningBooks";
import { BroadcastSettings } from "../components/Broadcast";
import { ErrorBox, Field, PageHeader, Panel, Spinner } from "../components/ui";
import { call, usePoll } from "../lib/api";
import { bytes } from "../lib/format";
import type { AppInfo } from "../lib/types";

function TopologyView({ t }: { t: Topology }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px]">
        <b>{t.cpu_model}</b> · {t.sockets} socket(s) · {t.physical_cores} cores / {t.logical_cpus} threads · {t.groups} processor group(s) · AVX2 {t.has_avx2 ? "yes" : "no"} · AVX-512 {t.has_avx512 ? "yes (never for CCRL)" : "no"}
        <span className="muted"> · source: {t.source}</span>
      </div>
      <div className="flex gap-3 flex-wrap">
        {t.nodes.map((n) => {
          const cpus = t.cpus.filter((c) => c.node === n.id);
          const cores = Array.from(new Set(cpus.map((c) => c.core)));
          return (
            <div key={n.id} className="panel p-2" style={{ background: "var(--bg-2)" }} data-testid="numa-node">
              <div className="text-[12px] mb-1.5 flex justify-between gap-4">
                <b>NUMA node {n.id}</b>
                <span className="muted">
                  group {n.group} · {n.physical_cores}c/{n.logical_cpus}t{n.memory_mb ? ` · ${(n.memory_mb / 1024).toFixed(0)} GB` : ""}
                </span>
              </div>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(10, cores.length)}, 26px)` }}>
                {cores.map((c) => {
                  const threads = cpus.filter((x) => x.core === c).sort((a, b) => a.smt - b.smt);
                  return (
                    <div key={c} className="rounded flex flex-col overflow-hidden" style={{ border: "1px solid var(--border-strong)" }} title={`core ${c}: ${threads.map((x) => `cpu ${x.id} (bit ${x.number})`).join(", ")}`}>
                      {threads.map((x) => (
                        <div key={x.id} className="h-[11px] text-[8px] leading-[11px] text-center tnum" style={{ background: x.smt === 0 ? "var(--accent-bg)" : "transparent", color: x.smt === 0 ? "var(--accent-2)" : "var(--muted)" }}>
                          {x.number}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="muted text-[11.5px]">Highlighted: the first hardware thread of each physical core (the "one logical CPU per physical core" set used for games). Caches: {t.caches.map((c) => `L${c.level} ${c.kind} ${c.size_kb} KB`).join(" · ") || "—"}</div>
    </div>
  );
}

export function SettingsPage() {
  const { data, refresh } = usePoll<Settings>("settings_get", {}, 0);
  const { data: info, refresh: refreshInfo } = usePoll<AppInfo>("app_info", {}, 0);
  const { data: topo } = usePoll<Topology>("topology", {}, 0);
  const { data: hk, refresh: refreshHk } = usePoll<Housekeeping>("housekeeping", {}, 0);
  const [s, setS] = useState<Settings>();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string>();
  const [gitMsg, setGitMsg] = useState("");
  useEffect(() => {
    if (data) setS(data);
  }, [data]);
  if (!s) return <Spinner />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const save = async () => {
    try {
      await call("settings_save", { settings: s });
      toast.success("Settings saved");
      refresh();
      refreshInfo();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const act = async (name: string, cmd: string, args: Record<string, unknown> = {}, msg?: (r: any) => string) => {
    setBusy(name);
    setErr(undefined);
    try {
      const r = await call(cmd, args);
      toast.success(msg ? msg(r) : "Done");
      refreshInfo();
      refreshHk();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const txt = (k: keyof Settings, label: string, hint?: string, mono = true) => (
    <Field label={label} hint={hint}>
      <input className={`input ${mono ? "mono" : ""}`} value={String(s[k] ?? "")} onChange={(e) => set(k, e.target.value as never)} />
    </Field>
  );
  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader help="new-machine"
        title="Settings"
        sub={info ? `TorsGUI ${info.version} · workspace ${info.workspace} · ${info.os}` : ""}
        actions={
          <button className="btn btn-primary" onClick={save}>
            <Save size={14} /> Save settings
          </button>
        }
      />
      <ErrorBox error={err} />
      <div className="grid grid-cols-3 gap-3">
        <Panel title="Tester">
          <div className="grid grid-cols-2 gap-3">
            {txt("tester_name", "Tester name", "used in the export file name", false)}
            {txt("site", "Site", "your location (PGN Site tag)", false)}
            <Field label="Theme">
              <select className="select" value={s.theme} onChange={(e) => set("theme", e.target.value)}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </Field>
            <Field label="Hash per thread (MB)" hint="CCRL rule: 512">
              <input className="input tnum" type="number" value={s.hash_per_thread_mb} onChange={(e) => set("hash_per_thread_mb", +e.target.value)} />
            </Field>
            <Field label="Default machine factor">
              <input className="input tnum" type="number" step={0.001} value={s.default_factor} onChange={(e) => set("default_factor", +e.target.value)} />
            </Field>
            <Field label="Default 8CPU − 1CPU gap" hint="when neither the engine nor the list give one">
              <input className="input tnum" type="number" value={s.default_cpu_gap} onChange={(e) => set("default_cpu_gap", +e.target.value)} />
            </Field>
          </div>
        </Panel>
        <Panel title="Paths">
          <div className="grid grid-cols-1 gap-2.5">
            {txt("engines_dir", "Engines folder", "downloads go to <folder>/<Repo>_<tag>")}
            {txt("books_dir", "Books folder")}
            {txt("default_book", "Default opening book")}
            {txt("tablebases_dir", "Tablebases folder")}
            {txt("syzygy_path", "Syzygy path passed to engines")}
            {txt("output_dir", "Export output folder")}
          </div>
        </Panel>
        <Panel title="fastchess &amp; runners">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-[12.5px]">
              {info?.fastchess_found ? <CheckCircle2 size={15} className="w" /> : <XCircle size={15} className="l" />}
              <span className="mono break-all">{info?.fastchess_version ?? "fastchess not found"}</span>
            </div>
            <div className="mono muted text-[11.5px] break-all">{info?.fastchess}</div>
            <div className="grid grid-cols-2 gap-2">
              {txt("fastchess_version", "Pinned version")}
              <div className="flex items-end">
                <button className="btn w-full justify-center" onClick={() => act("fc", "fastchess_install", {}, (r) => `fastchess installed (${r.sha256.slice(0, 12)}…)`)} disabled={!!busy}>
                  {busy === "fc" ? <Spinner /> : <Download size={13} />} Download
                </button>
              </div>
            </div>
            {txt("fastchess_path", "Custom fastchess binary", "empty = the managed download")}
            {txt("github_token", "GitHub token (optional)", "raises the API rate limit")}
            <div className="flex items-center gap-2 text-[12.5px]">
              {info?.runner_found ? <CheckCircle2 size={15} className="w" /> : <XCircle size={15} className="l" />} runner: <span className="mono muted break-all">{info?.runner}</span>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.use_task_scheduler} onChange={(e) => set("use_task_scheduler", e.target.checked)} /> Launch runners through the Windows Task Scheduler
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.auto_resume} onChange={(e) => set("auto_resume", e.target.checked)} /> Resume interrupted tournaments when TorsGUI starts
            </label>
            <div className="flex gap-2">
              <button className="btn btn-sm" onClick={() => act("resume", "resume_interrupted", {}, (r) => `${r.length} resumed`)}>
                <RotateCcw size={12} /> Resume interrupted now
              </button>
              <button className="btn btn-sm" onClick={() => act("logon", "register_logon_resume", {}, (r) => String(r))}>
                <Server size={12} /> Resume at logon / reboot
              </button>
            </div>
          </div>
        </Panel>
      </div>
      <Panel title="Live broadcast" actions={<span className="muted text-[11.5px]">Lichess and ccrl.live · choose per tournament (tournament → Live broadcast)</span>}>
        <BroadcastSettings s={s} set={set} />
      </Panel>
      <Panel title="Opening books">
        <OpeningBooksPanel settings={s} onSettings={refresh} />
      </Panel>
      <Panel title="CPU topology">{topo ? <TopologyView t={topo} /> : <Spinner />}</Panel>
      <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}>
        <Panel title="Board appearance" actions={<span className="muted text-[11.5px]">saved on this computer, applied immediately</span>}>
          <BoardAppearance />
        </Panel>
        <Panel title="Engine builds">
          <div className="flex flex-col gap-2.5 text-[12.5px]">
            <p className="muted">
              CCRL rule: the <b>AVX2</b> build, never AVX-512/VNNI/x86-64-v4. For your own tests you can allow AVX-512 builds: they are always marked <span className="chip chip-personal">not CCRL</span>, and the wizard warns when a tournament uses them.
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.allow_avx512} onChange={(e) => setS({ ...s, allow_avx512: e.target.checked, prefer_avx512: e.target.checked && s.prefer_avx512 })} data-testid="allow-avx512" /> Allow AVX-512 builds (personal use)
            </label>
            <label className="flex items-center gap-2" style={{ opacity: s.allow_avx512 ? 1 : 0.5 }}>
              <input type="checkbox" disabled={!s.allow_avx512} checked={s.prefer_avx512} onChange={(e) => set("prefer_avx512", e.target.checked)} /> Prefer them when this CPU supports AVX-512
            </label>
            <div className="muted text-[11.5px]">
              This CPU: AVX-512 {topo ? (topo.has_avx512 ? "yes" : "no") : "…"}. Default for new downloads; the <i>Add from GitHub</i> dialog can switch it per engine.
            </div>
          </div>
        </Panel>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Panel title="Default adjudication">
          <div className="grid grid-cols-3 gap-2 text-[12.5px]">
            <label className="col-span-3 flex items-center gap-2">
              <input type="checkbox" checked={s.adjudication.draw_enabled} onChange={(e) => set("adjudication", { ...s.adjudication, draw_enabled: e.target.checked })} /> Draw: from move / moves / |score| cp
            </label>
            {(["draw_movenumber", "draw_movecount", "draw_score"] as const).map((k) => (
              <input key={k} className="input tnum" type="number" value={s.adjudication[k]} onChange={(e) => set("adjudication", { ...s.adjudication, [k]: +e.target.value })} aria-label={k} />
            ))}
            <label className="col-span-3 flex items-center gap-2">
              <input type="checkbox" checked={s.adjudication.resign_enabled} onChange={(e) => set("adjudication", { ...s.adjudication, resign_enabled: e.target.checked })} /> Resign: moves / score cp / two-sided
            </label>
            {(["resign_movecount", "resign_score"] as const).map((k) => (
              <input key={k} className="input tnum" type="number" value={s.adjudication[k]} onChange={(e) => set("adjudication", { ...s.adjudication, [k]: +e.target.value })} aria-label={k} />
            ))}
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={s.adjudication.resign_twosided} onChange={(e) => set("adjudication", { ...s.adjudication, resign_twosided: e.target.checked })} /> two-sided
            </label>
          </div>
        </Panel>
        <Panel title="Housekeeping" actions={<HardDrive size={14} className="muted" />}>
          {hk ? (
            <div className="flex flex-col gap-2 text-[12px]">
              <div className="max-h-[120px] overflow-auto">
                {hk.disk.slice(0, 8).map((d) => (
                  <div key={d.path} className="flex justify-between">
                    <span className="mono truncate">{d.path}</span>
                    <span className="tnum">{bytes(d.bytes)}</span>
                  </div>
                ))}
              </div>
              <div>
                <b>Logs:</b> {hk.log_files} files, {bytes(hk.log_bytes)}
              </div>
              <div>
                <b>Unused engines:</b> {hk.unused_engines.join(", ") || "none"}
              </div>
              <div>
                <b>Superseded:</b> {hk.superseded_engines.map(([a, b]) => `${a} → ${b}`).join(", ") || "none"}
              </div>
              <div className="flex gap-2 items-end">
                <Field label="Keep game logs (days)">
                  <input className="input tnum" type="number" value={s.log_retention_days} onChange={(e) => set("log_retention_days", +e.target.value)} />
                </Field>
                <button className="btn" onClick={() => act("rot", "rotate_logs", { days: s.log_retention_days }, (r) => `${r.files} log files removed (${bytes(r.bytes)})`)}>
                  Rotate logs
                </button>
              </div>
            </div>
          ) : (
            <Spinner />
          )}
        </Panel>
        <Panel title="Git sync (optional)" actions={<GitBranch size={14} className="muted" />}>
          <div className="flex flex-col gap-2">
            {txt("git_sync_dir", "Repository folder", "results and configurations are copied there (like sync_repo.py)")}
            <Field label="Commit message (optional)">
              <input className="input" value={gitMsg} onChange={(e) => setGitMsg(e.target.value)} placeholder="Results 2026-09-28" />
            </Field>
            <button className="btn" onClick={() => act("git", "git_sync", { dest: s.git_sync_dir, message: gitMsg || null }, (r) => `${r.length} files synced`)} disabled={!s.git_sync_dir}>
              Sync now
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
