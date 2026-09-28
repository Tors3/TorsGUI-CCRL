import { useEffect, useRef } from "react";
import uPlot from "uplot";

export type Series = { label: string; color: string; values: (number | null)[]; dash?: number[]; width?: number; bars?: boolean };

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";
/** Canvas needs real colours: resolve `var(--x)` tokens. */
const color = (c: string) => (c.startsWith("var(") ? css(c.slice(4, -1).trim()) : c);

/** Small uPlot line chart that follows the container width. */
export function LineChart(props: { x: number[]; series: Series[]; height?: number; yRange?: [number, number]; xLabel?: (v: number) => string; yLabel?: (v: number) => string; zeroLine?: boolean; onClick?: (idx: number) => void; marker?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const key = JSON.stringify([props.x, props.series.map((s) => s.values), props.marker]);
  useEffect(() => {
    if (!el.current) return;
    const w = el.current.clientWidth || 400;
    const grid = { stroke: css("--border"), width: 1 };
    const opts: uPlot.Options = {
      width: w,
      height: props.height ?? 160,
      legend: { show: false },
      cursor: { points: { size: 5 }, drag: { x: false, y: false } },
      scales: { x: { time: false }, y: props.yRange ? { range: props.yRange } : { auto: true } },
      axes: [
        { stroke: css("--muted"), grid, ticks: { show: false }, size: 22, values: props.xLabel ? (_u, vs) => vs.map((v) => props.xLabel!(v)) : undefined, font: "11px sans-serif" },
        { stroke: css("--muted"), grid, ticks: { show: false }, size: 38, values: props.yLabel ? (_u, vs) => vs.map((v) => props.yLabel!(v)) : undefined, font: "11px sans-serif" },
      ],
      series: [
        {},
        ...props.series.map((s) => ({
          label: s.label,
          stroke: color(s.color),
          width: s.width ?? 1.6,
          dash: s.dash,
          points: { show: props.x.length < 40 },
          spanGaps: true,
          paths: s.bars ? uPlot.paths.bars!({ size: [0.7, 20] }) : undefined,
          fill: s.bars ? color(s.color) : undefined,
        })),
      ],
      hooks: {
        draw: [
          (u) => {
            const ctx = u.ctx;
            if (props.zeroLine) {
              const y = u.valToPos(0, "y", true);
              ctx.save();
              ctx.strokeStyle = css("--border-strong");
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(u.bbox.left, y);
              ctx.lineTo(u.bbox.left + u.bbox.width, y);
              ctx.stroke();
              ctx.restore();
            }
            if (props.marker != null) {
              const x = u.valToPos(props.marker, "x", true);
              ctx.save();
              ctx.strokeStyle = css("--accent");
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(x, u.bbox.top);
              ctx.lineTo(x, u.bbox.top + u.bbox.height);
              ctx.stroke();
              ctx.restore();
            }
          },
        ],
      },
    };
    const data = [props.x, ...props.series.map((s) => s.values)] as uPlot.AlignedData;
    plot.current?.destroy();
    plot.current = new uPlot(opts, data, el.current);
    if (props.onClick) {
      const over = el.current.querySelector(".u-over") as HTMLElement | null;
      over?.addEventListener("click", () => {
        const i = plot.current?.cursor.idx;
        if (i != null) props.onClick!(i);
      });
    }
    const ro = new ResizeObserver(() => {
      if (el.current && plot.current) plot.current.setSize({ width: el.current.clientWidth, height: props.height ?? 160 });
    });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, props.height]);
  return <div ref={el} className="w-full" data-testid="chart" />;
}

/** Tiny inline sparkline (SVG, no library). */
export function Spark({ values, color = "var(--accent)", width = 90, height = 22 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const mn = Math.min(...values), mx = Math.max(...values);
  const r = mx - mn || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - mn) / r) * (height - 4)}`).join(" ");
  return (
    <svg width={width} height={height} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
