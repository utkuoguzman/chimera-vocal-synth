/**
 * One part of a MusicXML score → the melody file `chimera render notes` sings:
 * `{"bpm", "lyrics", "notes": [[midi, beats], ...]}`.
 *
 *   bun tools/musicxml-to-notes.ts <score.mxl|score.musicxml> [part-id] [--bpm N] [--out part.json]
 *                                  [--spell ba=bah,...] [--lang en|tr]
 *
 * `--lang tr`: the lyrics are Turkish. The score's own syllables are kept, each turned into IPA
 * by rule (tools/lib/turkish-ipa.ts), and the output has `"ipa": true`.
 *
 * Without a part id it lists the parts. Needs the wasm build (`bun run wasm`).
 *
 * Notes: tied notes become one note; a chord sings its first note; grace and cue notes are
 * skipped; a sung note with no lyric holds the previous vowel (a melisma, `-`).
 *
 * Form: repeats and 1st/2nd endings are written out, and each pass through a repeat sings its
 * own lyric line (verse 2 on the second time) when the score has one. D.C., D.S., To Coda and
 * Fine stop the tool: write them out in the score. A part with two voices on one staff stops it
 * too: split them into parts.
 *
 * Lyrics: a score splits words into syllables its own way ("to-ge-ther"), and the dictionary
 * can't say a lone "ge". So each word is joined back up and syllabified by the engine's
 * dictionary, as `render notes` will. When the dictionary finds fewer syllables than the word's
 * notes, the last vowel holds over the rest (with a warning); when it finds more ("ba" is
 * "B.A."), the tool stops: respell the word with `--spell` ("ba=bah"). A melisma inside a word
 * moves to the word's end unless every piece is one syllable on its own (also warned).
 *
 * The tempo comes from the score's first `<sound tempo>` unless `--bpm` is given; later tempo
 * changes are ignored (warned). `.mxl` is unzipped with the system `unzip`.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { initChimera } from "../src/wasm/chimera.ts";
import { wordToIpa } from "./lib/turkish-ipa.ts";

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** the text of the first `<tag>` in `xml`, or null */
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
}

function has(xml: string, name: string): boolean {
  return new RegExp(`<${name}[\\s/>]`).test(xml);
}

function unescape(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** a start tag's attributes, whatever their order or quotes (`number="1" type="start"` or
 *  `type='start' number='1'`) */
function attrsOf(s: string): Record<string, string> {
  return Object.fromEntries([...s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((a) => [a[1], unescape(a[2] ?? a[3])]));
}

/** the attributes of each `<name …>` in `xml`, in document order */
function attrs(xml: string, name: string): Record<string, string>[] {
  return [...xml.matchAll(new RegExp(`<${name}(\\s[^>]*)?>`, "g"))].map((m) => attrsOf(m[1] ?? ""));
}

/** one file out of a zip: `unzip -p`, or `tar -xOf` where there is no unzip (Windows 10+ ships bsdtar) */
function unzipMember(path: string, member: string) {
  for (const cmd of [["unzip", "-p", path, member], ["tar", "-xOf", path, member]]) {
    try {
      const p = Bun.spawnSync(cmd);
      if (p.exitCode === 0) return { exitCode: 0, stdout: p.stdout, stderr: p.stderr };
    } catch {
      // the tool isn't installed: try the next
    }
  }
  return { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`neither unzip nor tar could read ${member}`) };
}

async function readScore(path: string): Promise<string> {
  if (!path.endsWith(".mxl")) return Bun.file(path).text();
  // the container names the root score file
  const container = unzipMember(path, "META-INF/container.xml");
  if (container.exitCode !== 0) fail(`${path}: unzip failed: ${container.stderr.toString()}`);
  const root = container.stdout.toString().match(/full-path="([^"]+)"/)?.[1];
  if (!root) fail(`${path}: no rootfile in META-INF/container.xml`);
  const score = unzipMember(path, root);
  if (score.exitCode !== 0) fail(`${path}: unzip ${root} failed: ${score.stderr.toString()}`);
  return score.stdout.toString();
}

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined) fail(`${name} needs a value`);
  args.splice(i, 2);
  return v;
};
const bpmArg = opt("--bpm");
const outPath = opt("--out");
// --lang tr: Turkish lyrics, turned into IPA by rule; the output gets "ipa": true
const lang = opt("--lang") ?? "en";
if (lang !== "en" && lang !== "tr") fail(`--lang: "${lang}" is not en or tr`);
const spell = new Map(
  (opt("--spell") ?? "")
    .split(",")
    .filter(Boolean)
    .map((p) => {
      const [from, to] = p.split("=");
      if (!from || !to) fail(`--spell: "${p}" is not from=to`);
      return [from.toLowerCase(), to] as const;
    }),
);
const [path, partId] = args;
if (!path) fail("usage: bun tools/musicxml-to-notes.ts <score.mxl|score.musicxml> [part-id] [--bpm N] [--out part.json] [--spell ba=bah,...] [--lang en|tr]");

const xml = await readScore(path);
const parts = [...xml.matchAll(/<score-part(\s[^>]*)?>([\s\S]*?)<\/score-part>/g)].map((m) => ({ id: attrsOf(m[1] ?? "").id, name: unescape(tag(m[2], "part-name") ?? "") }));

if (!partId) {
  for (const p of parts) console.log(`${p.id}\t${p.name}`);
  process.exit(0);
}

const body = [...xml.matchAll(/<part(\s[^>]*)?>([\s\S]*?)<\/part>/g)].find((m) => attrsOf(m[1] ?? "").id === partId)?.[2];
if (!body) fail(`no part ${partId}; the parts are: ${parts.map((p) => `${p.id} (${p.name})`).join(", ")}`);

const tempos = attrs(xml, "sound").flatMap((a) => (a.tempo ? [a.tempo] : []));
const bpm = Number(bpmArg ?? tempos[0] ?? fail("the score has no tempo: give --bpm"));
if (!(bpm > 0)) fail(`bad bpm: ${bpmArg ?? tempos[0]}`);
if (new Set(tempos).size > 1) console.error(`warning: the score changes tempo (${tempos.join(", ")}); all of it is sung at ${bpm} bpm`);

const notes: [number, number][] = [];
/** one per sounding note: a lyric syllable or a melisma */
type Sung = { text: string; syllabic: string; measure: string } | { melisma: true; measure: string };
const sung: Sung[] = [];
let divisions = 0;
let tieOpen = false;

const measures = [...body.matchAll(/<measure(\s[^>]*)?>([\s\S]*?)<\/measure>/g)].map((m) => ({ number: attrsOf(m[1] ?? "").number ?? "?", xml: m[2] }));
const jump = measures.find((m) => attrs(m.xml, "sound").some((a) => "dacapo" in a || "dalsegno" in a || "tocoda" in a || "fine" in a));
if (jump) fail(`measure ${jump.number}: D.C., D.S., To Coda and Fine jumps are not supported; write the jumps out in the score`);

// Play order: repeats (`<repeat direction=... times=...>`) and voltas (`<ending number="1, 2">`)
// written out. `pass` is which time through the current repeat (1, 2, ...).
const order: { number: string; xml: string; pass: number }[] = [];
{
  let start = 0;
  let pass = 1;
  let jumped = false;
  let ending: number[] | null = null; // the volta the walk is in, and its passes
  for (let i = 0; i < measures.length; ) {
    const m = measures[i];
    const repeats = attrs(m.xml, "repeat");
    const endings = attrs(m.xml, "ending");
    if (repeats.some((r) => r.direction === "forward") && !jumped) {
      start = i;
      pass = 1;
    }
    jumped = false;
    const begins = endings.find((e) => e.type === "start");
    if (begins) ending = (begins.number ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
    const play = !ending || ending.includes(pass);
    if (endings.some((e) => e.type === "stop" || e.type === "discontinue")) ending = null;
    if (!play) {
      i++;
      continue;
    }
    order.push({ ...m, pass });
    const back = repeats.find((r) => r.direction === "backward");
    if (back && pass < Number(back.times ?? 2)) {
      pass++;
      i = start;
      jumped = true;
      ending = null;
      continue;
    }
    if (back) {
      start = i + 1;
      pass = 1;
    }
    i++;
  }
}
const verses = new Set(attrs(body, "lyric").flatMap((a) => (a.number ? [a.number] : [])));
const passes = Math.max(...order.map((m) => m.pass));
if (verses.size > passes) console.error(`warning: the part has ${verses.size} lyric lines (${[...verses].join(", ")}) but is sung ${passes} time(s); each pass sings its own line, the rest are unused`);

for (const { number: measure, xml: mxml, pass } of order) {
  // <attributes>, <note>, <backup> and <forward> in document order
  for (const e of mxml.matchAll(/<(attributes|note|backup|forward)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const [, kind, x] = e;
    if (kind === "attributes") {
      const d = tag(x, "divisions");
      if (d) divisions = Number(d);
      continue;
    }
    if (kind !== "note") fail(`measure ${measure}: <${kind}> (more than one voice in a part) is not supported`);
    if (has(x, "chord") || has(x, "grace") || has(x, "cue")) continue;
    if (!divisions) fail("a note before <divisions>");
    const beats = Number(tag(x, "duration")) / divisions;
    if (has(x, "rest")) {
      const last = notes[notes.length - 1];
      if (last && last[0] <= 0) last[1] += beats;
      else notes.push([0, beats]);
      tieOpen = false;
      continue;
    }
    const pitch = tag(x, "pitch") ?? fail(`measure ${measure}: a note with no pitch (unpitched parts are not supported)`);
    const midi = 12 * (Number(tag(pitch, "octave")) + 1) + STEP[tag(pitch, "step") ?? ""] + Math.round(Number(tag(pitch, "alter") ?? 0));
    const ties = new Set(attrs(x, "tie").map((t) => t.type));
    if (tieOpen && ties.has("stop")) {
      notes[notes.length - 1][1] += beats;
      tieOpen = ties.has("start");
      continue;
    }
    tieOpen = ties.has("start");
    notes.push([midi, beats]);
    // each pass through a repeat sings its own verse line when the score has one. A note with no
    // lyric for this pass sings an earlier line's (a note sung once, after the repeat or in an
    // ending, often carries only line 1), but never a later line's: a later verse's syllable on a
    // note where this verse holds its vowel is a melisma here.
    const lyrics = [...x.matchAll(/<lyric(\s[^>]*)?>([\s\S]*?)<\/lyric>/g)];
    const num = (l: RegExpMatchArray) => Number(attrsOf(l[1] ?? "").number ?? "1");
    const own = lyrics.find((l) => num(l) === pass);
    const earlier = lyrics.find((l) => num(l) < pass);
    const lyric = (own ?? earlier ?? (verses.has(String(pass)) ? undefined : lyrics[0]))?.[2] ?? null;
    if (lyric === null) {
      if (!sung.length) fail(`measure ${measure}: the first sung note has no lyric, so there is no vowel to hold`);
      sung.push({ melisma: true, measure });
      continue;
    }
    // a lyric's text may be split around <elision>; join the pieces
    const text = unescape([...lyric.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((t) => t[1]).join(""));
    sung.push({ text, syllabic: tag(lyric, "syllabic") ?? "single", measure });
  }
}

// words: their pieces (score syllables) and the melisma notes after each piece
type Word = { pieces: string[]; holds: number[]; measure: string };
const words: Word[] = [];
let open: Word | null = null;
for (const s of sung) {
  if ("melisma" in s) {
    const w = open ?? words[words.length - 1];
    w.holds[w.holds.length - 1]++;
    continue;
  }
  if (!open || s.syllabic === "single" || s.syllabic === "begin") {
    open = { pieces: [], holds: [], measure: s.measure };
    words.push(open);
  }
  open.pieces.push(s.text);
  open.holds.push(0);
  if (s.syllabic === "single" || s.syllabic === "end") open = null;
}

// The engine's dictionary, as `render notes` uses it. engine.ts calls the wasm when it loads,
// so it is imported only after initChimera.
await initChimera(readFileSync(new URL("../src/wasm/chimera.wasm", import.meta.url)));
const { EnglishG2P, lyricsToSyllables, ipaLyricsToSyllables } = await import("../src/wasm/engine.ts");
new EnglishG2P().setDictionaryText(gunzipSync(readFileSync(new URL("../public/data/cmudict.txt.gz", import.meta.url))).toString());
const count = (w: string) => lyricsToSyllables(w).length;

const tokens: string[] = [];
// messages grouped by word: "word: what" → measures
const errors = new Map<string, string[]>();
const warnings = new Map<string, string[]>();
const note = (to: Map<string, string[]>, key: string, measure: string) => to.set(key, [...(to.get(key) ?? []), measure]);
if (lang === "tr") {
  // Turkish: the score's syllables are kept, each turned into IPA by rule (tools/lib/turkish-ipa.ts)
  for (const w of words) {
    const ipa = wordToIpa(w.pieces);
    const bad = ipa.filter((p) => ipaLyricsToSyllables(p).length !== 1);
    if (bad.length) {
      note(errors, `"${w.pieces.join("-")}" → ${ipa.join("-")}: each score syllable needs exactly one vowel`, w.measure);
      continue;
    }
    if (w.holds.slice(0, -1).some((h) => h > 0)) {
      // a melisma inside the word: its syllables are sung as words, each hold where it is
      ipa.forEach((p, i) => tokens.push(` ${p}`, ...Array.from({ length: w.holds[i] }, () => " -")));
    } else {
      tokens.push(` ${ipa.join("-")}`, ...Array.from({ length: w.holds[w.holds.length - 1] }, () => " -"));
    }
  }
}
for (const w of lang === "tr" ? [] : words) {
  const joined = w.pieces.join("").replace(/’/g, "'").replace(/[^A-Za-z']/g, "");
  if (!joined) fail(`measure ${w.measure}: the lyric "${w.pieces.join("-")}" has no letters`);
  const word = spell.get(joined.toLowerCase()) ?? joined;
  const k = w.pieces.length;
  const n = count(word);
  const inner = w.holds.slice(0, -1).some((h) => h > 0);
  if (n > k || n === 0) {
    // one entry per word whatever its case: --spell matches without case too
    note(errors, `"${word.toLowerCase()}": ${n} syllable(s) on ${k} note(s)`, w.measure);
    continue;
  }
  if (inner && n === k && w.pieces.every((p) => count(spell.get(p.toLowerCase()) ?? p) === 1)) {
    // each piece says itself: sing the pieces as words, each melisma where it is (a melisma
    // mark needs spaces round it, so a typed hyphen can't join the pieces across it)
    w.pieces.forEach((p, i) => tokens.push(` ${spell.get(p.toLowerCase()) ?? p}`, ...Array.from({ length: w.holds[i] }, () => " -")));
    continue;
  }
  if (inner) note(warnings, `"${word.toLowerCase()}" is held at its end, not between its syllables`, w.measure);
  if (n < k) note(warnings, `"${word.toLowerCase()}" has ${n} syllable(s) on ${k} notes: its last vowel holds over the rest`, w.measure);
  const holds = w.holds.reduce((a, b) => a + b, 0) + (k - n);
  tokens.push(` ${word}`, ...Array.from({ length: holds }, () => " -"));
}
const list = (m: Map<string, string[]>) => [...m].map(([k, ms]) => `  ${k} (measure ${[...new Set(ms)].join(", ")})`).join("\n");
if (warnings.size) console.error(`${partId} warnings:\n${list(warnings)}`);
if (errors.size) fail(`${partId}: the dictionary can't fit these words to their notes; respell them with --spell word=respelling:\n${list(errors)}`);

const lyrics = tokens.join("").trim();
const out = JSON.stringify(lang === "tr" ? { bpm, ipa: true, lyrics, notes } : { bpm, lyrics, notes });
if (outPath) await Bun.write(outPath, out + "\n");
else console.log(out);
const sounding = notes.filter((n) => n[0] > 0).length;
console.error(`${partId}: ${sounding} sung notes, ${notes.reduce((s, n) => s + n[1], 0)} beats at ${bpm} bpm`);
