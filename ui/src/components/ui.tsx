import { HelpLink } from "./HelpLink";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { AlertTriangle, Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import type { TState } from "../bindings/TState";

export function Panel(props: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; noPad?: boolean }) {
  return (
    <section className={`panel flex flex-col min-h-0 ${props.className ?? ""}`}>
      {(props.title || props.actions) && (
        <div className="panel-head">
          <div className="panel-title">{props.title}</div>
          <div className="flex items-center gap-1.5">{props.actions}</div>
        </div>
      )}
      <div className={`${props.noPad ? "" : "panel-body"} min-h-0 flex-1 ${props.bodyClass ?? ""}`}>{props.children}</div>
    </section>
  );
}

export function Kpi(props: { label: string; value: ReactNode; sub?: ReactNode; tone?: "win" | "loss" | "warn" | "accent" }) {
  const color = props.tone === "win" ? "var(--win)" : props.tone === "loss" ? "var(--loss)" : props.tone === "warn" ? "var(--warn)" : props.tone === "accent" ? "var(--accent-2)" : undefined;
  return (
    <div className="panel px-3 py-2.5 min-w-0">
      <div className="kpi-label">{props.label}</div>
      <div className="kpi-value truncate" style={{ color }}>
        {props.value}
      </div>
      {props.sub != null && <div className="text-[11.5px] muted truncate tnum">{props.sub}</div>}
    </div>
  );
}

const STATE_TONE: Record<TState, string> = {
  draft: "",
  queued: "chip-accent",
  running: "chip-win",
  paused: "chip-warn",
  stopped: "chip-warn",
  completed: "chip-accent",
  incomplete: "chip-loss",
  failed: "chip-loss",
};

export function StateChip({ state, alive }: { state: TState; alive?: boolean }) {
  return (
    <span className={`chip ${STATE_TONE[state]}`} data-testid="state-chip">
      {state === "running" && <span className={`dot ${alive === false ? "" : "dot-pulse"}`} />}
      {state}
      {state === "running" && alive === false && " · no runner"}
    </span>
  );
}

export function WdlBar({ w, d, l, height = 6 }: { w: number; d: number; l: number; height?: number }) {
  const n = w + d + l || 1;
  return (
    <div className="bar" style={{ height }} title={`+${w} =${d} −${l}`}>
      <span style={{ width: `${(100 * w) / n}%`, background: "var(--win)" }} />
      <span style={{ width: `${(100 * d) / n}%`, background: "var(--draw)", opacity: 0.55 }} />
      <span style={{ width: `${(100 * l) / n}%`, background: "var(--loss)" }} />
    </div>
  );
}

export function ProgressBar({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "win" | "warn" }) {
  const p = max > 0 ? Math.min(100, (100 * value) / max) : 0;
  const c = tone === "win" ? "var(--win)" : tone === "warn" ? "var(--warn)" : "var(--accent)";
  return (
    <div className="bar" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <span style={{ width: `${p}%`, background: c, transition: "width .4s ease" }} />
    </div>
  );
}

export function Wdl({ w, d, l }: { w: number; d: number; l: number }) {
  return (
    <span className="tnum whitespace-nowrap">
      <span className="w">+{w}</span> <span className="d">={d}</span> <span className="l">−{l}</span>
    </span>
  );
}

export function Result({ r }: { r: string }) {
  const c = r === "1-0" ? "chip-win" : r === "0-1" ? "chip-loss" : "";
  return <span className={`chip ${c} mono`}>{r === "1/2-1/2" ? "½-½" : r}</span>;
}

export function Field(props: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`block ${props.className ?? ""}`}>
      <span className="label">{props.label}</span>
      {props.children}
      {props.hint && <span className="block text-[11px] muted mt-0.5">{props.hint}</span>}
    </label>
  );
}

export function Modal(props: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; children: ReactNode; width?: number; footer?: ReactNode }) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog fade-in" style={{ width: `min(${props.width ?? 640}px, 96vw)` }} aria-describedby={undefined}>
          <div className="panel-head sticky top-0 z-10" style={{ background: "var(--panel)" }}>
            <Dialog.Title className="text-[14px] font-semibold">{props.title}</Dialog.Title>
            <Dialog.Close className="btn btn-ghost btn-icon" aria-label="Close">
              <X size={15} />
            </Dialog.Close>
          </div>
          <div className="p-4">{props.children}</div>
          {props.footer && (
            <div className="flex justify-end gap-2 px-4 py-3 sticky bottom-0" style={{ borderTop: "1px solid var(--border)", background: "var(--panel)" }}>
              {props.footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <Tooltip.Root delayDuration={250}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={5} className="z-50 max-w-xs rounded-md px-2 py-1 text-[12px]" style={{ background: "var(--panel-2)", border: "1px solid var(--border-strong)", boxShadow: "var(--shadow)" }}>
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 muted text-center">
      {icon}
      <div className="max-w-md">{children}</div>
    </div>
  );
}

export function ErrorBox({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-md px-3 py-2 text-[12.5px]" style={{ background: "var(--loss-bg)", color: "var(--loss)" }} role="alert">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <span className="whitespace-pre-wrap">{error}</span>
    </div>
  );
}

export function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md px-3 py-1.5 text-[12.5px]" style={{ background: "var(--warn-bg)", color: "var(--warn)" }}>
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" />;
}

export function PageHeader(props: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; help?: string }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h1 className="text-[18px] font-semibold tracking-tight truncate">{props.title}</h1>
        {props.sub && <div className="muted text-[12.5px] truncate">{props.sub}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {props.actions}
        {props.help && <HelpLink section={props.help} />}
      </div>
    </div>
  );
}

export function Seg<T extends string>(props: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-md p-0.5 gap-0.5" style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="px-2 h-6 rounded text-[12px] font-medium"
          style={{ background: o.value === props.value ? "var(--panel-2)" : "transparent", color: o.value === props.value ? "var(--text)" : "var(--muted)", border: o.value === props.value ? "1px solid var(--border-strong)" : "1px solid transparent" }}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
