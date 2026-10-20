import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairUploadFiles } from '../src/pair-files.ts';

test('abbina A/B per numero con ordine misto, salti ed estensioni diverse', () => {
  const files = ['B10.jpg', 'A2.png', 'B2.webp', 'A10.PNG'].map((name) => ({ name }));
  const plan = pairUploadFiles(files);
  assert.deepEqual(plan.pairs.map(({ number, start, end }) => [number, start.name, end.name]), [['2', 'A2.png', 'B2.webp'], ['10', 'A10.PNG', 'B10.jpg']]);
  assert.deepEqual(plan.issues, []);
});
test('blocca coppie incomplete, duplicati numerici e nomi non A/B', () => {
  for (const names of [['A1.png'], ['A1.png', 'B2.png'], ['A1.png', 'A01.jpg', 'B1.png'], ['A1.png', 'B1.png', 'other.png']]) {
    assert.ok(pairUploadFiles(names.map((name) => ({ name }))).issues.length);
  }
});
