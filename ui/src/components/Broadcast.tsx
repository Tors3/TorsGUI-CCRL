import { CheckCircle2, Copy, ExternalLink, Globe, Radio, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { BroadcastConfig } from "../bindings/BroadcastConfig";
import type { BroadcastState } from "../bindings/BroadcastState";
import type { Settings } from "../bindings/Settings";
import { call, usePoll } from "../lib/api";
import { ErrorBox, Field, Spinner } from "./ui";

type BroadcastInfo = { config: BroadcastConfig; state: BroadcastState; running: boolean; lichess_token: boolean; first_port: number; last_port: number; lanes: number };

const copy = (text: string) =>
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success("Copied"))
    .catch(() => toast.error("Copy failed"));

/** The message for Jay (ccrl.live) with the address and ports of this machine. */
export function ccrlLiveMessage(host: string, first: number, last: number, tester: string) {
  const ports = first === last ? `${first}` : `${first}-${last}`;
  return `Hi Jay, I am ${tester || "a CCRL tester"} and I would like to broadcast my CCRL games on ccrl.live. TorsGUI acts as a TLCS server: please add ${host}:${first}${first === last ? "" : ` to ${host}:${last}`} (UDP ${ports}, one broadcast per game slot). Thanks!`;
}

/** Settings → Live broadcast: Lichess token and visibility, ccrl.live ports, firewall. */
export function BroadcastSettings({ s, set }: { s: Settings; set: <K extends keyof Settings>(k: K, v: Settings[K]) => void }) {
  const [account, setAccount] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [ip, setIp] = useState<string | null>(null);
  const check = async () => {
    setChecking(true);
    try {
      const u = await call<string>("lichess_check", { token: s.lichess_token });
      // a good token is saved at once, without the other unsaved changes
      const saved = await call<Settings>("settings_get");
      await call("settings_save", { settings: { ...saved, lichess_token: s.lichess_token } });
      setAccount(u);
      toast.success(`Lichess token OK and saved: ${u}`);
    } catch (e) {
      setAccount(null);
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  };
  const last = s.ccrl_live_port + 15;
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <div className="flex flex-col gap-2">
        <div className="font-medium flex items-center gap-1.5">
          <Globe size={14} /> Lichess broadcast
        </div>
        <Field label="Lichess API token" hint="lichess.org/account/oauth/token/create with only “Read studies and broadcasts” and “Create, update, delete studies and broadcasts”. Check saves it; it stays on this computer.">
          <div className="flex gap-2">
            <input className="input mono" type="password" autoComplete="off" placeholder="lip_…" value={s.lichess_token} onChange={(e) => set("lichess_token", e.target.value.trim())} data-testid="lichess-token" />
            <button className="btn" disabled={!s.lichess_token || checking} onClick={check}>
              {checking ? <Spinner size={12} /> : <CheckCircle2 size={13} />} Check
            </button>
          </div>
        </Field>
        {account && <div className="text-[12px]" style={{ color: "var(--win)" }}>Account: {account}</div>}
        <Field label="Visibility of new broadcasts" hint="Public broadcasts appear under the account's broadcasts; the official list on lichess.org/broadcast is curated by Lichess.">
          <select className="select" value={s.lichess_visibility} onChange={(e) => set("lichess_visibility", e.target.value)}>
            <option value="public">Public</option>
            <option value="unlisted">Unlisted (only with the link)</option>
            <option value="private">Private</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <div className="font-medium flex items-center gap-1.5">
          <Radio size={14} /> ccrl.live
        </div>
        <Field label="First UDP port" hint="Each game slot (lane) is one broadcast: lane 1 uses this port, lane 2 the next one…">
          <input className="input tnum" type="number" min={1024} max={65000} value={s.ccrl_live_port} onChange={(e) => set("ccrl_live_port", Math.max(1024, Math.min(65000, +e.target.value)))} data-testid="ccrl-live-port" />
        </Field>
        <ol className="text-[12px] list-decimal pl-5 flex flex-col gap-1 muted">
          <li>
            Router: forward <b>UDP {s.ccrl_live_port}–{last}</b> (as many ports as lanes) to this computer.
          </li>
          <li>
            Firewall: allow the same ports{" "}
            <button
              className="btn btn-sm"
              onClick={() =>
                call("firewall_allow_udp", { from: s.ccrl_live_port, to: last })
                  .then(() => toast.success("Windows asks for administrator rights to add the rule"))
                  .catch((e) => toast.error((e as Error).message))
              }
            >
              <ShieldCheck size={12} /> Allow in the firewall
            </button>
          </li>
          <li>
            A fixed address: your public IP{" "}
            <button className="btn btn-sm" onClick={() => call<string>("public_ip").then(setIp).catch((e) => toast.error((e as Error).message))}>
              Show
            </button>{" "}
            {ip && <span className="mono">{ip}</span>} or a free dynamic DNS name (e.g. DuckDNS) if it changes.
          </li>
          <li>
            Ask Jay Honnold (ccrl.live) to add your address and ports{" "}
            <button className="btn btn-sm" onClick={() => copy(ccrlLiveMessage(ip ?? "<your address>", s.ccrl_live_port, last, s.tester_name))}>
              <Copy size={12} /> Copy the message
            </button>
          </li>
        </ol>
      </div>
    </div>
  );
}

/** Tournament page: what is broadcast, links, viewers, errors. */
export function TournamentBroadcast({ id }: { id: string }) {
  const { data, refresh } = usePoll<BroadcastInfo>("broadcast_get", { id }, 3000);
  const [busy, setBusy] = useState(false);
  // the switches answer at once; a refused change goes back
  const [local, setLocal] = useState<Partial<BroadcastConfig>>({});
  if (!data) return <Spinner />;
  const c: BroadcastConfig = { ...data.config, ...local };
  const st = data.state;
  const toggle = async (k: "lichess" | "ccrl_live", v: boolean) => {
    setBusy(true);
    setLocal((l) => ({ ...l, [k]: v }));
    try {
      await call("broadcast_set", { id, [k]: v });
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLocal((l) => {
        const n = { ...l };
        delete n[k];
        return n;
      });
      setBusy(false);
    }
  };
  const viewers = st.lanes.reduce((n, l) => n + l.viewers.length, 0);
  return (
    <div className="flex flex-col gap-3" data-testid="broadcast-panel">
      <div className="flex gap-6 flex-wrap items-center">
        <label className="flex items-center gap-2">
          <input type="checkbox" disabled={busy} checked={c.lichess} onChange={(e) => toggle("lichess", e.target.checked)} data-testid="broadcast-lichess" />
          <Globe size={14} /> Lichess
          {!data.lichess_token && <span className="muted text-[12px]">(token in Settings → Live broadcast)</span>}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" disabled={busy} checked={c.ccrl_live} onChange={(e) => toggle("ccrl_live", e.target.checked)} data-testid="broadcast-ccrl" />
          <Radio size={14} /> ccrl.live <span className="muted text-[12px]">(UDP {data.first_port === data.last_port ? data.first_port : `${data.first_port}–${data.last_port}`})</span>
        </label>
        {(c.lichess || c.ccrl_live) && (
          <span className={`chip ${data.running ? "chip-win" : ""}`}>{data.running ? "on air while the tournament runs" : "starts with the tournament"}</span>
        )}
      </div>
      {c.lichess && (
        <div className="text-[12.5px] flex flex-col gap-1">
          {st.lichess_url ? (
            <div className="flex items-center gap-2 flex-wrap">
              <a className="link inline-flex items-center gap-1" href={st.lichess_url} target="_blank" rel="noreferrer" data-testid="lichess-link">
                <ExternalLink size={12} /> {st.lichess_url}
              </a>
              <button className="btn btn-sm" onClick={() => copy(st.lichess_url!)}>
                <Copy size={12} /> Copy
              </button>
            </div>
          ) : (
            <span className="muted">The Lichess broadcast is created with the first game.</span>
          )}
          <span className="muted">
            {Object.keys(st.boards).length} games broadcast · {st.rounds.length} round(s) · {st.lichess_pushes} updates{st.lichess_last_push ? ` · last ${st.lichess_last_push.slice(11, 19)}` : ""}
          </span>
          {st.lichess_error && <ErrorBox error={st.lichess_error} />}
        </div>
      )}
      {c.ccrl_live && (
        <div className="text-[12.5px]">
          <div className="muted mb-1">{viewers > 0 ? `${viewers} viewer connection(s) (ccrl.live)` : "No viewer connected yet: ccrl.live connects once Jay has added your address and ports."}</div>
          {st.lanes.length > 0 && (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Lane</th>
                  <th>UDP port</th>
                  <th>Game</th>
                  <th>Viewers</th>
                </tr>
              </thead>
              <tbody>
                {st.lanes.map((l) => (
                  <tr key={l.lane}>
                    <td className="tnum">{l.lane + 1}</td>
                    <td className="mono">{l.port}</td>
                    <td>{l.game ?? <span className="muted">—</span>}</td>
                    <td>{l.error ? <span style={{ color: "var(--loss)" }}>{l.error}</span> : l.viewers.length ? l.viewers.join(", ") : <span className="muted">none</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
