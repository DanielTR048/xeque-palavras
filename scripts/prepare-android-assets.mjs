/**
 * Copy the verified local dictionaries into the native Android app.
 * No downloads or npm dependencies are needed. Run with Node.js >= 20:
 *   node scripts/prepare-android-assets.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, 'android/app/src/main/assets');
const languages = ['pt', 'en'];
const lengths = [4, 5, 6, 7, 8];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nativeNoticeFiles = ['LICENSE-Kotlin.txt', 'NOTICE-Kotlin.txt'];

const [sourceBytes, commonSource] = await Promise.all([
  readFile(resolve(root, 'public/dictionaries/sources.json')),
  readFile(resolve(root, 'src/data/common-words.ts'), 'utf8'),
]);
const metadata = JSON.parse(sourceBytes.toString('utf8'));

// common-words.ts is generated as a typed declaration followed by JSON.
// Parse its data without evaluating JavaScript or depending on a TS runtime.
const commonMatch = commonSource.match(
  /\bexport\s+const\s+COMMON_WORDS\s*:[^=]+?=\s*(\{[\s\S]*\})\s*;\s*$/,
);
assert(commonMatch, 'Expected the generated COMMON_WORDS declaration; run npm run words:build if its format changed.');
const common = JSON.parse(commonMatch[1]);
assert.deepEqual(Object.keys(common).sort(), [...languages].sort(), 'Unexpected common-word language');
const nativeNotices = await Promise.all(nativeNoticeFiles.map(async (name) => ({
  name,
  bytes: await readFile(resolve(root, 'public/licenses', name)),
})));
for (const notice of nativeNotices) {
  assert(notice.bytes.length > 100, `Missing or empty native notice: ${notice.name}`);
}

// Validate every input before writing any asset. Incorrect or outdated inputs
// must fail the build instead of producing an APK with incompatible word data.
const prepared = await Promise.all(languages.map(async (language) => {
  const [dictionaryBytes, licenseBytes] = await Promise.all([
    readFile(resolve(root, `public/dictionaries/${language}.json`)),
    readFile(resolve(root, `public/dictionaries/LICENSE-${language}.txt`)),
  ]);
  const dictionary = JSON.parse(dictionaryBytes.toString('utf8'));
  const source = metadata[language];
  assert(source, `Missing ${language} source metadata`);
  assert.equal(sha256(dictionaryBytes), source.outputSha256, `${language} dictionary checksum mismatch`);
  assert.equal(sha256(licenseBytes), source.licenseSha256, `${language} license checksum mismatch`);
  assert.equal(dictionary.language, language, `${language} dictionary language mismatch`);
  assert(Array.isArray(dictionary.words), `${language} dictionary has no word array`);
  assert(dictionary.words.every((word) => typeof word === 'string' && /^[a-z]{4,8}$/.test(word)), `${language} dictionary contains invalid words`);
  const words = new Set(dictionary.words);
  assert.equal(words.size, dictionary.words.length, `${language} dictionary contains duplicates`);
  assert.equal(dictionary.count, words.size, `${language} count mismatch`);
  assert.equal(source.normalizedCount, words.size, `${language} metadata count mismatch`);
  assert(words.size >= 10_000, `${language} must contain at least 10,000 words`);
  assert.deepEqual(Object.keys(common[language]).sort(), lengths.map(String), `${language} common-word lengths mismatch`);

  for (const length of lengths) {
    const targets = common[language][length];
    assert(Array.isArray(targets), `${language}/${length} common words are missing`);
    assert(targets.length >= 30, `${language}/${length} needs at least 30 common answers`);
    assert.equal(new Set(targets).size, targets.length, `${language}/${length} common words contain duplicates`);
    assert(targets.every((word) => typeof word === 'string' && word.length === length && words.has(word)), `${language}/${length} common words do not match the dictionary`);
    const count = dictionary.words.filter((word) => word.length === length).length;
    assert.equal(dictionary.byLength[length], count, `${language}/${length} dictionary count mismatch`);
    assert.equal(source.curatedByLength[length], targets.length, `${language}/${length} common-word count mismatch`);
  }

  return { language, dictionaryBytes, licenseBytes, count: words.size };
}));

await mkdir(resolve(destination, 'dictionaries'), { recursive: true });
await mkdir(resolve(destination, 'licenses'), { recursive: true });
for (const { language, dictionaryBytes, licenseBytes, count } of prepared) {
  await writeFile(resolve(destination, `dictionaries/${language}.json`), dictionaryBytes);
  await writeFile(resolve(destination, `licenses/LICENSE-${language}.txt`), licenseBytes);
  console.log(`${language}: ${count} words prepared for Android`);
}
await writeFile(resolve(destination, 'dictionaries/common.json'), JSON.stringify(common, null, 2) + '\n');
await writeFile(resolve(destination, 'dictionaries/sources.json'), sourceBytes);
for (const { name, bytes } of nativeNotices) {
  await writeFile(resolve(destination, 'licenses', name), bytes);
}
console.log('Common answers, source metadata, dictionary licenses and Kotlin notices prepared without network access.');
