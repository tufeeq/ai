import test from 'node:test';
import assert from 'node:assert/strict';
import { transliterate, pausalize, vowelDensity, tipsFor } from '../src/translit.mjs';

const CASES = [
  ['شُكْرًا جَزِيلًا', 'shukran jazeelan'],
  ['السَّلَامُ عَلَيْكُمْ', 'as-salaam 3alaykum'],
  ['صَبَاحُ الْخَيْرِ', 'SabaaH al-khayr'],
  ['أَيْنَ الْمَسْجِدُ؟', 'ayn al-masjid?'],
  ['كَمْ سِعْرُ هَٰذَا؟', 'kam si3r haadhaa?'],
  ['لَا أَفْهَمُ', 'laa afham'],
  ['مَرْحَبًا', 'marHaban'],
  ['وَالشَّمْسُ', 'wash-shams'],
  ['بِالْبَيْتِ', 'bil-bayt'],
  ['لِلْمَدْرَسَةِ', 'lil-madrasa'],
  ['مَدِينَةُ الرِّيَاضِ', 'madeenat ar-riyaaD'],
  ['كَيْفَ حَالُكَ؟', 'kayf Haaluk?'],
  ['كِيفْ حَالَكْ؟', 'keef Haalak?'],
  ['قَهْوَةٌ', 'qahwa'],
  ['يَوْمٌ جَمِيلٌ', 'yawm jameel'],
  ['إِنْ شَاءَ اللَّهُ', "in shaa' allaah"],
  ['الْحَمْدُ لِلَّهِ', 'al-Hamd lillaah'],
  ['مُحَمَّدٌ', 'muHammad'],
  ['أُحِبُّكَ', "uHibbuk"],
];

for (const [ar, want] of CASES) {
  test(`transliterate ${want}`, () => assert.equal(transliterate(ar), want));
}

test('pausal form drops final short vowels but keeps -an', () => {
  assert.equal(pausalize('صَبَاحُ الْخَيْرِ'), 'صَبَاح الْخَيْر');
  assert.equal(pausalize('شُكْرًا'), 'شُكْرًا');
});

test('pausalize is idempotent', () => {
  for (const [ar] of CASES) assert.equal(pausalize(pausalize(ar)), pausalize(ar));
});

test('vowel density separates vocalised from bare text', () => {
  assert.ok(vowelDensity('كَيْفَ حَالُكَ') > 0.5);
  assert.equal(vowelDensity('كيف حالك'), 0);
});

test('tips match the hard sounds present', () => {
  assert.match(tipsFor('عَلَيْكُمْ').join(' '), /ع/);
  assert.deepEqual(tipsFor('مَا'), []);
  assert.ok(tipsFor('عحقخغص').length <= 3);
});

test('never throws on odd input', () => {
  for (const s of ['', '   ', 'hello', '123', '؟؟', 'ـــ', 'abc شكرا', 'ًٌٍ']) assert.equal(typeof transliterate(s), 'string');
});
