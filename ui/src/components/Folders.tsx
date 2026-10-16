import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Folder, FolderOpen, Palette } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Modal } from "./ui";
import { call, usePoll } from "../lib/api";
import { useT, type Key } from "../i18n";

/** Pages whose folders can have a colour (the key of a colour is `<page>/<folder>`). */
export type FolderPage = "engines" | "tournaments" | "database";

/** The colours a folder can take: mid tones, readable on the light and the dark themes. */
export const FOLDER_COLORS = {
  red: "#e5534b",
  orange: "#e0823d",
  yellow: "#d4a72c",
  green: "#3fa66a",
  teal: "#2aa198",
  blue: "#4a8fe7",
  purple: "#9a6fdc",
  pink: "#d6609a",
} as const;
export type FolderColor = keyof typeof FOLDER_COLORS;

/** The folder colours of every page, and a setter that saves them. */
export function useFolderColors() {
  const { data, refresh } = usePoll<Record<string, string>>("folder_colors", {}, 0);
  const [colors, setColors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (data) setColors(data);
  }, [data]);
  const colorOf = useCallback(
    (page: FolderPage, folder: string | number | null | undefined): string | undefined => {
      if (folder == null || folder === "") return undefined;
      const c = colors[`${page}/${folder}`];
      return c ? (FOLDER_COLORS[c as FolderColor] ?? undefined) : undefined;
    },
    [colors],
  );
  const nameOf = (page: FolderPage, folder: string | number) => colors[`${page}/${folder}`] as FolderColor | undefined;
  const setColor = async (page: FolderPage, folder: string | number, color: FolderColor | null) => {
    try {
      setColors(await call<Record<string, string>>("folder_color_set", { page, folder: String(folder), color }));
    } catch (e) {
      toast.error((e as Error).message);
      refresh();
    }
  };
  return { colorOf, nameOf, setColor, refresh };
}

/** A folder icon in the folder's colour (lightly filled), or the plain muted one. */
export function FolderIcon({ color, open, size = 12 }: { color?: string; open?: boolean; size?: number }) {
  const Icon = open ? FolderOpen : Folder;
  return color ? <Icon size={size} className="shrink-0" style={{ color }} fill={`${color}33`} /> : <Icon size={size} className="muted shrink-0" />;
}

/** A small menu to pick the colour of a folder. */
export function FolderColorMenu({ value, onChange, testid = "folder-color" }: { value?: FolderColor; onChange: (c: FolderColor | null) => void; testid?: string }) {
  const t = useT();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="btn btn-sm btn-ghost" title={t("ui.folderColor.tip")} data-testid={testid}>
          {value ? <span className="inline-block rounded-full" style={{ width: 10, height: 10, background: FOLDER_COLORS[value] }} /> : <Palette size={12} />} {t("ui.folderColor.label")} <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="end" sideOffset={4} style={{ minWidth: 170 }}>
          {(Object.keys(FOLDER_COLORS) as FolderColor[]).map((c) => (
            <DropdownMenu.Item key={c} className="menu-item items-center" onSelect={() => onChange(c)} data-testid={`${testid}-${c}`}>
              <span className="inline-block rounded-full shrink-0" style={{ width: 12, height: 12, background: FOLDER_COLORS[c] }} />
              <span className="flex-1">{t(`ui.folderColor.${c}` as Key)}</span>
              {value === c && <Check size={12} />}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Item className="menu-item items-center" onSelect={() => onChange(null)} data-testid={`${testid}-none`}>
            <span className="inline-block rounded-full shrink-0" style={{ width: 12, height: 12, border: "1px solid var(--border-strong)" }} />
            <span className="flex-1">{t("ui.folderColor.none")}</span>
            {!value && <Check size={12} />}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Asks a folder name (new folder, rename). */
export function FolderNameDialog({ open, title, initial, placeholder, okLabel, onOk, onClose }: { open: boolean; title: string; initial: string; placeholder: string; okLabel: string; onOk: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial);
  useEffect(() => setName(initial), [initial, open]);
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      width={420}
      footer={
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => onOk(name.trim())} data-testid="folder-name-ok">
          {okLabel}
        </button>
      }
    >
      <input className="input w-full" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && onOk(name.trim())} placeholder={placeholder} data-testid="folder-name" />
    </Modal>
  );
}
