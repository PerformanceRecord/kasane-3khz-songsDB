import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const flower = '⚛️🌐ꕤ.\u200e˖٭*';
const note = '⚛️🌐♬*.+';
const expectedOptions = [
  ['✨💙💜✨', '✨💙💜✨'],
  ['🎵🩵🤍🎵', '🎵🩵🤍🎵'],
  [flower, flower],
  [note, note],
  [flower.repeat(4), '⚛️🌐ꕤ.\u200e˖٭（花）'],
  [note.repeat(4), '⚛️🌐♬*.+（音符）'],
  ['✨⚛️🌐🎵'.repeat(4), '✨⚛️🌐🎵（キラ音符）'],
  ['＼ﾅｧﾝ／', '＼ﾅｧﾝ／']
];

for (const page of ['index.html', 'v2/index.html']) {
  test(`${page} lists new danmaku first and preserves existing options`, async () => {
    const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
    const select = html.match(/<select\b[^>]*\bid="dm-select"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(select, 'danmaku select should be present');

    const options = Array.from(
      select[1].matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g),
      ([, value, label]) => [value, label]
    );
    assert.deepEqual(options, expectedOptions);
  });
}
