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

test('maintenance menu exposes separate daily and full-audit actions', () => {
  assert.match(
    dedupeSource,
    /\.addItem\('新規追加分を仕分け（日常用）', 'classifyNewSongEntries'\)/,
  );
  assert.match(
    dedupeSource,
    /\.addItem\('全件を総点検・訂正', 'auditAllSongEntries'\)/,
  );
  assert.match(
    dedupeSource,
    /const DAILY_LAST_MAIN_ROW_KEY = 'songMaintenance\.lastMainDataRow';/,
  );
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

test('exact duplicates across sheets keep the earlier archived row', () => {
  const ctx = loadDedupeFunctions();
  const main = entry({ source: 'main', rowIndex: 50 });
  const archive = entry({ source: 'archive', rowIndex: 2 });
  const result = ctx.removeExactDuplicates_([archive, main]);
  assert.equal(result.removedRows, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].source, 'archive');
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

test('category priority wins even when the lower-priority performance is newer', () => {
  const ctx = loadDedupeFunctions();
  const olderCover = entry({
    kind: '歌ってみた',
    priority: 3,
    dateMs: new Date(2024, 0, 1).getTime(),
    videoId: 'COVERCOVER1',
    exactKey: 'cover',
    replacementKey: 'cover occurrence',
  });
  const newerStream = entry({
    kind: '歌枠',
    priority: 2,
    dateMs: new Date(2026, 0, 1).getTime(),
    videoId: 'STREAMLIVE1',
    exactKey: 'stream',
    replacementKey: 'stream occurrence',
  });

  const result = ctx.placeEntriesBySong_([newerStream, olderCover]);
  assert.equal(result.mainEntries[0].videoId, 'COVERCOVER1');
  assert.equal(result.archiveEntries[0].videoId, 'STREAMLIVE1');
});

test('stream priority wins over a newer short', () => {
  const ctx = loadDedupeFunctions();
  const olderStream = entry({
    kind: '歌枠',
    priority: 2,
    dateMs: new Date(2024, 0, 1).getTime(),
    videoId: 'STREAMLIVE1',
  });
  const newerShort = entry({
    kind: 'ショート',
    priority: 1,
    dateMs: new Date(2026, 0, 1).getTime(),
    videoId: 'SHORTVIDEO1',
  });

  const result = ctx.placeEntriesBySong_([newerShort, olderStream]);
  assert.equal(result.mainEntries[0].videoId, 'STREAMLIVE1');
  assert.equal(result.archiveEntries[0].videoId, 'SHORTVIDEO1');
});

test('exact duplicate key uses A, B, D text and URL but ignores category', () => {
  const ctx = loadDedupeFunctions();
  const shared = {
    artist: 'Artist',
    title: 'Song',
    linkText: '20260101 Live title',
    url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA&t=10s',
  };
  const streamKey = ctx.buildExactOccurrenceKey_({ ...shared, kind: '歌枠' });
  const shortKey = ctx.buildExactOccurrenceKey_({ ...shared, kind: 'ショート' });
  assert.equal(streamKey, shortKey);
});

test('reupload key includes category and ignores only the D suffix within that category', () => {
  const ctx = loadDedupeFunctions();
  const date = new Date(2025, 4, 8);
  const oldStreamKey = ctx.buildReplacementKey_({
    artist: 'Artist',
    title: 'Song',
    kind: '歌枠',
    linkText: '20250508 old archive',
    date,
    dateMs: date.getTime(),
  });
  const newStreamKey = ctx.buildReplacementKey_({
    artist: 'Artist',
    title: 'Song',
    kind: '歌枠',
    linkText: '20250508 re-uploaded archive',
    date,
    dateMs: date.getTime(),
  });
  const shortKey = ctx.buildReplacementKey_({
    artist: 'Artist',
    title: 'Song',
    kind: 'ショート',
    linkText: '20250508 re-uploaded archive',
    date,
    dateMs: date.getTime(),
  });
  assert.equal(oldStreamKey, newStreamKey);
  assert.notEqual(oldStreamKey, shortKey);
});

test('same-day lower-priority uploads cannot replace or outrank a cover', () => {
  const ctx = loadDedupeFunctions();
  const date = new Date(2026, 2, 14);
  const cover = entry({
    source: 'archive',
    rowIndex: 4,
    kind: '歌ってみた',
    priority: 3,
    linkText: '20260314 Cover',
    url: 'https://www.youtube.com/watch?v=COVERCOVER1',
    videoId: 'COVERCOVER1',
    date,
    dateMs: date.getTime(),
  });
  const newerStream = entry({
    source: 'main',
    rowIndex: 900,
    kind: '歌枠',
    priority: 2,
    linkText: '20260314 Stream',
    url: 'https://www.youtube.com/watch?v=STREAMLIVE1',
    videoId: 'STREAMLIVE1',
    date,
    dateMs: date.getTime(),
  });
  for (const item of [cover, newerStream]) {
    item.replacementKey = ctx.buildReplacementKey_(item);
    item.exactKey = ctx.buildExactOccurrenceKey_(item);
  }

  const replacement = ctx.resolveReuploadedVideos_([cover, newerStream]);
  assert.equal(replacement.removedRows, 0);
  const exact = ctx.removeExactDuplicates_(replacement.entries);
  const placement = ctx.placeEntriesBySong_(exact.entries);
  assert.equal(placement.mainEntries[0].videoId, 'COVERCOVER1');
  assert.equal(placement.archiveEntries[0].videoId, 'STREAMLIVE1');
});

test('a cover remains the sole main entry over every newer stream and short', () => {
  const ctx = loadDedupeFunctions();
  const items = [
    entry({
      rowIndex: 10,
      kind: '歌ってみた',
      priority: 3,
      linkText: '20240101 Cover',
      url: 'https://www.youtube.com/watch?v=COVERCOVER1',
      videoId: 'COVERCOVER1',
      date: new Date(2024, 0, 1),
      dateMs: new Date(2024, 0, 1).getTime(),
    }),
    entry({
      rowIndex: 11,
      kind: '歌枠',
      priority: 2,
      linkText: '20260101 Stream',
      url: 'https://www.youtube.com/watch?v=STREAMLIVE1',
      videoId: 'STREAMLIVE1',
      date: new Date(2026, 0, 1),
      dateMs: new Date(2026, 0, 1).getTime(),
    }),
    entry({
      rowIndex: 12,
      kind: 'ショート',
      priority: 1,
      linkText: '20270101 Short',
      url: 'https://www.youtube.com/watch?v=SHORTVIDEO1',
      videoId: 'SHORTVIDEO1',
      date: new Date(2027, 0, 1),
      dateMs: new Date(2027, 0, 1).getTime(),
    }),
  ];
  for (const item of items) {
    item.date = ctx.parseHeadDate(item.linkText);
    item.dateMs = item.date.getTime();
    item.replacementKey = ctx.buildReplacementKey_(item);
    item.exactKey = ctx.buildExactOccurrenceKey_(item);
  }

  const result = ctx.buildMaintenancePlacement_(items, [], null);
  assert.deepEqual(
    Array.from(result.placement.mainEntries, item => item.videoId),
    ['COVERCOVER1'],
  );
  assert.deepEqual(
    Array.from(result.placement.archiveEntries, item => item.videoId).sort(),
    ['STREAMLIVE1', 'SHORTVIDEO1'].sort(),
  );
});

test('without a cover the newest stream remains and all other streams and shorts move to history', () => {
  const ctx = loadDedupeFunctions();
  const items = [
    entry({
      rowIndex: 10,
      kind: '歌枠',
      priority: 2,
      linkText: '20240101 Old stream',
      url: 'https://www.youtube.com/watch?v=OLDSTREAM01',
      videoId: 'OLDSTREAM01',
      date: new Date(2024, 0, 1),
      dateMs: new Date(2024, 0, 1).getTime(),
    }),
    entry({
      rowIndex: 11,
      kind: '歌枠',
      priority: 2,
      linkText: '20260101 New stream',
      url: 'https://www.youtube.com/watch?v=NEWSTREAM01',
      videoId: 'NEWSTREAM01',
      date: new Date(2026, 0, 1),
      dateMs: new Date(2026, 0, 1).getTime(),
    }),
    entry({
      rowIndex: 12,
      kind: 'ショート',
      priority: 1,
      linkText: '20250101 Old short',
      url: 'https://www.youtube.com/watch?v=OLDSHORT001',
      videoId: 'OLDSHORT001',
      date: new Date(2025, 0, 1),
      dateMs: new Date(2025, 0, 1).getTime(),
    }),
    entry({
      rowIndex: 13,
      kind: 'ショート',
      priority: 1,
      linkText: '20270101 New short',
      url: 'https://www.youtube.com/watch?v=NEWSHORT001',
      videoId: 'NEWSHORT001',
      date: new Date(2027, 0, 1),
      dateMs: new Date(2027, 0, 1).getTime(),
    }),
  ];
  for (const item of items) {
    item.date = ctx.parseHeadDate(item.linkText);
    item.dateMs = item.date.getTime();
    item.replacementKey = ctx.buildReplacementKey_(item);
    item.exactKey = ctx.buildExactOccurrenceKey_(item);
  }

  const result = ctx.buildMaintenancePlacement_(items, [], null);
  assert.deepEqual(
    Array.from(result.placement.mainEntries, item => item.videoId),
    ['NEWSTREAM01'],
  );
  assert.deepEqual(
    Array.from(result.placement.archiveEntries, item => item.videoId).sort(),
    ['OLDSTREAM01', 'OLDSHORT001', 'NEWSHORT001'].sort(),
  );
});

test('exact duplicates across categories retain the highest-priority category', () => {
  const ctx = loadDedupeFunctions();
  const stream = entry({
    source: 'archive',
    rowIndex: 2,
    kind: '歌枠',
    priority: 2,
  });
  const laterCover = entry({
    source: 'main',
    rowIndex: 900,
    kind: '歌ってみた',
    priority: 3,
  });
  stream.exactKey = ctx.buildExactOccurrenceKey_(stream);
  laterCover.exactKey = ctx.buildExactOccurrenceKey_(laterCover);

  const result = ctx.removeExactDuplicates_([stream, laterCover]);
  assert.equal(result.removedRows, 1);
  assert.equal(result.entries[0].kind, '歌ってみた');
});

test('a reuploaded lower-priority occurrence is replaced before category placement', () => {
  const ctx = loadDedupeFunctions();
  const cover = entry({
    source: 'main',
    rowIndex: 20,
    kind: '歌ってみた',
    priority: 3,
    dateMs: new Date(2026, 0, 1).getTime(),
    videoId: 'COVERCOVER1',
    url: 'https://www.youtube.com/watch?v=COVERCOVER1',
    replacementKey: 'artist｜song｜20260101',
    exactKey: 'cover',
  });
  const oldStream = entry({
    source: 'archive',
    rowIndex: 8,
    kind: '歌枠',
    priority: 2,
    dateMs: new Date(2025, 0, 1).getTime(),
    videoId: 'OLDOLDOLD01',
    url: 'https://www.youtube.com/watch?v=OLDOLDOLD01&t=10s',
    replacementKey: 'artist｜song｜20250101',
    exactKey: 'old stream',
  });
  const newStream = entry({
    source: 'main',
    rowIndex: 900,
    kind: '歌枠',
    priority: 2,
    dateMs: new Date(2025, 0, 1).getTime(),
    videoId: 'NEWNEWNEW01',
    url: 'https://www.youtube.com/watch?v=NEWNEWNEW01&t=10s',
    replacementKey: 'artist｜song｜20250101',
    exactKey: 'new stream',
  });

  const replacement = ctx.resolveReuploadedVideos_([cover, oldStream, newStream]);
  assert.deepEqual(
    replacement.entries.map(item => item.videoId).sort(),
    ['COVERCOVER1', 'NEWNEWNEW01'].sort(),
  );

  const placement = ctx.placeEntriesBySong_(replacement.entries);
  assert.equal(placement.mainEntries[0].videoId, 'COVERCOVER1');
  assert.equal(placement.archiveEntries[0].videoId, 'NEWNEWNEW01');
});

test('daily placement only corrects songs affected by newly appended rows', () => {
  const ctx = loadDedupeFunctions();
  const targetStream = entry({
    songKey: 'artist-a｜song-a',
    kind: '歌枠',
    priority: 2,
    videoId: 'TARGETLIVE1',
    replacementKey: 'target live',
    exactKey: 'target live',
  });
  const targetCover = entry({
    source: 'archive',
    rowIndex: 4,
    songKey: 'artist-a｜song-a',
    kind: '歌ってみた',
    priority: 3,
    videoId: 'TARGETCOVER',
    replacementKey: 'target cover',
    exactKey: 'target cover',
  });
  const untouchedShort = entry({
    songKey: 'artist-b｜song-b',
    kind: 'ショート',
    priority: 1,
    videoId: 'OTHERSHORT1',
    replacementKey: 'other short',
    exactKey: 'other short',
  });
  const untouchedStream = entry({
    source: 'archive',
    rowIndex: 5,
    songKey: 'artist-b｜song-b',
    kind: '歌枠',
    priority: 2,
    videoId: 'OTHERSTREAM',
    replacementKey: 'other stream',
    exactKey: 'other stream',
  });

  const daily = ctx.buildMaintenancePlacement_(
    [targetStream, untouchedShort],
    [targetCover, untouchedStream],
    new Set(['artist-a｜song-a']),
  );
  assert.deepEqual(
    Array.from(daily.placement.mainEntries, item => item.videoId).sort(),
    ['TARGETCOVER', 'OTHERSHORT1'].sort(),
  );

  const audit = ctx.buildMaintenancePlacement_(
    [targetStream, untouchedShort],
    [targetCover, untouchedStream],
    null,
  );
  assert.deepEqual(
    Array.from(audit.placement.mainEntries, item => item.videoId).sort(),
    ['TARGETCOVER', 'OTHERSTREAM'].sort(),
  );
});

test('daily checkpoint uses compacted output row instead of an old source row number', () => {
  const ctx = loadDedupeFunctions();
  let storedKey = '';
  let storedValue = '';
  const properties = {
    setProperty(key, value) {
      storedKey = key;
      storedValue = value;
    },
  };

  ctx.saveDailyCheckpoint_(properties, [entry({ rowIndex: 900 })], true);
  assert.equal(storedKey, 'songMaintenance.lastMainDataRow');
  assert.equal(storedValue, '4');
});

test('daily processing requires a full-audit checkpoint first', () => {
  const ctx = loadDedupeFunctions();
  assert.throws(
    () => ctx.readDailyCheckpoint_({ getProperty: () => null }),
    /初回実行前に「全件を総点検・訂正」/,
  );
  assert.equal(
    ctx.readDailyCheckpoint_({ getProperty: () => '42' }),
    42,
  );
});

test('same video at different timestamps is not treated as an exact duplicate', () => {
  const ctx = loadDedupeFunctions();
  const first = entry({
    url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA&t=10s',
    timestampSeconds: 10,
  });
  const second = entry({
    url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA&t=20s',
    timestampSeconds: 20,
    rowIndex: 11,
  });
  first.exactKey = ctx.buildExactOccurrenceKey_(first);
  second.exactKey = ctx.buildExactOccurrenceKey_(second);
  const result = ctx.removeExactDuplicates_([first, second]);
  assert.equal(result.removedRows, 0);
  assert.equal(result.entries.length, 2);
});
