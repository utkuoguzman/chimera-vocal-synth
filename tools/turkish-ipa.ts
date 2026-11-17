/**
 * Turkish lyrics → IPA lyrics for `chimera render notes` (with `"ipa": true`).
 *
 *   bun tools/turkish-ipa.ts "Korkma, sönmez bu şafaklarda yüzen al sancak"
 *   bun tools/turkish-ipa.ts --file lyrics.txt
 *   bun tools/turkish-ipa.ts --notes melody.json --file lyrics.txt --out song.json
 *
 * Prints syllables joined by `-` and words by spaces: "koɾk-ma, søn-mez bu ʃa-fak-ɫaɾ-da …".
 * With `--notes`, the IPA lyrics go into that melody file (`{"bpm", "notes", …}`), which gets
 * `"ipa": true`, and the syllables are counted against its sung notes. Hold a vowel over extra
 * notes by writing a lone `-` in the Turkish text ("al - sancak").
 */
import { readFileSync } from "node:fs";
import { textToIpaLyrics } from "./lib/turkish-ipa.ts";

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const file = opt("--file");
const notesPath = opt("--notes");
const outPath = opt("--out");
const text = file ? readFileSync(file, "utf8") : args.join(" ");
if (!text.trim()) {
  console.error('usage: bun tools/turkish-ipa.ts "<turkish text>" | --file lyrics.txt [--notes melody.json] [--out song.json]');
  process.exit(1);
}
const lyrics = textToIpaLyrics(text.replace(/\r/g, "")).trim();

if (!notesPath) {
  console.log(lyrics);
} else {
  const song = JSON.parse(readFileSync(notesPath, "utf8"));
  const sung = (song.notes as [number, number][]).filter((n) => n[0] > 0).length;
  // one syllable per sung note: hyphens split syllables, a lone - or ~ is a held note
  const syllables = lyrics.split(/[\s,;:!?]+/).filter(Boolean).reduce((s, w) => s + (w === "-" || w === "~" ? 1 : w.split("-").length), 0);
  if (syllables !== sung) console.error(`warning: ${syllables} syllables for ${sung} sung notes; add a lone "-" in the text where a vowel holds over several notes`);
  const out = JSON.stringify({ ...song, ipa: true, lyrics }, null, 1);
  if (outPath) await Bun.write(outPath, out + "\n");
  else console.log(out);
}
