import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const apiSource = fs.readFileSync('google-apps-script-reference/code.gs', 'utf8');
const dedupeSource = fs.readFileSync('google-apps-script-reference/merge-songs-gags-archive.gs', 'utf8');

function loadDedupeFunctions() {
  const context = vm.createContext({
    console,
    Map,
    Set,
    Number,
    String,
    Date,
    Object,
    Math,
  });
  vm.runInContext(dedupeSource, context, { filename: 'merge-songs-gags-archive.gs' });
  return context;
}

function entry(overrides = {}) {
  return {
    source: 'main',
    rowIndex: 10,
    artist: 'Artist',
    title: 'Song',
    kind: '歌枠',
    linkText: '20260101 Live title',
    url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA&t=10s',
    videoId: 'AAAAAAAAAAA',
    timestampSeconds: 10,
    dateMs: new Date(2026, 0, 1).getTime(),
    priority: 2,
    songKey: 'artist｜song',
    replacementKey: 'artist｜song｜歌枠｜20260101 live title',
    exactKey: 'artist｜song｜歌枠｜youtube:AAAAAAAAAAA:t=10',
    ...overrides,
  };
}

test('archive API starts reading at row 2', () => {
  assert.match(apiSource, /START_ROWS:\s*\{[\s\S]*archive:\s*2,/);
});

test('dedupe creates backups immediately before rewriting sheets', () => {
  const backupCall = dedupeSource.indexOf('createDedupeBackups_(ss, main, archive);');
  const rewriteCall = dedupeSource.indexOf('rewriteSongSheet_(main, START_ROW');
  assert.ok(backupCall >= 0, 'backup call must exist');
  assert.ok(rewriteCall > backupCall, 'backup must run before the first rewrite');
  assert.match(dedupeSource, /const BACKUP_KEEP_GENERATIONS = 5;/);
  assert.match(dedupeSource, /\.hideSheet\(\)/);
});

test('reupload replacement removes the old video across main and archive', () => {
  const ctx = loadDedupeFunctions();
  const oldArchive = entry({
    source: 'archive',
    rowIndex: 8,
    videoId: 'OLDOLDOLD01',
    url: 'https://www.youtube.com/watch?v=OLDOLDOLD01&t=10s',
    exactKey: 'artist｜song｜歌枠｜youtube:OLDOLDOLD01:t=10',
  });
  const newMain = entry({
    source: 'main',
    rowIndex: 900,
    videoId: 'NEWNEWNEW01',
    url: 'https://www.youtube.com/watch?v=NEWNEWNEW01&t=10s',
    exactKey: 'artist｜song｜歌枠｜youtube:NEWNEWNEW01:t=10',
  });

  const result = ctx.resolveReuploadedVideos_([oldArchive, newMain]);
  assert.equal(result.replacedGroups, 1);
  assert.equal(result.removedRows, 1);
  assert.deepEqual(result.entries.map(item => item.videoId), ['NEWNEWNEW01']);
});

test('exact duplicates across sheets keep the main row only', () => {
  const ctx = loadDedupeFunctions();
  const main = entry({ source: 'main', rowIndex: 50 });
  const archive = entry({ source: 'archive', rowIndex: 2 });
  const result = ctx.removeExactDuplicates_([archive, main]);
  assert.equal(result.removedRows, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].source, 'main');
});

test('newest singing stays in main and older singing moves to archive', () => {
  const ctx = loadDedupeFunctions();
  const older = entry({
    source: 'main',
    rowIndex: 10,
    dateMs: new Date(2025, 0, 1).getTime(),
    videoId: 'BBBBBBBBBBB',
    exactKey: 'artist｜song｜歌枠｜youtube:BBBBBBBBBBB:t=10',
    replacementKey: 'older occurrence',
  });
  const newer = entry({
    source: 'archive',
    rowIndex: 4,
    dateMs: new Date(2026, 0, 1).getTime(),
    videoId: 'CCCCCCCCCCC',
    exactKey: 'artist｜song｜歌枠｜youtube:CCCCCCCCCCC:t=10',
    replacementKey: 'newer occurrence',
  });

  const result = ctx.placeEntriesBySong_([older, newer]);
  assert.equal(result.mainEntries[0].videoId, 'CCCCCCCCCCC');
  assert.equal(result.archiveEntries[0].videoId, 'BBBBBBBBBBB');
});

test('same video at different timestamps is not treated as an exact duplicate', () => {
  const ctx = loadDedupeFunctions();
  const first = entry({ exactKey: 'artist｜song｜歌枠｜youtube:AAAAAAAAAAA:t=10', timestampSeconds: 10 });
  const second = entry({ exactKey: 'artist｜song｜歌枠｜youtube:AAAAAAAAAAA:t=20', timestampSeconds: 20, rowIndex: 11 });
  const result = ctx.removeExactDuplicates_([first, second]);
  assert.equal(result.removedRows, 0);
  assert.equal(result.entries.length, 2);
});
