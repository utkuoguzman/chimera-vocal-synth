# Voice_Synthesis — Chimera sings İstiklal Marşı

This repository is a fork of **[Chimera](https://github.com/jamesondh/chimera-vocal-synth)** by
**Jameson Hodge**, a physically modelled vocal synthesizer written in Rust and compiled to
WebAssembly, with a browser app that shows a 3D head singing. All the credit for the synthesizer
itself goes to the original author. The original README is kept unchanged as
[README.upstream.md](README.upstream.md), and the original [MIT license](LICENSE) still applies.

My changes teach Chimera to sing in **Turkish**. With them it sings the Turkish national anthem,
**İstiklal Marşı**: two voices (male and female) with a piano accompaniment, shown as two singing
heads, one above the other, in the browser.

## What I changed

The original Chimera sings English lyrics through an English pronouncing dictionary, so Turkish
words came out mispronounced. These are the changes I made:

### Turkish singing
- **IPA lyrics in the engine.** A melody file with `"ipa": true` gives its lyrics as IPA
  (`"koɾk-ma søn-mez"`) instead of going through the English dictionary. This is in the Rust
  engine (`ipa_lyrics_to_syllables`), the `render notes` command, and the WebAssembly API. Every
  Turkish sound (y, ø, ɯ, ɾ, ɫ, c, ɟ, ʒ, tʃ, dʒ) was already in the engine's sound set.
- **Turkish → IPA converter** ([`tools/lib/turkish-ipa.ts`](tools/lib/turkish-ipa.ts),
  [`tools/turkish-ipa.ts`](tools/turkish-ipa.ts)). It works by rule and
  handles ı ö ü ş ç c j y r, the front/back forms of k, g and l, ğ, the circumflex (hilâl,
  istiklâl), and n before k/g. It also splits words into syllables and can merge the lyrics
  into a melody file.
- **`--lang tr` in the MusicXML converter** ([`tools/musicxml-to-notes.ts`](tools/musicxml-to-notes.ts)):
  it keeps the score's own Turkish syllables and turns each one into IPA.
- **Verse handling fix.** On a repeat, a note that holds its vowel in the current verse no
  longer borrows a syllable from a later verse.

### The İstiklal Marşı show
- **One-command build** ([`tools/build-istiklal.ts`](tools/build-istiklal.ts)): score →
  notes → IPA lyrics → two rendered voices (female at written pitch, male an octave lower)
  → piano → mix → a show the browser plays.
- **Piano accompaniment** ([`tools/render-piano.ts`](tools/render-piano.ts)):
  turns the piano arrangement into MIDI, which [FluidSynth](https://www.fluidsynth.org/) plays
  with the GeneralUser GS soundfont. Run on its own without `--midi`, the script instead renders
  a simple built-in piano sound, which needs no soundfont.
- **Vertical layout for the duet page** ([`DuetPage.tsx`](src/ui/components/DuetPage.tsx),
  [`styles.css`](src/ui/styles.css)): the male head on top and the female head
  below, each exactly half of the browser window. This suits a vertical monitor. The title and
  the play bar sit on top of the heads, and the play bar fades out while the song plays. An
  optional `aspect` setting gives a fixed portrait frame instead, such as 4:5 for an Instagram
  post. The page also shows the IPA syllables at each mouth.

### Windows fixes
- `.mxl` scores open with Windows' built-in `tar` when `unzip` isn't installed.
- Test paths work on Windows drive letters (`D:\...`).

## Run it (Windows)

You need [Rust](https://rustup.rs) with the WebAssembly target, and [Bun](https://bun.sh):

```powershell
winget install Rustlang.Rustup
winget install Oven-sh.Bun
rustup default stable
rustup target add wasm32-unknown-unknown
```

Clone with Unix line endings. Otherwise one of the engine's calibration tests fails, because Git on
Windows converts line endings by default:

```powershell
git -c core.autocrlf=false clone https://github.com/utkuoguzman/Voice_Synthesis.git
cd Voice_Synthesis
bun install
bun run wasm
```

Build the anthem show, then start the app:

```powershell
bun tools/build-istiklal.ts
bun run dev
```

Open **http://127.0.0.1:5317/?show=istiklal** and click **Play**. For the full vertical-monitor
view, press F11 for full screen.

The rendered show (`public/shows/istiklal/`) isn't stored in the repository, because the
original project ignores that folder. Run `bun tools/build-istiklal.ts` again whenever you need
it.

## Files

| Path | What it is |
|---|---|
| `music/sf15-istiklal-marsimusicxml-erdemtemelcom.mxl` | Melody with both stanzas as lyrics (110 bpm) |
| `music/istiklal-lyrics.txt` | The lyrics as whole words, with holds (`-`) and breaths (`,`) |
| `music/istiklal-piano.musicxml` | Piano arrangement, used for the accompaniment |
| `music/istiklal-piano.mid` | The piano part as MIDI (made by the build) |
| `fluidsynth/` | Portable FluidSynth 2.6.2 for Windows and the GeneralUser GS soundfont |
| `tools/build-istiklal.ts` | Builds the whole show |

## Adjusting it

- **Breaths:** move the commas in `music/istiklal-lyrics.txt`, then rebuild. Each comma is a
  breath.
- **Piano volume:** change `PIANO_GAIN` in `tools/build-istiklal.ts`.
- **Layout:** in `public/shows/istiklal/show.json`, add `"aspect": 0.8` (4:5) or `0.5625`
  (9:16) for a fixed portrait frame. To go back to side by side, add `&layout=horizontal` to
  the address.

## Limits

- The Turkish → IPA conversion works by rule. Loanwords written without a circumflex can get the
  wrong l sound.
- Turkish lyrics work from the command line and on the duet page. The app's interactive Sing
  piano roll still only reads English.
- The syllables shown at the mouths are in IPA, not Turkish spelling.

## Credits and licenses

- **Chimera** © 2026 Jameson Hodge, [MIT License](LICENSE).
  Original repository: https://github.com/jamesondh/chimera-vocal-synth. Bundled third-party
  files in the original project keep their own licenses (see [README.upstream.md](README.upstream.md)).
- **FluidSynth** (https://www.fluidsynth.org/) is licensed under the LGPL-2.1. The unmodified
  Windows release is included in `fluidsynth/`.
- **GeneralUser GS** soundfont by S. Christian Collins
  (https://github.com/mrbumpy409/GeneralUser-GS), distributed under its own license.
- **İstiklal Marşı**: lyrics by Mehmet Âkif Ersoy, music by Osman Zeki Üngör. The melody score
  with lyrics is from erdemtemel.com. The piano arrangement is a community MusicXML score.

My changes to the code are shared under the same MIT License as the original project.
