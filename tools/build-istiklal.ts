/**
 * Build the İstiklal Marşı duet show from the files in `music/`, end to end:
 *
 *   bun tools/build-istiklal.ts
 *
 *   music/sf15-istiklal-marsimusicxml-erdemtemelcom.mxl  melody + lyrics  → notes (110 bpm)
 *   music/istiklal-lyrics.txt                           Turkish lyrics   → IPA syllables
 *   music/istiklal-piano.musicxml                       piano part       → MIDI → FluidSynth
 *   fluidsynth/…/bin/fluidsynth.exe + fluidsynth/GeneralUser-GS.sf2
 *
 * Writes public/shows/istiklal/ (male an octave down on top, female below, piano under both), then
 * open http://127.0.0.1:5317/?show=istiklal with `bun run dev` running. Needs the wasm build
 * (`bun run wasm`) and builds the CLI with cargo if it has to.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readWav, writeWav } from "./lib/wav.ts";

const ROOT = resolve(import.meta.dir, "..");
const MUSIC = join(ROOT, "music");
const SHOW = join(ROOT, "public", "shows", "istiklal");
const OUT = join(ROOT, "out");
const BPM = 110;
const T0 = 0.3; // where the piano's beat 0 falls (s)
const INTRO_BEATS = 7; // the voices' pickup falls on the piano's 8th beat (bar 2, beat 4)
const PIANO_GAIN = 2.5; // FluidSynth's output (rms ~0.03) sits ~8 dB under the voices

// FluidSynth: the first fluidsynth-*/bin/fluidsynth.exe (or bin/fluidsynth) under fluidsynth/
const FS_DIR = join(ROOT, "fluidsynth");
const fsBuild = existsSync(FS_DIR) ? readdirSync(FS_DIR).find((d) => d.startsWith("fluidsynth-")) : undefined;
const FLUIDSYNTH = fsBuild ? [join(FS_DIR, fsBuild, "bin", "fluidsynth.exe"), join(FS_DIR, fsBuild, "bin", "fluidsynth")].find(existsSync) : undefined;
const SOUNDFONT = join(FS_DIR, "GeneralUser-GS.sf2");

function run(cmd: string[], what: string) {
  console.log(`\n> ${what}`);
  const p = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) {
    console.error(`failed (${p.exitCode}): ${cmd.join(" ")}`);
    process.exit(1);
  }
}

for (const f of ["sf15-istiklal-marsimusicxml-erdemtemelcom.mxl", "istiklal-lyrics.txt", "istiklal-piano.musicxml"]) {
  if (!existsSync(join(MUSIC, f))) throw new Error(`missing music/${f}`);
}
if (!FLUIDSYNTH) throw new Error("no fluidsynth-*/bin/fluidsynth.exe under fluidsynth/");
if (!existsSync(SOUNDFONT)) throw new Error("missing fluidsynth/GeneralUser-GS.sf2");
mkdirSync(SHOW, { recursive: true });
mkdirSync(OUT, { recursive: true });

// 1. melody and IPA lyrics
const score = join(OUT, "istiklal-score.json");
run(["bun", "tools/musicxml-to-notes.ts", join(MUSIC, "sf15-istiklal-marsimusicxml-erdemtemelcom.mxl"), "P1", "--lang", "tr", "--out", score], "melody from the score");
const sung = join(OUT, "istiklal.json");
run(["bun", "tools/turkish-ipa.ts", "--notes", score, "--file", join(MUSIC, "istiklal-lyrics.txt"), "--out", sung], "Turkish lyrics → IPA");

// 2. the two voices' melody files: female as written, male an octave down; both enter after the
//    piano's intro
const song = JSON.parse(await Bun.file(sung).text());
const t0 = T0 + (INTRO_BEATS * 60) / BPM;
await Bun.write(join(SHOW, "female.json"), JSON.stringify({ ...song, t0 }));
await Bun.write(join(SHOW, "male.json"), JSON.stringify({ ...song, t0, notes: song.notes.map(([m, b]: [number, number]) => [m > 0 ? m - 12 : m, b]) }));

// 3. sing them, recording the telemetry the heads replay
for (const v of ["male", "female"]) {
  const base = join(SHOW, v);
  run(["cargo", "run", "--release", "-q", "-p", "chimera-cli", "--", "render", "notes", `${base}.json`, base, v, "--tele", `${base}.tele`], `render ${v} voice`);
}

// 4. the piano: MIDI, then FluidSynth
const mid = join(MUSIC, "istiklal-piano.mid");
run(["bun", "tools/render-piano.ts", join(MUSIC, "istiklal-piano.musicxml"), join(OUT, "piano-unused.wav"), "--bpm", String(BPM), "--t0", String(T0), "--midi", mid], "piano part → MIDI");
run([FLUIDSYNTH, "-ni", "-q", "-g", "0.5", "-r", "48000", "-F", join(SHOW, "piano.wav"), SOUNDFONT, mid], "FluidSynth piano");

// 5. mix and the show file
const male = readWav(join(SHOW, "male.wav")).channels[0];
const female = readWav(join(SHOW, "female.wav")).channels[0];
const pw = readWav(join(SHOW, "piano.wav"));
if (pw.sampleRate !== 48000) throw new Error(`piano.wav is ${pw.sampleRate} Hz`);
const piano = pw.channels[0].map((_, i) => pw.channels.reduce((s, c) => s + c[i], 0) / pw.channels.length);
const n = Math.max(male.length, female.length, piano.length);
const mix = new Float32Array(n);
for (let i = 0; i < n; i++) mix[i] = 0.5 * ((male[i] ?? 0) + (female[i] ?? 0)) + PIANO_GAIN * (piano[i] ?? 0);
let peak = 0;
for (const v of mix) peak = Math.max(peak, Math.abs(v));
if (peak > 0.95) for (let i = 0; i < n; i++) mix[i] *= 0.95 / peak;
writeWav(join(SHOW, "mix.wav"), [mix], 48000);
await Bun.write(
  join(SHOW, "show.json"),
  JSON.stringify(
    {
      title: "İstiklal Marşı",
      audio: "mix.wav",
      bpm: BPM,
      downbeat: T0,
      layout: "vertical",
      voices: [
        { name: "Male (8vb)", tele: "male.tele", melody: "male.json" },
        { name: "Female", tele: "female.tele", melody: "female.json" },
      ],
    },
    null,
    1,
  ),
);
console.log(`\ndone: public/shows/istiklal (${(n / 48000).toFixed(1)} s) → http://127.0.0.1:5317/?show=istiklal`);
