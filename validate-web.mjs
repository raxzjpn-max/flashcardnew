import fs from "node:fs";

const path = process.argv[2] || "index.html";
const html = fs.readFileSync(path, "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
for (const [index, script] of scripts.entries()) {
  try { new Function(script); }
  catch (error) { throw new Error(`Script ${index + 1}: ${error.message}`); }
}

const setsMatch = html.match(/const sets = (\[[\s\S]*?\]);\r?\nconst allWords = sets\.flat\(\)/);
if (!setsMatch) throw new Error("Data sets tidak ditemukan");
const sets = JSON.parse(setsMatch[1]);
const words = sets.flat();
const norm = value => String(value || "").normalize("NFKC").replace(/\s+/g, "");
const keys = words.map(word => `${norm(word.k)}|${norm(word.h)}`);
const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
const missing = words.filter(word => !word.k || !word.h || !word.m);
const oversized = sets.filter(group => group.length > 25);
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
const improveMatch = html.match(/function improveVocabularyExamples\(words\)(\{[\s\S]*?\n\})\r?\n\r?\nimproveVocabularyExamples\(allWords\)/);
if (!improveMatch) throw new Error("Generator contoh tidak ditemukan");
const improveVocabularyExamples = new Function(`return function improveVocabularyExamples(words)${improveMatch[1]}`)();
const exampleWords = JSON.parse(JSON.stringify(words));
improveVocabularyExamples(exampleWords);
const exampleSentences = exampleWords.map(word => word.ex);
const duplicateExamples = exampleSentences.filter((sentence, index) => exampleSentences.indexOf(sentence) !== index);
const bracketedExamples = exampleWords.filter(word => /[「」『』“”„‟«»]/.test(`${word.ex}${word.exr}${word.exm}`));
const skeletons = exampleWords.map(word => word.ex.replaceAll(word.k, "〈KATA〉").replaceAll(word.h, "〈KATA〉"));
const skeletonCounts = new Map();
for (const skeleton of skeletons) skeletonCounts.set(skeleton, (skeletonCounts.get(skeleton) || 0) + 1);
const repeatedSkeletonEntries = [...skeletonCounts.entries()].filter(([, count]) => count > 1).sort((a,b)=>b[1]-a[1]);
const repeatedSkeletons = repeatedSkeletonEntries.map(([,count])=>count);

if (duplicates.length || missing.length || oversized.length || duplicateIds.length || duplicateExamples.length || bracketedExamples.length) {
  throw new Error(JSON.stringify({ duplicates: duplicates.length, missing: missing.length, oversized: oversized.length, duplicateIds, duplicateExamples: duplicateExamples.length, bracketedExamples: bracketedExamples.length }, null, 2));
}
console.log(JSON.stringify({ scripts: scripts.length, words: words.length, groups: sets.length, maxGroup: Math.max(...sets.map(group => group.length)), levels: Object.fromEntries([...new Set(words.map(word => word.level))].map(level => [level, words.filter(word => word.level === level).length])), duplicatePairs: 0, missingFields: 0, duplicateIds: 0, duplicateExamples: 0, repeatedExampleSkeletons: repeatedSkeletons.length, largestSkeletonRepeat: repeatedSkeletons.length ? Math.max(...repeatedSkeletons) : 1, topRepeatedSkeletons: repeatedSkeletonEntries.slice(0,8) }, null, 2));
