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
  ['＼ﾅｧﾝ／', '＼ﾅｧﾝ／']
];
const archivedOptions = [
  [flower.repeat(4), '⚛️🌐ꕤ.\u200e˖٭（花）'],
  [note.repeat(4), '⚛️🌐♬*.+（音符）'],
  ['✨⚛️🌐🎵'.repeat(4), '✨⚛️🌐🎵（キラ音符）']
];

for (const page of ['index.html', 'v2/index.html']) {
  test(`${page} lists five danmaku and preserves long versions in comments`, async () => {
    const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
    const select = html.match(/<select\b[^>]*\bid="dm-select"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(select, 'danmaku select should be present');

    const comments = select[1].match(/<!--[\s\S]*?-->/g) || [];
    const activeHtml = select[1].replace(/<!--[\s\S]*?-->/g, '');
    const readOptions = markup => Array.from(
      markup.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g),
      ([, value, label]) => [value, label]
    );
    const options = readOptions(activeHtml);
    assert.deepEqual(options, expectedOptions);
    assert.deepEqual(readOptions(comments.join('\n')), archivedOptions);
  });
}
