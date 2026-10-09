// Move and game sounds: recorded sets (Kenney, CC0, see public/sound/README.md) or the
// synthesised "classic" click, through one master volume.

export const SOUND_SETS = ["wood", "soft", "classic"] as const;
export type SoundSet = (typeof SOUND_SETS)[number];
export const SOUND_SET_LABEL: Record<SoundSet, string> = {
  wood: "Wood (recorded)",
  soft: "Soft",
  classic: "Classic (synthesised)",
};

export type SoundEvent = "move" | "capture" | "castle" | "check" | "promote" | "end" | "lowtime";

/** What a SAN move sounds like: castling, capture or a plain move, plus check and promotion. */
export function sanEvents(san?: string | null): SoundEvent[] {
  if (!san) return [];
  const ev: SoundEvent[] = [san.startsWith("O-O") ? "castle" : san.includes("x") ? "capture" : "move"];
  if (san.includes("=")) ev.push("promote");
  if (/[+#]/.test(san)) ev.push("check");
  return ev;
}

type GameEvent = "check" | "promote" | "end" | "lowtime";
const GAME_EVENTS: GameEvent[] = ["check", "promote", "end", "lowtime"];
/** Each set has its own game sounds, made from its move sounds (one material per set). */
const FILES: Record<Exclude<SoundSet, "classic">, { move: string[]; capture: string[] }> = {
  wood: { move: [0, 1, 2, 3, 4].map((i) => `wood/move${i}`), capture: [0, 1, 2, 3, 4].map((i) => `wood/capture${i}`) },
  soft: { move: ["soft/move0", "soft/move1"], capture: ["soft/capture0"] },
};
/** The classic game sounds: the synthesised click at other pitches (band-pass Hz, start s). */
const CLASSIC: Record<GameEvent, [number, number][]> = {
  check: [[2300, 0], [2700, 0.07]],
  promote: [[1700, 0], [2200, 0.07], [2800, 0.14]],
  end: [[700, 0], [560, 0.16]],
  lowtime: [[3400, 0], [2900, 0.18]],
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();
let lastMove: { src: AudioScheduledSourceNode; gain: GainNode } | null = null;
let lastMoveAt = 0;

function audio(volume: number): { ctx: AudioContext; out: GainNode } | null {
  try {
    ctx ??= new AudioContext();
    if (!master) {
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    master.gain.value = Math.max(0, Math.min(1, volume));
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return { ctx, out: master };
  } catch {
    return null; // audio unavailable
  }
}

function load(name: string): Promise<AudioBuffer | null> {
  const have = buffers.get(name);
  if (have) return Promise.resolve(have);
  let p = loading.get(name);
  if (!p) {
    p = fetch(`/sound/${name}.wav`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
      .then((b) => ctx!.decodeAudioData(b))
      .then((buf) => {
        buffers.set(name, buf);
        return buf;
      })
      .catch(() => null);
    loading.set(name, p);
  }
  return p;
}

/** Decodes the files of a set ahead of time, so the first move is not silent or late. */
export function preloadSounds(set: SoundSet) {
  if (!audio(1)) return;
  if (set === "classic") return;
  for (const n of [...FILES[set].move, ...FILES[set].capture, ...GAME_EVENTS.map((e) => `${set}/${e}`)]) load(n);
}

function playBuffer(name: string, at = 0, level = 1, volume = 1, isMove = false) {
  const a = audio(volume);
  if (!a) return;
  load(name).then((buf) => {
    if (!buf) return;
    const src = a.ctx.createBufferSource();
    src.buffer = buf;
    const g = a.ctx.createGain();
    g.gain.value = level;
    src.connect(g).connect(a.out);
    const t = a.ctx.currentTime + at;
    if (isMove) cutPrevious(t);
    src.start(t);
    if (isMove) lastMove = { src, gain: g };
  });
}

/** A quick fade of the previous move sound, so fast moves never pile up or click. */
function cutPrevious(t: number) {
  if (!lastMove || !ctx) return;
  const { src, gain } = lastMove;
  try {
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.012);
    src.stop(t + 0.015);
  } catch {
    /* already stopped */
  }
  lastMove = null;
}

/** The synthesised click of the classic set: a short wooden "tock" (noise through a band-pass). */
function synth(capture: boolean, at: number, volume: number, freq = capture ? 900 : 1500, level = capture ? 0.9 : 0.6, isMove = true) {
  const a = audio(volume);
  if (!a) return;
  const t = a.ctx.currentTime + at;
  const len = 0.09;
  const buf = a.ctx.createBuffer(1, Math.floor(a.ctx.sampleRate * len), a.ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 5);
  const src = a.ctx.createBufferSource();
  src.buffer = buf;
  const bp = a.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = 3.5;
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(bp).connect(g).connect(a.out);
  if (isMove) cutPrevious(t);
  src.start(t);
  if (isMove) lastMove = { src, gain: g };
}

const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];

/** Plays a sound event with the chosen set and volume. */
export function playEvent(ev: SoundEvent, set: SoundSet, volume: number, at = 0) {
  if (volume <= 0) return;
  if (ev === "move" || ev === "capture" || ev === "castle") {
    const capture = ev === "capture";
    const one = (delay: number) => (set === "classic" ? synth(capture, delay, volume) : playBuffer(pick(FILES[set][capture ? "capture" : "move"]), delay, 1, volume, true));
    one(at);
    // castling: the king, then the rook
    if (ev === "castle") setTimeout(() => one(0), (at + 0.11) * 1000);
    return;
  }
  if (set === "classic") for (const [f, t] of CLASSIC[ev]) synth(false, at + t, volume, f, 0.55, false);
  else playBuffer(`${set}/${ev}`, at, 1, volume);
}

/** The sound of a SAN move. Moves closer than 35 ms (a fast replay) play only the last one. */
export function playSan(san: string | null | undefined, set: SoundSet, volume: number) {
  const now = performance.now();
  if (now - lastMoveAt < 35) return;
  lastMoveAt = now;
  // check and promotion follow the move itself
  const ev = sanEvents(san);
  for (const e of ev) playEvent(e, set, volume, e === "promote" ? 0.08 : e === "check" ? (ev.includes("promote") ? 0.32 : 0.1) : 0);
}
