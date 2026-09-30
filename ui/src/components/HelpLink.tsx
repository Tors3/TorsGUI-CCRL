import { CircleHelp } from "lucide-react";
import { useNavigate } from "react-router-dom";

/** Opens the in-app guide at a section (`slug` of its heading). */
export function HelpLink({ section, label, doc }: { section: string; label?: string; doc?: "guide" | "file" }) {
  const nav = useNavigate();
  const go = () => nav(`/help?${doc === "file" ? "doc=file&" : ""}s=${encodeURIComponent(section)}`);
  return label ? (
    <button className="btn btn-sm btn-ghost" onClick={go} data-testid="help-link">
      <CircleHelp size={13} /> {label}
    </button>
  ) : (
    <button className="btn btn-icon btn-ghost" onClick={go} aria-label="Help for this screen" title="Help for this screen" data-testid="help-link">
      <CircleHelp size={15} />
    </button>
  );
}
