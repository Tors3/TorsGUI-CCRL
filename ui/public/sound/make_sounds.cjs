// Renders the TorsGUI sound files from the Kenney CC0 packs (filter, trim, fade, normalise -> 16-bit mono WAV).
// Runs the WebAudio processing in Chromium through Playwright (ui/node_modules).
const { chromium } = require(require('path').join(__dirname, '..', '..', 'node_modules', 'playwright'));
const fs = require('fs'), path = require('path');
const [, , K, OUT] = process.argv;
const imp = (n) => `${K}/impact/Audio/${n}.ogg`, ui = (n) => `${K}/iface/Audio/${n}.ogg`;
// Each sound: layers of a source (pitch = playback rate, start time, gain) through a high-pass, an
// optional presence boost and a low-pass, cut to `len`, faded out and normalised to `peak`.
// The game sounds of a set are made from its own move sounds, so that a set sounds of one material.
const L = (src, rate = 1, at = 0, gain = 1) => ({ src, rate, at, gain });
const jobs = [];
const job = (out, layers, hp, pres, len, fade, peak, lp) => jobs.push({ out, layers, hp, pres, len, fade, peak, lp });
const W = (n) => imp(`impactWood_${n}`);
for (let i = 0; i < 5; i++) job(`wood/move${i}`, [L(W(`light_00${i}`))], 230, { f: 2300, g: 5 }, 0.14, 0.035, 0.62, 9000);
for (let i = 0; i < 5; i++) job(`wood/capture${i}`, [L(W(`medium_00${i}`))], 140, { f: 1900, g: 4 }, 0.2, 0.05, 0.8, 9000);
// check: two quick higher taps; promotion: three rising taps; end: two firm knocks; low time: a wooden tick-tock
job('wood/check', [L(W('light_002'), 1.5), L(W('light_000'), 1.8, 0.07, 0.8)], 400, { f: 2800, g: 4 }, 0.2, 0.05, 0.5, 10000);
job('wood/promote', [L(W('light_001'), 1.3), L(W('light_001'), 1.6, 0.07, 0.9), L(W('light_001'), 2, 0.14, 0.85)], 400, { f: 2800, g: 4 }, 0.3, 0.06, 0.48, 10000);
job('wood/end', [L(W('heavy_000')), L(W('heavy_003'), 1, 0.16, 0.8)], 90, { f: 1500, g: 3 }, 0.45, 0.1, 0.72, 9000);
job('wood/lowtime', [L(W('light_004'), 2.2), L(W('light_004'), 1.8, 0.18, 0.85)], 600, null, 0.3, 0.05, 0.4, 10000);
job('soft/move0', [L(ui('drop_002'))], 120, null, 0.2, 0.04, 0.55, 12000);
job('soft/move1', [L(ui('drop_003'))], 120, null, 0.2, 0.04, 0.55, 12000);
job('soft/capture0', [L(ui('drop_004'))], 100, null, 0.28, 0.06, 0.72, 12000);
job('soft/check', [L(ui('drop_002'), 1.5), L(ui('drop_002'), 1.8, 0.08, 0.8)], 200, null, 0.26, 0.05, 0.48, 12000);
job('soft/promote', [L(ui('drop_002'), 1.2), L(ui('drop_002'), 1.5, 0.08, 0.9), L(ui('drop_002'), 1.9, 0.16, 0.85)], 200, null, 0.34, 0.06, 0.46, 12000);
job('soft/end', [L(ui('drop_004'), 0.8), L(ui('drop_004'), 0.7, 0.18, 0.8)], 80, null, 0.5, 0.1, 0.68, 12000);
job('soft/lowtime', [L(ui('drop_003'), 2), L(ui('drop_003'), 1.7, 0.18, 0.85)], 300, null, 0.3, 0.05, 0.4, 12000);
function wav(f32, sr) {
  const b = Buffer.alloc(44 + f32.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + f32.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(f32.length * 2, 40);
  for (let i = 0; i < f32.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, f32[i])) * 32767), 44 + i * 2);
  return b;
}
(async () => {
  const br = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await br.newPage();
  for (const { out, layers, hp, pres, len, fade, peak, lp } of jobs) {
    const srcs = layers.map((l) => ({ ...l, b64: fs.readFileSync(l.src).toString('base64'), src: undefined }));
    const arr = await p.evaluate(async ({ srcs, hp, pres, len, fade, peak, lp }) => {
      const SR = 44100;
      const n = Math.round(len * SR);
      const ctx = new OfflineAudioContext(1, n, SR);
      const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp; h.Q.value = 0.7;
      const l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = lp; l.Q.value = 0.7;
      let node = h.connect(l);
      if (pres) { const q = ctx.createBiquadFilter(); q.type = 'peaking'; q.frequency.value = pres.f; q.gain.value = pres.g; q.Q.value = 1; node = node.connect(q); }
      node.connect(ctx.destination);
      for (const ly of srcs) {
        const bin = Uint8Array.from(atob(ly.b64), (c) => c.charCodeAt(0));
        const dec = await new OfflineAudioContext(1, SR, SR).decodeAudioData(bin.buffer);
        // start at the onset (first sample above 2 % of the peak), 2 ms before it
        const ch0 = dec.getChannelData(0); let pk = 0; for (const x of ch0) pk = Math.max(pk, Math.abs(x));
        const on = Math.max(0, ch0.findIndex((x) => Math.abs(x) > pk * 0.02) - Math.round(dec.sampleRate * 0.002));
        const s = ctx.createBufferSource(); s.buffer = dec; s.playbackRate.value = ly.rate;
        const g = ctx.createGain(); g.gain.value = ly.gain;
        s.connect(g).connect(h);
        s.start(ly.at, on / dec.sampleRate);
      }
      const r = (await ctx.startRendering()).getChannelData(0);
      let m = 0; for (const x of r) m = Math.max(m, Math.abs(x));
      const g = peak / (m || 1), fs = Math.round(fade * SR), fi = Math.round(0.001 * SR);
      const o = new Array(n);
      for (let i = 0; i < n; i++) { let e = 1; if (i < fi) e = i / fi; if (i > n - fs) e = Math.pow((n - i) / fs, 2); o[i] = r[i] * g * e; }
      return o;
    }, { srcs, hp, pres, len, fade, peak, lp });
    const f = path.join(OUT, out + '.wav'); fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, wav(Float32Array.from(arr), 44100));
    console.log(out, (fs.statSync(f).size / 1024).toFixed(1) + ' KB');
  }
  await br.close();
})();
