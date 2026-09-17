import fs from "node:fs";

const [htmlPath, sourcePath, dictionaryPath] = process.argv.slice(2);
if (!htmlPath || !sourcePath || !dictionaryPath) {
  throw new Error("Usage: node merge-vocabulary.mjs <index.html> <source.html> <jmdict.json>");
}

const html = fs.readFileSync(htmlPath, "utf8");
const source = fs.readFileSync(sourcePath, "utf8");
const dict = JSON.parse(fs.readFileSync(dictionaryPath, "utf8"));
const setsMatch = html.match(/const sets = (\[[\s\S]*?\]);\r?\nconst allWords = sets\.flat\(\)/);
if (!setsMatch) throw new Error("Data kosakata web tidak ditemukan.");
const currentSets = JSON.parse(setsMatch[1]);
const current = currentSets.flat();

const decode = value => value
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const kataToHira = value => value.normalize("NFKC").replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const norm = value => kataToHira(String(value || "")).replace(/[\s・･,，、/／]/g, "").toLowerCase();
const basePair = (k, h) => {
  const nk = norm(k).replace(/する$/, "");
  const nh = norm(h).replace(/する$/, "");
  return `${nk}|${nh}`;
};
const pair = (k, h) => `${norm(k)}|${norm(h)}`;

const rows = [];
const rowRx = /<tr[^>]*data-category="([^"]*)"[^>]*>\s*<td[^>]*>\d+<\/td>\s*<td[^>]*class="jp"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="kana"[^>]*>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/g;
let match;
while ((match = rowRx.exec(source))) {
  rows.push({ category: decode(match[1]), k: decode(match[2]), h: decode(match[3]), m: decode(match[4]) });
}

const dictionaryBySpelling = new Map();
for (const entry of dict.words) {
  // Indeks kedua bentuknya: entri yang memiliki kanji tetap dapat ditemukan
  // ketika daftar sumber menuliskan katanya hanya dengan kana.
  const spellings = [...entry.kanji.map(item => item.text), ...entry.kana.map(item => item.text)];
  for (const spelling of spellings) {
    const key = norm(spelling);
    if (!dictionaryBySpelling.has(key)) dictionaryBySpelling.set(key, []);
    dictionaryBySpelling.get(key).push(entry);
  }
}

function validReadings(entry, spelling) {
  return entry.kana.filter(kana => kana.appliesToKanji.includes("*") || kana.appliesToKanji.includes(spelling));
}

function validateRow(row) {
  const rawReadings = row.h.split(/[\/／,，、]/).map(value => value.trim()).filter(Boolean);
  const candidates = dictionaryBySpelling.get(norm(row.k)) || [];
  for (const entry of candidates) {
    const valid = validReadings(entry, row.k);
    const exact = valid.find(item => rawReadings.some(reading => norm(reading) === norm(item.text)));
    if (exact) return { ...row, h: kataToHira(exact.text), corrected: false };
  }

  // Banyak daftar menulis verba suru sebagai satu kata, sedangkan JMdict menyimpan nomina + する.
  if (norm(row.k).endsWith("する") && rawReadings.some(reading => norm(reading).endsWith("する"))) {
    const stemK = row.k.replace(/する$/, "");
    const stemEntries = dictionaryBySpelling.get(norm(stemK)) || [];
    for (const entry of stemEntries) {
      const valid = validReadings(entry, stemK);
      const exact = valid.find(item => rawReadings.some(reading => norm(reading).replace(/する$/, "") === norm(item.text)));
      if (exact) return { ...row, h: `${kataToHira(exact.text)}する`, corrected: false };
    }
  }

  if (!candidates.length) return null;
  const readings = candidates.flatMap(entry => validReadings(entry, row.k));
  if (!readings.length) return null;
  readings.sort((a, b) => Number(b.common) - Number(a.common));
  return { ...row, h: kataToHira(readings[0].text), corrected: true, oldReading: row.h };
}

const typoFixes = new Map([
  ["berkonstribusi", "berkontribusi"], ["berkumpull", "berkumpul"],
  ["bernafas", "bernapas"], ["sktripsi, thesis", "skripsi / tesis"],
  ["antrain, rentetan", "antrean / deretan"], ["penceraian", "perceraian"],
  ["budget", "anggaran"], ["profit", "laba"], ["report", "laporan"],
  ["wine", "anggur"], ["kalem", "tenang"]
]);
const cleanMeaning = value => {
  let result = value.trim();
  for (const [bad, good] of typoFixes) result = result.replace(new RegExp(bad, "gi"), good);
  return result.replace(/\s*,\s*/g, " / ").replace(/\s{2,}/g, " ");
};

const exactSeen = new Set(current.map(word => pair(word.k, word.h)));
const baseSeen = new Set(current.map(word => basePair(word.k, word.h)));
const added = [];
const corrected = [];
const skipped = [];
const sourceSeen = new Set();
for (const row of rows) {
  const sourceKey = pair(row.k, row.h);
  if (sourceSeen.has(sourceKey)) continue;
  sourceSeen.add(sourceKey);
  if (exactSeen.has(sourceKey) || baseSeen.has(basePair(row.k, row.h))) continue;
  const valid = validateRow(row);
  if (!valid) { skipped.push(row); continue; }
  const validPair = pair(valid.k, valid.h);
  const validBase = basePair(valid.k, valid.h);
  if (exactSeen.has(validPair) || baseSeen.has(validBase)) continue;
  if (valid.corrected) corrected.push({ k: row.k, from: row.h, to: valid.h });
  const word = {
    k: valid.k, h: valid.h, m: cleanMeaning(valid.m),
    ex: "", exr: "", exm: "", read: "", readr: "", readm: "",
    level: "N3-source", kind: "kotoba"
  };
  added.push(word);
  exactSeen.add(validPair);
  baseSeen.add(validBase);
}

const merged = [...current, ...added].map(word => {
  // Untuk kata serapan, hiragana harus mengikuti ejaan katakana persis,
  // termasuk tanda vokal panjang ー.
  if (word.level === "N3-source" && /^[ァ-ヶー・]+$/.test(word.k)) {
    return { ...word, h: kataToHira(word.k) };
  }
  return word;
});
const unique = [];
const mergedSeen = new Set();
for (const word of merged) {
  const key = pair(word.k, word.h);
  if (mergedSeen.has(key)) continue;
  mergedSeen.add(key);
  unique.push(word);
}
const newSets = [];
for (let i = 0; i < unique.length; i += 25) newSets.push(unique.slice(i, i + 25));

let updated = html.replace(setsMatch[1], JSON.stringify(newSets));
fs.writeFileSync(htmlPath, updated, "utf8");
console.log(JSON.stringify({ sourceRows: rows.length, before: current.length, added: added.length, correctedReadings: corrected.length, skipped: skipped.length, after: unique.length, groups: newSets.length, corrected: corrected.slice(0, 30), skippedSample: skipped.slice(0, 30) }, null, 2));
