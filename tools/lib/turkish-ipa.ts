/**
 * Turkish spelling → broad IPA in the engine's symbols, by rule (Turkish spelling is close to
 * phonemic). Used by `tools/turkish-ipa.ts` and `musicxml-to-notes.ts --lang tr`.
 *
 *   ı→ɯ ö→ø ü→y ş→ʃ ç→tʃ c→dʒ j→ʒ y→j r→ɾ, â î û → a i u
 *   k g → c ɟ next to a front vowel (e i ö ü, or before â: "kâr" → car), else k g
 *   l → l next to a front vowel or â, else ɫ (dark)
 *   n → ŋ before k g
 *   ğ: lengthens the vowel before it before a consonant or at the word's end ("dağ" → daː);
 *      between front vowels it is a glide j ("değil" → dejil); between back vowels it is silent
 *      ("dağı" → daɯ, two syllables)
 *
 * No stress marks: the singing planner stresses every sung vowel anyway. Loanword exceptions
 * (e.g. a light l in "lale", "rol") follow the general rule, so they come out dark.
 */

const FRONT = new Set(["e", "i", "ö", "ü", "î"]);
const VOWELS = new Set(["a", "e", "ı", "i", "o", "ö", "u", "ü", "â", "î", "û"]);
const LETTERS = /[a-zçğıöşüâîû]/;

const SIMPLE: Record<string, string> = {
  a: "a", e: "e", ı: "ɯ", i: "i", o: "o", ö: "ø", u: "u", ü: "y", â: "a", î: "i", û: "u",
  b: "b", c: "dʒ", ç: "tʃ", d: "d", f: "f", h: "h", j: "ʒ", m: "m", p: "p", r: "ɾ",
  s: "s", ş: "ʃ", t: "t", v: "v", y: "j", z: "z",
  // letters only found in loanwords and names
  q: "k", w: "v", x: "ks",
};

/** Turkish lower case: I → ı, İ → i */
export function trLower(s: string): string {
  return s.toLocaleLowerCase("tr");
}

/**
 * One word, given as its syllables (the pieces a score's lyrics split it into, or `syllabify`'s
 * output), → the IPA of each syllable. The letters' context crosses syllable boundaries, so
 * "ek-mek" gives ["ec", "mec"].
 */
export function wordToIpa(pieces: string[]): string[] {
  // the word's letters, each tagged with the piece it came from
  const letters: { ch: string; piece: number }[] = [];
  pieces.forEach((p, i) => {
    for (const ch of trLower(p)) if (LETTERS.test(ch)) letters.push({ ch, piece: i });
  });
  const out = pieces.map(() => "");
  const at = (i: number) => letters[i]?.ch;
  const isV = (i: number) => VOWELS.has(at(i) ?? "");
  // the vowel that colours a consonant: the next letter if it is a vowel, else the previous one
  const colour = (i: number): string | undefined => (isV(i + 1) ? at(i + 1) : isV(i - 1) ? at(i - 1) : undefined);
  for (let i = 0; i < letters.length; i++) {
    const { ch, piece } = letters[i];
    const next = at(i + 1);
    let ipa: string;
    if (ch === "k" || ch === "g") {
      const v = colour(i);
      const front = v !== undefined && (FRONT.has(v) || (v === "â" && next === "â"));
      ipa = ch === "k" ? (front ? "c" : "k") : front ? "ɟ" : "g";
    } else if (ch === "l") {
      // â on either side marks a light l in loanwords ("hilâl", "lâle")
      const v = colour(i);
      ipa = (v !== undefined && FRONT.has(v)) || next === "â" || at(i - 1) === "â" ? "l" : "ɫ";
    } else if (ch === "n") {
      ipa = next === "k" || next === "g" ? "ŋ" : "n";
    } else if (ch === "ğ") {
      if (!isV(i + 1)) ipa = "ː";
      else ipa = FRONT.has(at(i - 1) ?? "") && FRONT.has(next ?? "") ? "j" : "";
    } else {
      ipa = SIMPLE[ch] ?? "";
    }
    out[piece] += ipa;
  }
  return out;
}

/**
 * A written Turkish word → its syllables. Every syllable has one vowel; a single consonant
 * between vowels starts the next syllable ("ka-pı"), and of a cluster only the last consonant
 * does ("kork-ma", "türk-çe").
 */
export function syllabify(word: string): string[] {
  const w = [...trLower(word)].filter((c) => LETTERS.test(c));
  const vi = w.flatMap((c, i) => (VOWELS.has(c) ? [i] : []));
  if (vi.length <= 1) return [w.join("")];
  const cuts = [0];
  for (let k = 1; k < vi.length; k++) {
    const gap = vi[k] - vi[k - 1] - 1;
    cuts.push(gap === 0 ? vi[k] : vi[k] - 1);
  }
  cuts.push(w.length);
  return cuts.slice(0, -1).map((c, i) => w.slice(c, cuts[i + 1]).join(""));
}

/**
 * Turkish lyrics text → the engine's IPA lyrics: syllables joined by `-`, words by spaces,
 * phrase punctuation and line breaks kept, and a lone `-` or `~` (a melisma) passed through.
 */
export function textToIpaLyrics(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .split(/\s+/)
        .filter(Boolean)
        .map((tok) => {
          if (tok === "-" || tok === "~") return tok;
          const punct = tok.match(/[,;:!?.]+$/)?.[0].replace(/\./g, ",") ?? "";
          const word = tok.replace(/[^\p{L}'’]/gu, "");
          if (!word) return punct;
          return wordToIpa(syllabify(word)).filter(Boolean).join("-") + punct;
        })
        .join(" "),
    )
    .join("\n");
}
