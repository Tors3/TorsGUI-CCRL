import { BookOpen, FileCode2, Rocket, Search } from "lucide-react";
import { Marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import guideMd from "../../../docs/USER_GUIDE.md?raw";
import fileMd from "../../../docs/TOURNAMENT_FILE.md?raw";
import { PageHeader, Panel } from "../components/ui";

/** Heading → anchor: "## 3. Engines" → "engines". */
export const slug = (text: string) =>
  text
    .replace(/<[^>]+>/g, "")
    .replace(/^\d+\.\s*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

type Section = { id: string; title: string; level: number; html: string; text: string };

const DOCS = {
  guide: { title: "User guide", md: guideMd, icon: BookOpen },
  file: { title: "Tournament files", md: fileMd, icon: FileCode2 },
} as const;
type DocId = keyof typeof DOCS;

/** Splits a Markdown guide into sections (one per ## / ### heading) rendered to HTML. */
function sections(md: string): Section[] {
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        return `<h${depth} id="${slug(text)}">${text}</h${depth}>`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        // links between the guides stay inside the app
        const internal = href === "TOURNAMENT_FILE.md" ? "#/help?doc=file" : href === "USER_GUIDE.md" ? "#/help" : null;
        if (internal) return `<a href="${internal}">${text}</a>`;
        if (href.startsWith("#")) return `<a href="#/help?s=${href.slice(1)}">${text}</a>`;
        return `<a href="${href}" target="_blank" rel="noreferrer"${title ? ` title="${title}"` : ""}>${text}</a>`;
      },
    },
  });
  const out: Section[] = [];
  const parts = md.split(/^(?=#{1,3} )/m);
  for (const p of parts) {
    const m = p.match(/^(#{1,3}) (.+)$/m);
    const title = m ? m[2].trim() : "";
    const level = m ? m[1].length : 1;
    out.push({ id: slug(title), title, level, html: marked.parse(p) as string, text: p.toLowerCase() });
  }
  return out;
}

export function Help() {
  const [sp, setSp] = useSearchParams();
  const doc: DocId = sp.get("doc") === "file" ? "file" : "guide";
  const target = sp.get("s") ?? "";
  const [q, setQ] = useState("");
  const all = useMemo(() => sections(DOCS[doc].md), [doc]);
  const shown = q.trim() ? all.filter((s) => s.text.includes(q.trim().toLowerCase())) : all;
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!target) {
      body.current?.scrollTo({ top: 0 });
      return;
    }
    const el = body.current?.querySelector<HTMLElement>(`#${CSS.escape(target)}`);
    if (el) {
      el.scrollIntoView({ block: "start" });
      el.classList.add("help-flash");
      setTimeout(() => el.classList.remove("help-flash"), 1600);
    }
  }, [target, doc, q]);
  const go = (s: string) => setSp(doc === "file" ? { doc: "file", s } : { s });
  return (
    <div className="flex flex-col gap-3 fade-in">
      <PageHeader
        title="Help"
        sub="The user guide inside TorsGUI (works offline) · every screen has a ? button that opens its section"
        actions={
          <>
            <Link className="btn btn-primary" to="/start">
              <Rocket size={14} /> Getting started
            </Link>
            {(Object.keys(DOCS) as DocId[]).map((d) => {
              const Icon = DOCS[d].icon;
              return (
                <button key={d} className={`btn ${d === doc ? "btn-primary" : ""}`} onClick={() => setSp(d === "file" ? { doc: "file" } : {})}>
                  <Icon size={14} /> {DOCS[d].title}
                </button>
              );
            })}
          </>
        }
      />
      <div className="grid gap-3" style={{ gridTemplateColumns: "250px minmax(0, 1fr)" }}>
        <Panel noPad title="Contents">
          <div className="p-2">
            <div className="relative mb-2">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 muted" />
              <input className="input !pl-7" placeholder="Search the guide" value={q} onChange={(e) => setQ(e.target.value)} data-testid="help-search" />
            </div>
            <nav className="flex flex-col overflow-auto" style={{ maxHeight: "calc(100vh - 250px)" }}>
              {shown
                .filter((s) => s.level >= 2)
                .map((s) => (
                  <button
                    key={s.id + s.level}
                    className="text-left rounded px-2 py-1 text-[12.5px] hover:bg-[var(--hover)]"
                    style={{ paddingLeft: s.level === 3 ? 20 : 8, color: s.id === target ? "var(--accent-2)" : s.level === 3 ? "var(--text-2)" : undefined, fontWeight: s.level === 2 ? 500 : 400 }}
                    onClick={() => go(s.id)}
                  >
                    {s.title}
                  </button>
                ))}
              {shown.length === 0 && <div className="muted text-[12px] px-2">No section mentions “{q}”.</div>}
            </nav>
          </div>
        </Panel>
        <Panel noPad>
          <div ref={body} className="help-body overflow-auto px-6 py-4" style={{ maxHeight: "calc(100vh - 160px)" }} data-testid="help-body">
            {shown.map((s) => (
              <section key={s.id + s.level} dangerouslySetInnerHTML={{ __html: s.html }} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
