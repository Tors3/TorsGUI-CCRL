import { rmSync } from "node:fs";

export default async function globalTeardown() {
  const API = "http://127.0.0.1:7880/api";
  // stop demo runners, then the server
  try {
    const ts = await (await fetch(`${API}/tournaments_list`, { method: "POST", body: "{}" })).json();
    for (const t of ts) if (t.record.state === "running") await fetch(`${API}/tournament_stop`, { method: "POST", body: JSON.stringify({ id: t.record.id }) });
    await new Promise((r) => setTimeout(r, 3000));
  } catch {
    /* server already gone */
  }
  const pid = Number(process.env.TORSGUI_E2E_PID);
  if (pid) {
    try {
      process.kill(pid);
    } catch {
      /* already stopped */
    }
  }
  if (process.env.TORSGUI_E2E_WS && !process.env.TORSGUI_E2E_KEEP) {
    try {
      rmSync(process.env.TORSGUI_E2E_WS, { recursive: true, force: true });
    } catch {
      /* files still in use on Windows */
    }
  }
}
