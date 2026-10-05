import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { isTauri } from "../lib/api";

export type PathKind = "file" | "folder";
export type PathFilter = { name: string; extensions: string[] };

/** Opens the system's file / folder picker (desktop app only); null when cancelled. */
export async function browse(kind: PathKind, current = "", filters?: PathFilter[]): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: kind === "folder", multiple: false, defaultPath: current || undefined, filters: kind === "file" ? filters : undefined });
  return typeof r === "string" ? r : null;
}

/** A path field with a Browse… button in the desktop app (in a browser: the field alone). */
export function PathInput(props: {
  value: string;
  onChange: (v: string) => void;
  kind: PathKind;
  filters?: PathFilter[];
  placeholder?: string;
  testid?: string;
  className?: string;
  onEnter?: () => void;
}) {
  return (
    <div className={`flex gap-1.5 min-w-0 ${props.className ?? ""}`}>
      <input
        className="input mono flex-1 min-w-0"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && props.onEnter?.()}
        placeholder={props.placeholder}
        data-testid={props.testid}
      />
      {isTauri() && (
        <button
          type="button"
          className="btn shrink-0"
          title={props.kind === "folder" ? "Choose a folder" : "Choose a file"}
          onClick={async () => {
            try {
              const p = await browse(props.kind, props.value, props.filters);
              if (p) props.onChange(p);
            } catch (e) {
              toast.error(String((e as Error).message ?? e));
            }
          }}
          data-testid={props.testid ? `${props.testid}-browse` : undefined}
        >
          <FolderOpen size={13} /> Browse…
        </button>
      )}
    </div>
  );
}

export const BOOK_FILTERS: PathFilter[] = [{ name: "Opening books", extensions: ["pgn", "epd"] }];
export const ENGINE_FILTERS: PathFilter[] = [
  { name: "Engines", extensions: ["exe"] },
  { name: "All files", extensions: ["*"] },
];
