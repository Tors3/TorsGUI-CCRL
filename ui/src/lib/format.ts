export function duration(s?: number | null): string {
  if (s == null || !isFinite(s) || s < 0) return "—";
  const t = Math.round(s);
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(t % 60).padStart(2, "0")}s`;
  return `${t}s`;
}
export function clock(ms?: number | null): string {
  if (ms == null) return "—";
  const s = ms / 1000;
  if (s < 10) return s.toFixed(1);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
export function pct(x?: number | null, digits = 1): string {
  return x == null || !isFinite(x) ? "—" : `${x.toFixed(digits)}%`;
}
export function num(x?: number | null, digits = 0): string {
  return x == null || !isFinite(x) ? "—" : x.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
export function signed(x?: number | null, digits = 0): string {
  if (x == null || !isFinite(x)) return "—";
  const v = x.toFixed(digits);
  return x > 0 ? `+${v}` : v.replace("-", "−");
}
export function bytes(b?: number | null): string {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}
export function nps(n?: number | null): string {
  if (n == null) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}
export function evalText(cp?: number | null, mate?: number | null): string {
  if (mate != null) return `${mate > 0 ? "+" : "−"}M${Math.abs(mate)}`;
  if (cp == null) return "—";
  return signed(cp / 100, 2);
}
export function ago(ts?: string | null): string {
  if (!ts) return "—";
  const t = Date.parse(ts.replace(" +", "+").replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  if (isNaN(t)) return ts;
  return duration((Date.now() - t) / 1000) + " ago";
}
export function shortTime(ts?: string | null): string {
  if (!ts) return "—";
  return ts.replace("T", " ").slice(0, 16);
}
