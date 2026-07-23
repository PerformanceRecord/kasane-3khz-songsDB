import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const appSource = fs.readFileSync('assets/js/app.js', 'utf8');
const indexSource = fs.readFileSync('index.html', 'utf8');
const dedupeSource = fs.readFileSync(
  'google-apps-script-reference/merge-songs-gags-archive.gs',
  'utf8'
);
const apiSource = fs.readFileSync('google-apps-script-reference/code.gs', 'utf8');
const syncSource = fs.readFileSync('scripts/sync-gas.mjs', 'utf8');

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
    JSON,
  });
  vm.runInContext(dedupeSource, context, {
    filename: 'merge-songs-gags-archive.gs',
  });
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
    extraValues: ['', ''],
    ...overrides,
  };
}

test('featured artist highlighting is integrated into the main renderer', () => {
  assert.match(appSource, /const FEATURED_ARTIST = '花彩音_3kHz';/);
  assert.match(appSource, /item\.classList\.add\('item-featured-artist'\)/);
  assert.doesNotMatch(indexSource, /featured-artist\.js/);
  assert.doesNotMatch(appSource, /MutationObserver/);
  assert.equal(fs.existsSync('assets/js/featured-artist.js'), false);
});

test('list rows have a precomputed combined search key', () => {
  assert.match(appSource, /_search:\s*`\$\{artistKey\}\\n\$\{titleKey\}`/);
  assert.match(appSource, /_kind:\s*\(r\.kind \|\| ''\)\.trim\(\)/);
  assert.match(appSource, /filtered = filtered\.filter\(r => r\._search\.includes\(q\)\)/);
  assert.doesNotMatch(appSource, /r\._na\.includes\(q\) \|\| r\._nt\.includes\(q\)/);
});

test('history fetch supports session cache and cancellation', () => {
  assert.match(appSource, /historyCache:\s*new Map\(\)/);
  assert.match(appSource, /historyController:\s*null/);
  assert.match(appSource, /function abortCurrentHistoryRequest\(\)/);
  assert.match(appSource, /signal:\s*historyController\.signal/);
  assert.match(appSource, /state\.historyCache\.set\(cacheKey, entries\)/);
  assert.match(appSource, /state\.historyCache\.clear\(\)/);
});

test('list rendering is chunked and stale renders are cancelled', () => {
  assert.match(appSource, /const LIST_RENDER_CHUNK_SIZE = 100;/);
  assert.match(appSource, /function renderListRowsInChunks\(/);
  assert.match(appSource, /renderToken !== state\.listRenderToken/);
  assert.match(appSource, /requestAnimationFrame\(drawChunk\)/);
  assert.doesNotMatch(appSource, /mobileResizeObserver/);
});

test('resize no longer rebuilds every card', () => {
  const resizeBlock = appSource.match(/window\.addEventListener\('resize',[\s\S]*?\n\s*\}\);/);
  assert.ok(resizeBlock, 'resize handler must exist');
  assert.doesNotMatch(resizeBlock[0], /\brender\(\)/);
});

test('unchanged dedupe placement skips backup and sheet rewrites', () => {
  const checkCall = dedupeSource.indexOf('if (!hasDedupePlacementChanges_(');
  const backupCall = dedupeSource.indexOf('createDedupeBackups_(ss, main, archive);');
  const rewriteCall = dedupeSource.indexOf('rewriteSongSheet_(main, START_ROW');
  assert.ok(checkCall >= 0);
  assert.ok(backupCall > checkCall);
  assert.ok(rewriteCall > backupCall);
});

test('dedupe change detection is stable for identical placement', () => {
  const ctx = loadDedupeFunctions();
  const main = [entry()];
  const archive = [entry({
    source: 'archive',
    rowIndex: 2,
    title: 'Older Song',
    songKey: 'artist｜older song',
  })];
  assert.equal(
    ctx.hasDedupePlacementChanges_(main, archive, [...main], [...archive]),
    false
  );
});

test('dedupe change detection notices row movement and URL changes', () => {
  const ctx = loadDedupeFunctions();
  const main = [entry()];
  const archive = [];
  const moved = [];
  const movedArchive = [entry({ source: 'archive' })];
  assert.equal(ctx.hasDedupePlacementChanges_(main, archive, moved, movedArchive), true);

  const changedUrl = [entry({
    url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB&t=10s',
  })];
  assert.equal(ctx.hasDedupePlacementChanges_(main, archive, changedUrl, archive), true);
});

test('archive API accepts cursor parameters and emits continuation metadata', () => {
  assert.match(apiSource, /afterDate8Param/);
  assert.match(apiSource, /afterKeyParam/);
  assert.match(apiSource, /function compareArchiveCursorRows_\(/);
  assert.match(apiSource, /function isAfterArchiveCursor_\(/);
  assert.match(apiSource, /hasMore:\s*remaining\.length > pageRows\.length/);
  assert.match(apiSource, /nextCursorDate8/);
  assert.match(apiSource, /nextCursorKey/);
});

test('archive keys preserve same-day distinct videos and timestamps', () => {
  assert.match(syncSource, /function archiveStableRowKey\(row\)/);
  assert.match(syncSource, /const stableRowKey = archiveStableRowKey\(row\)/);
  assert.match(syncSource, /function archiveCursorKey\(row\) \{\s*return archiveStableRowKey\(row\);/);
});

test('archive synchronization remains bounded and rejects stalled cursors', () => {
  assert.match(syncSource, /ARCHIVE_BATCH_SIZE_MAX/);
  assert.match(syncSource, /limit:\s*batchSize/);
  assert.match(syncSource, /rows\.length === 0 && hasMore/);
  assert.match(syncSource, /cursor が進行していません/);
  assert.match(syncSource, /await writeFile\(`\$\{OUT_DIR\}\/\$\{ARCHIVE_TAB\}\.json`/);
  assert.match(syncSource, /await writeArchiveState\(archive\.nextState\)/);
});
