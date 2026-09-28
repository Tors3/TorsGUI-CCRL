import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import type { GameRow } from "../bindings/GameRow";
import { duration, shortTime } from "../lib/format";
import type { GameRef } from "./GameViewer";
import { ErrorBox, Panel, Result } from "./ui";

const col = createColumnHelper<GameRow>();

export function GamesTable({ rows: data, error, onOpen, maxHeight = "calc(100vh - 330px)", title }: { rows?: GameRow[]; error?: string; onOpen: (g: GameRef) => void; maxHeight?: string; title?: string }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "end_time", desc: true }]);
  const [q, setQ] = useState("");
  const columns = useMemo(
    () => [
      col.accessor("end_time", { header: "Finished", cell: (c) => <span className="mono">{shortTime(c.getValue())}</span> }),
      col.accessor("white", { header: "White" }),
      col.accessor("black", { header: "Black" }),
      col.accessor("result", { header: "Result", cell: (c) => <Result r={c.getValue()} /> }),
      col.accessor("termination", { header: "Termination" }),
      col.accessor("plies", { header: "Moves", cell: (c) => Math.ceil(c.getValue() / 2) }),
      col.accessor("duration_s", { header: "Duration", cell: (c) => duration(c.getValue()) }),
      col.accessor("round", { header: "Slot", cell: (c) => <span className="mono muted">{c.getValue()}</span> }),
      col.accessor("opening", { header: "Opening", cell: (c) => <span className="truncate block max-w-[280px]" title={c.getValue()}>{c.getValue()}</span> }),
    ],
    [],
  );
  const table = useReactTable({
    data: data ?? [],
    columns,
    state: { sorting, globalFilter: q },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQ,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  return (
    <Panel
      title={`${title ? title + " · " : ""}${table.getRowModel().rows.length} games`}
      noPad
      actions={<input className="input" style={{ width: 240 }} placeholder="Filter (engine, result, opening…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter games" />}
    >
      <ErrorBox error={error} />
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="tbl" data-testid="games-table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} onClick={h.column.getToggleSortingHandler()} className="cursor-pointer">
                    {flexRender(h.column.columnDef.header, h.getContext())} {h.column.getIsSorted() ? (h.column.getIsSorted() === "desc" ? "↓" : "↑") : ""}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.slice(0, 1000).map((r) => (
              <tr key={r.id} className="clickable" onClick={() => onOpen({ source: r.original.source, index: r.original.index })}>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

