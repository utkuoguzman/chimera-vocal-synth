/**
 * Render a MusicXML piano part (both staves, chords, ties, repeats with 1st/2nd endings) with a
 * simple additive piano: decaying, slightly inharmonic partials, with higher partials and higher
 * notes dying faster.
 *
 *   bun tools/render-piano.ts <score.musicxml> <out.wav> [--bpm 110] [--t0 0.3]
 *
 * --t0: where beat 0 of the score falls in the output (s).
 */
import { readFileSync } from "node:fs";
import { writeWav } from "./lib/wav.ts";

const args = process.argv.slice(2);
const opt = (n: string, d: number) => {
  const i = args.indexOf(n);
  return i < 0 ? d : Number(args.splice(i, 2)[1]);
};
const bpm = opt("--bpm", 110), t0 = opt("--t0", 0.3);
const [inPath, outPath] = args;
const xml = readFileSync(inPath, "utf8");
const FS = 48000, BEAT = 60 / bpm;
const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const tag = (s: string, n: string) => s.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`))?.[1]?.trim() ?? null;

const part = xml.match(/<part id="P1">([\s\S]*?)<\/part>/)![1];
const measures = [...part.matchAll(/<measure ([^>]*)>([\s\S]*?)<\/measure>/g)].map((m) => m[2]);

// play order with repeats and endings written out
const order: number[] = [];
{
  let start = 0, i = 0, pass = 1, ending: string | null = null;
  while (i < measures.length) {
    const m = measures[i];
    if (/<repeat direction="forward"/.test(m) && pass === 1) start = i;
    const e = m.match(/<ending number="([^"]+)" type="start"/);
    if (e) ending = e[1];
    if (ending === null || ending.split(/[ ,]/).includes(String(pass))) order.push(i);
    if (/<repeat direction="backward"/.test(m) && pass === 1) {
      pass = 2;
      i = start;
      ending = null;
      continue;
    }
    if (/<ending number="[^"]+" type="(stop|discontinue)"/.test(m)) ending = null;
    i++;
  }
}

// notes in beats: [midi, start, length, staff]
type Ev = { midi: number; start: number; len: number; staff: string };
const evs: Ev[] = [];
let divisions = 1, beatsPerMeasure = 4, at = 0;
const open = new Map<string, Ev>(); // tied notes waiting for their continuation, by staff:midi
for (const k of order) {
  const m = measures[k];
  const d = tag(m, "divisions");
  if (d) divisions = Number(d);
  const b = tag(m, "beats"), bt = tag(m, "beat-type");
  if (b && bt) beatsPerMeasure = (Number(b) * 4) / Number(bt);
  let cur = 0, lastStart = 0;
  for (const e of m.matchAll(/<(note|backup|forward)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const [, kind, x] = e;
    const dur = Number(tag(x, "duration") ?? 0) / divisions;
    if (kind === "backup") { cur -= dur; continue; }
    if (kind === "forward") { cur += dur; continue; }
    if (/<grace/.test(x)) continue;
    const chord = /<chord\s*\/>/.test(x);
    const start = chord ? lastStart : cur;
    if (!chord) { lastStart = cur; cur += dur; }
    if (/<rest/.test(x)) continue;
    const p = tag(x, "pitch")!;
    const midi = 12 * (Number(tag(p, "octave")) + 1) + STEP[tag(p, "step")!] + Math.round(Number(tag(p, "alter") ?? 0));
    const staff = tag(x, "staff") ?? "1";
    const key = `${staff}:${midi}`;
    const tieStop = /<tie type="stop"/.test(x), tieStart = /<tie type="start"/.test(x);
    let ev = tieStop ? open.get(key) : undefined;
    if (ev) ev.len += dur;
    else evs.push((ev = { midi, start: at + start, len: dur, staff }));
    if (tieStart) open.set(key, ev);
    else open.delete(key);
  }
  at += beatsPerMeasure;
}

// --midi: write a standard MIDI file of the same notes instead (Acoustic Grand Piano, beat 0 at t0),
// for a soundfont synth such as FluidSynth
const midiIdx = args.indexOf("--midi");
if (midiIdx >= 0) {
  const TPQ = 480;
  const tick = (beats: number) => Math.round((beats + t0 / BEAT) * TPQ);
  const raw: { t: number; bytes: number[] }[] = [];
  for (const ev of evs) {
    const vel = ev.staff === "1" ? 84 : 64;
    raw.push({ t: tick(ev.start), bytes: [0x90, ev.midi, vel] });
    raw.push({ t: tick(ev.start + ev.len) - 1, bytes: [0x80, ev.midi, 0] });
  }
  raw.sort((a, b) => a.t - b.t || (a.bytes[0] === 0x80 ? -1 : 1));
  const vlq = (v: number) => {
    const out = [v & 0x7f];
    while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80);
    return out;
  };
  const usPerBeat = Math.round(BEAT * 1e6);
  const track: number[] = [0, 0xff, 0x51, 3, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255, 0, 0xc0, 0];
  let last = 0;
  for (const e of raw) {
    track.push(...vlq(Math.max(0, e.t - last)), ...e.bytes);
    last = Math.max(last, e.t);
  }
  track.push(...vlq(TPQ * 2), 0xff, 0x2f, 0);
  const len = track.length;
  const file = new Uint8Array([
    ...[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, TPQ >> 8, TPQ & 255],
    ...[0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255],
    ...track,
  ]);
  await Bun.write(args[midiIdx + 1], file);
  console.log(`${evs.length} notes → ${args[midiIdx + 1]}`);
  process.exit(0);
}

// synthesis
const totalBeats = at;
const n = Math.ceil((t0 + totalBeats * BEAT + 2) * FS);
const out = new Float32Array(n);
for (const ev of evs) {
  const f = 440 * 2 ** ((ev.midi - 69) / 12);
  const s0 = Math.round((t0 + ev.start * BEAT) * FS);
  const dur = ev.len * BEAT;
  const len = Math.round((dur + 0.8) * FS);
  const amp = (ev.staff === "1" ? 0.22 : 0.16) * Math.min(1, (f / 110) ** -0.15);
  const pitchDecay = Math.sqrt(f / 262);
  for (let k = 1; k <= 12; k++) {
    const fk = k * f * Math.sqrt(1 + 0.0004 * k * k);
    if (fk > 9000) break;
    const ak = amp / k ** 1.6 * (k === 2 ? 1.3 : 1);
    const decay = (0.7 + 0.5 * k) * pitchDecay; // per second
    const w = (2 * Math.PI * fk) / FS;
    const phase = Math.random() * 2 * Math.PI;
    for (let i = 0; i < len && s0 + i < n; i++) {
      const t = i / FS;
      let env = Math.exp(-decay * t) * Math.min(1, t / 0.004);
      if (t > dur) env *= Math.exp(-(t - dur) / 0.1); // damper
      if (env < 1e-5 && t > 0.01) break;
      out[s0 + i] += ak * env * Math.sin(w * i + phase);
    }
  }
}
let peak = 0;
for (const v of out) peak = Math.max(peak, Math.abs(v));
for (let i = 0; i < n; i++) out[i] *= 0.5 / peak;
writeWav(outPath, [out], FS);
console.log(`${evs.length} notes, ${order.length} measures (${totalBeats} beats) at ${bpm} bpm → ${outPath}, ${(n / FS).toFixed(2)} s`);
