/**
 * 花彩音 3kHz 歌唱曲DB
 * 日常仕分け／総点検／近似情報チェック／統計：統合版
 *
 * 主な仕様
 * - 「歌った曲リスト」と「アーカイブ」は、それぞれのシート内で重複を整理する
 * - 再アップロードは、同一アーティスト×同一曲名×同一区分×同一投稿日で後から追加されたURLを正とする
 * - A列＋B列＋D列URLの完全重複は、1件だけ残す（URLが空の行は対象外）
 * - メイン内の同一アーティスト×同一曲名は、区分優先度の最も高いものをメインへ配置する
 * - 同一区分ならD列表示文言の文頭から抽出した投稿日が新しいものをメインへ、残りをアーカイブへ配置する
 * - アーカイブ内では完全重複と再アップロードだけを整理し、区分優先度による削減やメインへの復帰は行わない
 * - 重複しない行は所属と並び順を変更しない
 * - 日常用は毎回両シート全件の重複を照合し、チェックポイントは新規URLの判定だけに使う
 * - 総点検は両シートを横断し、A列＋B列＋完全URLが同じ行をアーカイブ側から優先して削除する
 * - 近似情報チェックは、A/Bテレコ・表記ゆれ・70%以上の類似・完全URL一致を別シートへ出力する
 */

const MAIN_SHEET_NAME = '歌った曲リスト';
const ARCHIVE_SHEET_NAME = 'アーカイブ';
const APPROX_CHECK_SHEET_NAME = '近似情報チェック';
const STATS_SHEET_NAME = '統計';

const START_ROW = 4;
const ARCHIVE_START_ROW = 2;
const COL_COUNT = 4;
const MAIN_DATA_COL_COUNT = 6;
const SOURCE_URL_COL = 4;
const BACKUP_PREFIX = '_backup_';
const BACKUP_KEEP_GENERATIONS = 5;
const DAILY_LAST_MAIN_ROW_KEY = 'songMaintenance.lastMainDataRow';
const APPROX_SIMILARITY_THRESHOLD = 0.7;

const PRIORITY = {
  '歌ってみた': 3,
  '歌枠': 2,
  'ショート': 1,
};

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('仕分け')
    .addItem('重複を仕分け（日常用）', 'classifyNewSongEntries')
    .addItem('完全重複を総点検', 'auditAllSongEntries')
    .addItem('近似情報をチェック', 'checkApproximateSongInfo')
    .addSeparator()
    .addItem('統計シートを作成・更新', 'createSongStatistics')
    .addToUi();
}

function dedupeAndArchive() {
  return auditAllSongEntries();
}

function classifyNewSongEntries() {
  const properties = PropertiesService.getDocumentProperties();
  return runSongMaintenance_({
    properties,
  });
}

function auditAllSongEntries() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActive();
    const main = ss.getSheetByName(MAIN_SHEET_NAME);
    const archive = ss.getSheetByName(ARCHIVE_SHEET_NAME);
    if (!main) throw new Error(`シート「${MAIN_SHEET_NAME}」が見つかりません。`);
    if (!archive) throw new Error(`シート「${ARCHIVE_SHEET_NAME}」が見つかりません。`);

    ensureSheetHasRequiredColumns_(main, MAIN_SHEET_NAME, COL_COUNT);
    ensureSheetHasRequiredColumns_(archive, ARCHIVE_SHEET_NAME, COL_COUNT);

    const mainEntries = readSongEntries_(main, START_ROW, 'main', true);
    const archiveEntries = readSongEntries_(archive, ARCHIVE_START_ROW, 'archive', false);
    const result = buildFullAuditPlacement_(mainEntries, archiveEntries);

    if (result.removedRows === 0) {
      saveDailyCheckpoint_(PropertiesService.getDocumentProperties(), mainEntries);
      ss.toast('完全重複はありません。バックアップと書換えを省略しました。', '総点検', 6);
      return;
    }

    createDedupeBackups_(ss, main, archive);
    if (result.removedMainRows > 0) {
      rewriteSongSheet_(main, START_ROW, result.mainEntries, true);
    }
    if (result.removedArchiveRows > 0) {
      rewriteSongSheet_(archive, ARCHIVE_START_ROW, result.archiveEntries, false);
    }
    saveDailyCheckpoint_(
      PropertiesService.getDocumentProperties(),
      result.mainEntries,
      result.removedMainRows > 0
    );

    ss.toast(
      `完全重複=${result.duplicateGroups}組、削除=${result.removedRows}行（アーカイブ=${result.removedArchiveRows}行、歌った曲リスト=${result.removedMainRows}行）`,
      '総点検完了',
      10
    );
  } finally {
    lock.releaseLock();
  }
}

function buildFullAuditPlacement_(mainEntries, archiveEntries) {
  const allEntries = [...mainEntries, ...archiveEntries];
  const withUrl = allEntries.filter(entry => normalizeUrlForCompare_(entry.url));
  const byExactKey = groupBy_(withUrl, entry => entry.exactKey);
  const removed = new Set();
  let duplicateGroups = 0;

  for (const group of byExactKey.values()) {
    if (group.length <= 1) continue;
    group.sort(compareFullAuditRepresentative_);
    for (const duplicate of group.slice(1)) removed.add(duplicate);
    duplicateGroups++;
  }

  const removedMainRows = mainEntries.filter(entry => removed.has(entry)).length;
  const removedArchiveRows = archiveEntries.filter(entry => removed.has(entry)).length;

  return {
    mainEntries: mainEntries.filter(entry => !removed.has(entry)),
    archiveEntries: archiveEntries.filter(entry => !removed.has(entry)),
    duplicateGroups,
    removedRows: removed.size,
    removedMainRows,
    removedArchiveRows,
  };
}

function compareFullAuditRepresentative_(a, b) {
  // 両シートにある完全重複はメインを残し、アーカイブ側を優先して削除する。
  if (a.source !== b.source) return a.source === 'main' ? -1 : 1;
  // 同一シート内では上の行を残す。
  return a.rowIndex - b.rowIndex;
}

function runSongMaintenance_(options) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActive();
    const main = ss.getSheetByName(MAIN_SHEET_NAME);
    if (!main) throw new Error(`シート「${MAIN_SHEET_NAME}」が見つかりません。`);

    let archive = ss.getSheetByName(ARCHIVE_SHEET_NAME);
    if (!archive) archive = ss.insertSheet(ARCHIVE_SHEET_NAME);

    ensureSheetHasRequiredColumns_(main, MAIN_SHEET_NAME, COL_COUNT);
    ensureSheetHasRequiredColumns_(archive, ARCHIVE_SHEET_NAME, COL_COUNT);
    ensureArchiveHeader_(archive);

    const mainEntries = readSongEntries_(main, START_ROW, 'main', true);
    const archiveEntries = readSongEntries_(archive, ARCHIVE_START_ROW, 'archive', false);
    const allEntries = [...mainEntries, ...archiveEntries];
    const properties = options.properties;
    const lastMainDataRow = readDailyCheckpoint_(properties);

    if (allEntries.length === 0) {
      saveDailyCheckpoint_(properties, mainEntries);
      ss.toast('整理対象のデータがありません。', '仕分け', 5);
      return;
    }

    const dailyContext = prepareDailyMaintenance_(mainEntries, lastMainDataRow);
    const newMainEntries = dailyContext.newMainEntries;
    const targetSongKeys = dailyContext.targetSongKeys;

    const isTarget = entry => !targetSongKeys || targetSongKeys.has(entry.songKey);
    const duplicateMainEntries = collectDuplicateSongEntries_(
      removeExactDuplicates_(mainEntries.filter(isTarget)).entries
    );
    const duplicateArchiveEntries = collectDuplicateSongEntries_(
      removeExactDuplicates_(archiveEntries.filter(isTarget)).entries
    );

    validateEntryDates_([...duplicateMainEntries, ...duplicateArchiveEntries]);
    validateEntryKinds_(duplicateMainEntries);

    const result = buildMaintenancePlacement_(mainEntries, archiveEntries, targetSongKeys);
    const placement = result.placement;

    if (!hasDedupePlacementChanges_(
      mainEntries,
      archiveEntries,
      placement.mainEntries,
      placement.archiveEntries
    )) {
      saveDailyCheckpoint_(properties, mainEntries);
      ss.toast(
        `全件を確認しました（新規=${newMainEntries.length}行）。移動・削除対象はありません。`,
        '日常用仕分け',
        6
      );
      return;
    }

    createDedupeBackups_(ss, main, archive);

    rewriteSongSheet_(main, START_ROW, placement.mainEntries, true);
    rewriteSongSheet_(archive, ARCHIVE_START_ROW, placement.archiveEntries, false);

    saveDailyCheckpoint_(properties, placement.mainEntries, true);

    ss.toast(
      [
        `全件確認（新規=${newMainEntries.length}行）`,
        `再アップロード置換=${result.replacement.replacedGroups}組`,
        `旧リンク除外=${result.replacement.removedRows}行`,
        `完全重複除外=${result.exact.removedRows}行`,
        `歌唱曲=${placement.mainEntries.length}行`,
        `履歴=${placement.archiveEntries.length}行`,
      ].join('、'),
      '日常用仕分け完了',
      10
    );
  } finally {
    lock.releaseLock();
  }
}

function buildMaintenancePlacement_(mainEntries, archiveEntries, targetSongKeys) {
  const isTarget = entry => !targetSongKeys || targetSongKeys.has(entry.songKey);
  const targetMain = mainEntries.filter(isTarget);
  const targetArchive = archiveEntries.filter(isTarget);
  const untouchedMain = targetSongKeys ? mainEntries.filter(entry => !isTarget(entry)) : [];
  const untouchedArchive = targetSongKeys ? archiveEntries.filter(entry => !isTarget(entry)) : [];

  // メインを指定された順序（完全重複 → 再アップロード → 区分優先度）で整理する。
  const mainExact = removeExactDuplicates_(targetMain);
  const mainReplacement = resolveReuploadedVideos_(mainExact.entries);
  const mainPlacement = placeEntriesBySong_(mainReplacement.entries);

  // メインから移動した履歴も含め、アーカイブは完全重複と再アップロードだけを整理する。
  const archiveCandidates = [...targetArchive, ...mainPlacement.archiveEntries];
  const archiveExact = removeExactDuplicates_(archiveCandidates);
  const archiveReplacement = resolveReuploadedVideos_(archiveExact.entries);

  const exact = {
    removedRows: mainExact.removedRows + archiveExact.removedRows,
  };
  const replacement = {
    replacedGroups: mainReplacement.replacedGroups + archiveReplacement.replacedGroups,
    removedRows: mainReplacement.removedRows + archiveReplacement.removedRows,
  };

  return {
    replacement,
    exact,
    placement: {
      mainEntries: [...untouchedMain, ...mainPlacement.mainEntries],
      archiveEntries: [...untouchedArchive, ...archiveReplacement.entries],
    },
  };
}

function collectDuplicateSongEntries_(entries) {
  const duplicates = [];
  for (const group of groupBy_(entries, entry => entry.songKey).values()) {
    if (group.length > 1) duplicates.push(...group);
  }
  return duplicates;
}

function prepareDailyMaintenance_(mainEntries, lastMainDataRow) {
  const newMainEntries = mainEntries.filter(entry => entry.rowIndex > lastMainDataRow);
  for (const entry of newMainEntries) entry.isNewlyAdded = true;

  return {
    newMainEntries,
    // null は全件対象を表す。日常用でも既存の重複を毎回確認する。
    targetSongKeys: null,
  };
}

function getLastEntryRow_(entries, fallback) {
  return (entries || []).reduce(
    (maxRow, entry) => Math.max(maxRow, Number(entry.rowIndex) || 0),
    fallback
  );
}

function readDailyCheckpoint_(properties) {
  const checkpointText = properties.getProperty(DAILY_LAST_MAIN_ROW_KEY);
  if (checkpointText === null) {
    return START_ROW - 1;
  }

  const lastMainDataRow = Number(checkpointText);
  if (!Number.isInteger(lastMainDataRow) || lastMainDataRow < START_ROW - 1) {
    throw new Error('日常用仕分けの基準位置が不正です。Document Propertiesを確認してください。');
  }
  return lastMainDataRow;
}

function saveDailyCheckpoint_(properties, mainEntries, rowsWereCompacted) {
  const lastMainDataRow = rowsWereCompacted
    ? ((mainEntries || []).length > 0 ? START_ROW + mainEntries.length - 1 : START_ROW - 1)
    : getLastEntryRow_(mainEntries, START_ROW - 1);
  properties.setProperty(
    DAILY_LAST_MAIN_ROW_KEY,
    String(lastMainDataRow)
  );
}

function readSongEntries_(sheet, startRow, source, includeMainExtras) {
  const lastRow = sheet.getLastRow();
  if (lastRow < startRow) return [];

  const numRows = lastRow - startRow + 1;
  const availableCols = sheet.getMaxColumns();
  const readCols = includeMainExtras ? Math.min(MAIN_DATA_COL_COUNT, availableCols) : COL_COUNT;

  const values = sheet.getRange(startRow, 1, numRows, readCols).getValues();
  const displayValues = sheet.getRange(startRow, 1, numRows, COL_COUNT).getDisplayValues();
  const richValues = sheet.getRange(startRow, 1, numRows, COL_COUNT).getRichTextValues();
  const formulas = sheet.getRange(startRow, 1, numRows, COL_COUNT).getFormulas();

  const out = [];

  for (let i = 0; i < numRows; i++) {
    const artist = String(displayValues[i][0] || '').trim();
    const title = String(displayValues[i][1] || '').trim();
    const kind = String(displayValues[i][2] || '').trim();
    const linkText = String(displayValues[i][3] || '').trim();

    if (!artist && !title && !kind && !linkText) continue;

    const url = extractUrlFromCell_(richValues[i][3], formulas[i][3], linkText) || '';
    const videoId = extractVideoIdFromUrl_(url) || '';
    const timestampSeconds = extractTimestampSeconds_(url, linkText);
    const date = parseMaintenanceHeadDate_(linkText);
    const rowIndex = startRow + i;

    const entry = {
      source,
      sourceSheet: sheet,
      rowIndex,
      artist,
      title,
      kind,
      linkText,
      url,
      videoId,
      timestampSeconds,
      date,
      dateMs: date ? date.getTime() : 0,
      priority: Object.prototype.hasOwnProperty.call(PRIORITY, kind) ? PRIORITY[kind] : 0,
      extraValues: includeMainExtras
        ? [values[i][4] !== undefined ? values[i][4] : '', values[i][5] !== undefined ? values[i][5] : '']
        : ['', ''],
    };

    entry.songKey = buildKey(entry.artist, entry.title);
    entry.replacementKey = buildReplacementKey_(entry);
    entry.exactKey = buildExactOccurrenceKey_(entry);
    out.push(entry);
  }

  return out;
}

function validateEntryDates_(entries) {
  const invalid = entries.filter(entry => !entry.date);
  if (invalid.length === 0) return;

  for (const entry of invalid.slice(0, 20)) {
    entry.sourceSheet.getRange(entry.rowIndex, SOURCE_URL_COL).setBackground('#ffd1d1');
  }

  const sample = invalid
    .slice(0, 5)
    .map(entry => `${entry.source === 'main' ? MAIN_SHEET_NAME : ARCHIVE_SHEET_NAME} ${entry.rowIndex}行目「${entry.linkText}」`)
    .join(' / ');

  throw new Error(`日付を抽出できない行が${invalid.length}件あります。D列文頭をYYYYMMDDにしてください。例：${sample}`);
}

function validateEntryKinds_(entries) {
  const invalid = entries.filter(
    entry => !Object.prototype.hasOwnProperty.call(PRIORITY, entry.kind)
  );
  if (invalid.length === 0) return;

  for (const entry of invalid.slice(0, 20)) {
    entry.sourceSheet.getRange(entry.rowIndex, 3).setBackground('#ffd1d1');
  }

  const sample = invalid
    .slice(0, 5)
    .map(entry => `${entry.source === 'main' ? MAIN_SHEET_NAME : ARCHIVE_SHEET_NAME} ${entry.rowIndex}行目「${entry.kind}」`)
    .join(' / ');

  throw new Error(
    `区分が「歌ってみた・歌枠・ショート」のいずれでもない行が${invalid.length}件あります。例：${sample}`
  );
}

function resolveReuploadedVideos_(entries) {
  const byReplacementKey = groupBy_(entries, entry => entry.replacementKey);
  const removed = new Set();
  let replacedGroups = 0;

  for (const group of byReplacementKey.values()) {
    const urlCandidates = group
      .filter(entry => normalizeUrlForCompare_(entry.url))
      .sort(compareNewestAddition_);
    const urls = new Set(urlCandidates.map(entry => normalizeUrlForCompare_(entry.url)));
    if (urls.size <= 1) continue;

    const preferredUrl = normalizeUrlForCompare_(urlCandidates[0].url);
    let groupRemoved = 0;

    for (const entry of group) {
      const normalizedUrl = normalizeUrlForCompare_(entry.url);
      if (normalizedUrl && normalizedUrl !== preferredUrl) {
        removed.add(entry);
        groupRemoved++;
      }
    }

    if (groupRemoved > 0) replacedGroups++;
  }

  return {
    entries: entries.filter(entry => !removed.has(entry)),
    replacedGroups,
    removedRows: removed.size,
  };
}

function removeExactDuplicates_(entries) {
  const withUrl = entries.filter(entry => normalizeUrlForCompare_(entry.url));
  const byExactKey = groupBy_(withUrl, entry => entry.exactKey);
  const removed = new Set();
  const kept = [];
  let removedRows = 0;

  for (const group of byExactKey.values()) {
    group.sort(compareDuplicateRepresentative_);
    for (const duplicate of group.slice(1)) removed.add(duplicate);
  }

  for (const entry of entries) {
    if (removed.has(entry)) {
      removedRows++;
    } else {
      kept.push(entry);
    }
  }

  return { entries: kept, removedRows };
}

function placeEntriesBySong_(entries) {
  const bySong = groupBy_(entries, entry => entry.songKey);
  const mainEntries = [];
  const archiveEntries = [];

  for (const group of bySong.values()) {
    group.sort(compareWinnerCandidates_);
    mainEntries.push(group[0]);
    archiveEntries.push(...group.slice(1));
  }

  return { mainEntries, archiveEntries };
}

function compareDuplicateRepresentative_(a, b) {
  // 完全重複が区分をまたぐ場合も、歌ってみた＞歌枠＞ショートを絶対優先する。
  if (b.priority !== a.priority) return b.priority - a.priority;
  // 同一区分なら履歴にある行を既存データ、同一シートでは上の行ほど先に追加されたものとして扱う。
  if (a.source !== b.source) return a.source === 'archive' ? -1 : 1;
  return a.rowIndex - b.rowIndex;
}

function compareNewestAddition_(a, b) {
  // 日常用では前回チェックポイントより後に追記された行を新規データとして最優先する。
  if (Boolean(a.isNewlyAdded) !== Boolean(b.isNewlyAdded)) return a.isNewlyAdded ? -1 : 1;
  // アーカイブ整理時は、今回メインから移動した行を既存のアーカイブ行より新しいものとして扱う。
  if (a.source !== b.source) return a.source === 'main' ? -1 : 1;
  // 総点検では追加時刻を復元できないため、同一シートの下の行を新しいものとする。
  return b.rowIndex - a.rowIndex;
}

function compareWinnerCandidates_(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (b.dateMs !== a.dateMs) return b.dateMs - a.dateMs;
  if (a.source !== b.source) return a.source === 'main' ? -1 : 1;
  return b.rowIndex - a.rowIndex;
}

function groupBy_(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function buildKey(artist, title) {
  return `${normalizeSongText_(artist)}｜${normalizeSongText_(title)}`;
}

function buildReplacementKey_(entry) {
  const dateKey = entry.date
    ? toYYYYMMDD_(entry.date)
    : `invalid:${entry.source || 'unknown'}:${entry.rowIndex || 'unknown'}`;
  return [
    normalizeSongText_(entry.artist),
    normalizeSongText_(entry.title),
    normalizeSongText_(entry.kind),
    dateKey,
  ].join('｜');
}

function buildExactOccurrenceKey_(entry) {
  return [
    normalizeSongText_(entry.artist),
    normalizeSongText_(entry.title),
    normalizeUrlForCompare_(entry.url),
  ].join('｜');
}

function normalizeSongText_(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[‐‒–—―ー−-]/g, '-')
    .trim()
    .toLowerCase();
}

function hasDedupePlacementChanges_(beforeMain, beforeArchive, afterMain, afterArchive) {
  return serializeSheetEntries_(beforeMain, true) !== serializeSheetEntries_(afterMain, true)
    || serializeSheetEntries_(beforeArchive, false) !== serializeSheetEntries_(afterArchive, false);
}

function serializeSheetEntries_(entries, includeMainExtras) {
  return JSON.stringify((entries || []).map(entry => {
    const base = [
      String(entry.artist || ''),
      String(entry.title || ''),
      String(entry.kind || ''),
      String(entry.linkText || ''),
      normalizeUrlForCompare_(entry.url),
    ];

    if (includeMainExtras) {
      const extras = Array.isArray(entry.extraValues) ? entry.extraValues : [];
      base.push(...extras.map(serializeCellValue_));
    }
    return base;
  }));
}

function serializeCellValue_(value) {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  return String(value);
}

function createDedupeBackups_(ss, mainSheet, archiveSheet) {
  const timezone = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Tokyo';
  const timestamp = Utilities.formatDate(new Date(), timezone, 'yyyyMMdd_HHmmss');

  const targets = [mainSheet, archiveSheet];
  for (const source of targets) {
    const backupName = makeUniqueBackupSheetName_(ss, source.getName(), timestamp);
    source.copyTo(ss).setName(backupName).hideSheet();
    pruneOldBackupSheets_(ss, source.getName());
  }
}

function makeUniqueBackupSheetName_(ss, sourceName, timestamp) {
  const base = `${BACKUP_PREFIX}${sourceName}_${timestamp}`.slice(0, 95);
  if (!ss.getSheetByName(base)) return base;

  for (let suffix = 2; suffix <= 99; suffix++) {
    const candidate = `${base.slice(0, 97 - String(suffix).length)}_${suffix}`;
    if (!ss.getSheetByName(candidate)) return candidate;
  }
  throw new Error(`バックアップシート名を確保できませんでした: ${sourceName}`);
}

function pruneOldBackupSheets_(ss, sourceName) {
  const prefix = `${BACKUP_PREFIX}${sourceName}_`;
  const backups = ss.getSheets()
    .filter(sheet => sheet.getName().startsWith(prefix))
    .sort((a, b) => b.getName().localeCompare(a.getName()));

  for (const sheet of backups.slice(BACKUP_KEEP_GENERATIONS)) {
    ss.deleteSheet(sheet);
  }
}

function rewriteSongSheet_(sheet, startRow, entries, includeMainExtras) {
  const width = includeMainExtras ? Math.min(MAIN_DATA_COL_COUNT, sheet.getMaxColumns()) : COL_COUNT;
  const oldLastRow = sheet.getLastRow();
  const oldCount = Math.max(oldLastRow - startRow + 1, 0);
  const requiredLastRow = startRow + Math.max(entries.length, 1) - 1;

  ensureSheetHasRows_(sheet, requiredLastRow);

  const clearCount = Math.max(oldCount, entries.length, 1);
  sheet.getRange(startRow, 1, clearCount, width).clearContent();

  if (entries.length === 0) return;

  const output = entries.map(entry => {
    const base = [entry.artist, entry.title, entry.kind, entry.linkText];
    if (!includeMainExtras || width <= COL_COUNT) return base.slice(0, width);
    return [...base, ...entry.extraValues].slice(0, width);
  });

  sheet.getRange(startRow, 1, output.length, width).setValues(output);

  const richLinks = entries.map(entry => [buildRichLink_(entry.linkText, entry.url)]);
  sheet.getRange(startRow, SOURCE_URL_COL, entries.length, 1).setRichTextValues(richLinks);
}

function buildRichLink_(text, url) {
  const builder = SpreadsheetApp.newRichTextValue().setText(String(text || ''));
  if (url) builder.setLinkUrl(String(url));
  return builder.build();
}

function ensureSheetHasRows_(sheet, requiredLastRow) {
  const maxRows = sheet.getMaxRows();
  if (maxRows < requiredLastRow) {
    sheet.insertRowsAfter(maxRows, requiredLastRow - maxRows);
  }
}

function ensureSheetHasColumns_(sheet, requiredColumns) {
  const maxColumns = sheet.getMaxColumns();
  if (maxColumns < requiredColumns) {
    sheet.insertColumnsAfter(maxColumns, requiredColumns - maxColumns);
  }
}

function ensureArchiveHeader_(archiveSheet) {
  const header = ['アーティスト名', '曲名', '区分', '出典元情報(直リンク)'];
  const values = archiveSheet.getRange(1, 1, 1, header.length).getValues()[0];
  if (values.every(value => String(value || '').trim() === '')) {
    archiveSheet.getRange(1, 1, 1, header.length).setValues([header]);
  }
}

function ensureSheetHasRequiredColumns_(sheet, sheetName, requiredColumns) {
  const maxColumns = sheet.getMaxColumns();
  if (maxColumns < requiredColumns) {
    throw new Error(`列数不足: シート「${sheetName}」はA:Dの4列が必要です（現在${maxColumns}列）。`);
  }
}

function sortArchiveSheet_(archiveSheet) {
  if (!archiveSheet || archiveSheet.getLastRow() < ARCHIVE_START_ROW + 1) return;
  archiveSheet.getRange(ARCHIVE_START_ROW, 1, archiveSheet.getLastRow() - ARCHIVE_START_ROW + 1, COL_COUNT).sort([
    { column: 2, ascending: true },
    { column: 1, ascending: true },
    { column: 4, ascending: false },
  ]);
}

function sortMainSheet_(mainSheet) {
  if (!mainSheet || mainSheet.getLastRow() < START_ROW + 1) return;
  mainSheet.getRange(START_ROW, 1, mainSheet.getLastRow() - START_ROW + 1, Math.min(MAIN_DATA_COL_COUNT, mainSheet.getMaxColumns())).sort([
    { column: 2, ascending: true },
    { column: 1, ascending: true },
    { column: 4, ascending: false },
  ]);
}

function parseHeadDate(value) {
  const text = String(value || '').trim();
  const patterns = [
    /^\s*(\d{4})(\d{2})(\d{2})\b/,
    /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\b/,
    /^\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\b/,
    /^\s*(\d{4})\.(\d{1,2})\.(\d{1,2})\b/,
    /^\s*(\d{4})年(\d{1,2})月(\d{1,2})日?/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return date;
    }
  }

  return null;
}

function parseMaintenanceHeadDate_(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

function toISO_(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toYYYYMMDD_(date) {
  return toISO_(date).replace(/-/g, '');
}

function extractFirstUrlFromRichText_(richTextValue) {
  if (!richTextValue) return null;
  try {
    const whole = richTextValue.getLinkUrl();
    if (whole) return whole;
    const runs = richTextValue.getRuns ? richTextValue.getRuns() : [];
    for (const run of runs) {
      const url = run.getLinkUrl && run.getLinkUrl();
      if (url) return url;
    }
  } catch (error) {}
  return null;
}

function extractUrlFromCell_(richTextValue, formula, displayText) {
  return extractFirstUrlFromRichText_(richTextValue)
    || extractUrlFromHyperlinkFormula_(formula)
    || extractUrlFromText_(displayText)
    || null;
}

function extractUrlFromHyperlinkFormula_(formula) {
  const text = String(formula || '').trim();
  if (!text) return null;
  let match = text.match(/HYPERLINK\(\s*"([^"]+)"\s*[,;]/i);
  if (match && match[1]) return match[1];
  match = text.match(/HYPERLINK\(\s*(https?:\/\/[^,;\s)]+)\s*[,;]/i);
  return match && match[1] ? match[1] : null;
}

function extractUrlFromText_(text) {
  const match = String(text || '').match(/https?:\/\/[^\s]+/i);
  return match ? match[0].trim() : null;
}

function normalizeUrlForCompare_(url) {
  return String(url || '').trim();
}

function extractVideoIdFromUrl_(url) {
  const text = String(url || '').trim();
  if (!text) return null;

  const patterns = [
    /https?:\/\/(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /https?:\/\/(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /https?:\/\/(?:www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
    /https?:\/\/(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractTimestampSeconds_(url, linkText) {
  const fromUrl = extractTimestampSecondsFromUrl_(url);
  return fromUrl !== Number.MAX_SAFE_INTEGER ? fromUrl : extractTimestampSecondsFromText_(linkText);
}

function extractTimestampSecondsFromUrl_(url) {
  const text = String(url || '').trim();
  if (!text) return Number.MAX_SAFE_INTEGER;

  let match = text.match(/[?&#]t=(\d+)(?:s)?(?:[&#]|$)/i);
  if (match) return Number(match[1]);
  match = text.match(/[?&#](?:start|time_continue)=(\d+)(?:[&#]|$)/i);
  if (match) return Number(match[1]);
  match = text.match(/[?&#]t=(\d+)h(\d+)m(\d+)s?(?:[&#]|$)/i);
  if (match) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  match = text.match(/[?&#]t=(\d+)m(\d+)s?(?:[&#]|$)/i);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  return Number.MAX_SAFE_INTEGER;
}

function extractTimestampSecondsFromText_(text) {
  const match = String(text || '').match(/(^|\s)(\d{1,2}:\d{1,2}(?::\d{1,2})?)(?=\s|$)/);
  return match ? timestampTextToSeconds_(match[2]) : Number.MAX_SAFE_INTEGER;
}

function updateReleaseYears() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MAIN_SHEET_NAME);
  if (!sheet) throw new Error(`シート「${MAIN_SHEET_NAME}」が見つかりません。`);
  const lastRow = sheet.getLastRow();
  if (lastRow < START_ROW) return;
  processReleaseYearsForRows_(sheet, START_ROW, lastRow - START_ROW + 1);
  ensureYearHeaderAndBorders_(sheet);
}

function updateReleaseYearsForSelection() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MAIN_SHEET_NAME);
  if (!sheet) throw new Error(`シート「${MAIN_SHEET_NAME}」が見つかりません。`);
  const range = sheet.getActiveRange();
  if (!range) return;
  const startRow = Math.max(range.getRow(), START_ROW);
  const endRow = Math.min(range.getLastRow(), sheet.getLastRow());
  if (endRow >= startRow) {
    processReleaseYearsForRows_(sheet, startRow, endRow - startRow + 1);
    ensureYearHeaderAndBorders_(sheet);
  }
}

function processReleaseYearsForRows_(sheet, startRow, numRows) {
  if (numRows <= 0) return;
  const values = sheet.getRange(startRow, 1, numRows, MAIN_DATA_COL_COUNT).getValues();
  const output = [];
  for (const row of values) {
    const artist = row[0];
    const title = row[1];
    let year = row[4];
    let era = row[5];
    if (artist && title && !year) {
      year = fetchReleaseYearFromMusicBrainz(artist, title);
      if (year) Utilities.sleep(1100);
    }
    if (year && !era) era = getJapaneseEraFromYear(year);
    output.push([year || '', era || '']);
  }
  sheet.getRange(startRow, 5, numRows, 2).setValues(output);
}

function fetchReleaseYearFromMusicBrainz(artist, title) {
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`)}&fmt=json&limit=1`;
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'SongYearFetcher/1.1 (https://github.com/PerformanceRecord/kasane-3khz-songsDB)' },
    });
    if (response.getResponseCode() !== 200) return '';
    const data = JSON.parse(response.getContentText());
    if (!data.recordings || data.recordings.length === 0) return '';
    const recording = data.recordings[0];
    const date = recording['first-release-date'] || (recording.releases && recording.releases[0] && recording.releases[0].date);
    const year = Number(String(date || '').slice(0, 4));
    return Number.isFinite(year) ? year : '';
  } catch (error) {
    return '';
  }
}

function getJapaneseEraFromYear(year) {
  const value = Number(year);
  if (!Number.isFinite(value)) return '';
  if (value >= 2019) return '令和';
  if (value >= 1989) return '平成';
  if (value >= 1926) return '昭和';
  return '';
}

function ensureYearHeaderAndBorders_(sheet) {
  const headerRow = START_ROW - 1;
  sheet.getRange(headerRow, 5).setValue('発表年');
  sheet.getRange(headerRow, 6).setValue('元号');
  const lastRow = sheet.getLastRow();
  if (lastRow >= headerRow) {
    sheet.getRange(headerRow, 5, lastRow - headerRow + 1, 2).setBorder(true, true, true, true, true, true);
  }
}

function checkApproximateSongInfo() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActive();
    const main = ss.getSheetByName(MAIN_SHEET_NAME);
    const archive = ss.getSheetByName(ARCHIVE_SHEET_NAME);
    if (!main) throw new Error(`シート「${MAIN_SHEET_NAME}」が見つかりません。`);
    if (!archive) throw new Error(`シート「${ARCHIVE_SHEET_NAME}」が見つかりません。`);

    const entries = [
      ...readSongEntries_(main, START_ROW, 'main', true),
      ...readSongEntries_(archive, ARCHIVE_START_ROW, 'archive', false),
    ];
    const findings = findApproximateSongPairs_(entries, APPROX_SIMILARITY_THRESHOLD);
    const header = [
      '判定理由',
      '最低類似度',
      '歌手名類似度',
      '楽曲名類似度',
      'データ1シート',
      'データ1行',
      'データ1歌手名',
      'データ1楽曲名',
      'データ1区分',
      'データ1表示文言',
      'データ1URL',
      'データ2シート',
      'データ2行',
      'データ2歌手名',
      'データ2楽曲名',
      'データ2区分',
      'データ2表示文言',
      'データ2URL',
    ];
    const rows = findings.map(finding => formatApproximateFindingRow_(finding));

    let outputSheet = ss.getSheetByName(APPROX_CHECK_SHEET_NAME);
    if (!outputSheet) outputSheet = ss.insertSheet(APPROX_CHECK_SHEET_NAME);
    ensureSheetHasRows_(outputSheet, Math.max(rows.length + 1, 2));
    ensureSheetHasColumns_(outputSheet, header.length);
    outputSheet.clearContents();
    outputSheet.clearFormats();
    outputSheet.getRange(1, 1, 1, header.length).setValues([header]);
    outputSheet.getRange(1, 1, 1, header.length)
      .setFontWeight('bold')
      .setBackground('#d9ead3');

    if (rows.length > 0) {
      outputSheet.getRange(2, 1, rows.length, header.length).setValues(rows);
      outputSheet.getRange(2, 2, rows.length, 3).setNumberFormat('0%');
      outputSheet.getRange(2, 1, rows.length, header.length).setVerticalAlignment('top');
    }

    outputSheet.setFrozenRows(1);
    outputSheet.autoResizeColumns(1, 9);
    outputSheet.setColumnWidth(10, 280);
    outputSheet.setColumnWidth(11, 280);
    outputSheet.setColumnWidth(17, 280);
    outputSheet.setColumnWidth(18, 280);
    outputSheet.getRange(1, 1, Math.max(rows.length + 1, 2), header.length).setWrap(true);

    ss.toast(`近似情報チェック完了：要確認=${rows.length}組`, '近似情報チェック', 8);
  } finally {
    lock.releaseLock();
  }
}

function findApproximateSongPairs_(entries, threshold) {
  const prepared = entries.map(entry => ({
    entry,
    artistLoose: normalizeApproximateText_(entry.artist),
    titleLoose: normalizeApproximateText_(entry.title),
    url: normalizeUrlForCompare_(entry.url),
  }));
  const findings = [];
  const similarityCache = new Map();

  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const left = prepared[i];
      const right = prepared[j];
      const reasons = [];
      const sameSongKey = left.entry.songKey === right.entry.songKey;
      const swapped = !sameSongKey
        && left.artistLoose
        && left.titleLoose
        && left.artistLoose === right.titleLoose
        && left.titleLoose === right.artistLoose;
      const separatorOnly = !sameSongKey
        && left.artistLoose
        && left.titleLoose
        && left.artistLoose === right.artistLoose
        && left.titleLoose === right.titleLoose;
      const sameUrl = !sameSongKey
        && left.url
        && left.url === right.url;

      if (sameSongKey && left.entry.source === 'main' && right.entry.source === 'main') {
        reasons.push('A+B完全一致（メイン内残存）');
      }
      if (swapped) reasons.push('歌手名と楽曲名のテレコ');
      if (separatorOnly) reasons.push('空白・区切り記号を除くと一致');

      let artistSimilarity = null;
      let titleSimilarity = null;
      const canCompareFuzzy = !sameSongKey
        && !separatorOnly
        && !swapped
        && canReachSimilarityThreshold_(left.artistLoose, right.artistLoose, threshold)
        && canReachSimilarityThreshold_(left.titleLoose, right.titleLoose, threshold);

      if (canCompareFuzzy) {
        artistSimilarity = calculateCachedSimilarity_(
          left.artistLoose,
          right.artistLoose,
          similarityCache
        );
        if (artistSimilarity >= threshold) {
          titleSimilarity = calculateCachedSimilarity_(
            left.titleLoose,
            right.titleLoose,
            similarityCache
          );
          if (titleSimilarity >= threshold) reasons.push(`歌手名・楽曲名が各${Math.round(threshold * 100)}%以上一致`);
        }
      }

      if (sameUrl) reasons.push('A+B不一致・完全URL一致');
      if (reasons.length === 0) continue;

      if (artistSimilarity === null) {
        artistSimilarity = calculateCachedSimilarity_(
          left.artistLoose,
          right.artistLoose,
          similarityCache
        );
      }
      if (titleSimilarity === null) {
        titleSimilarity = calculateCachedSimilarity_(
          left.titleLoose,
          right.titleLoose,
          similarityCache
        );
      }

      findings.push({
        reasons,
        artistSimilarity,
        titleSimilarity,
        minimumSimilarity: Math.min(artistSimilarity, titleSimilarity),
        left: left.entry,
        right: right.entry,
      });
    }
  }

  return findings;
}

function formatApproximateFindingRow_(finding) {
  return [
    finding.reasons.join(' / '),
    finding.minimumSimilarity,
    finding.artistSimilarity,
    finding.titleSimilarity,
    songEntrySourceLabel_(finding.left),
    finding.left.rowIndex,
    finding.left.artist,
    finding.left.title,
    finding.left.kind,
    finding.left.linkText,
    finding.left.url,
    songEntrySourceLabel_(finding.right),
    finding.right.rowIndex,
    finding.right.artist,
    finding.right.title,
    finding.right.kind,
    finding.right.linkText,
    finding.right.url,
  ];
}

function songEntrySourceLabel_(entry) {
  return entry.source === 'main' ? MAIN_SHEET_NAME : ARCHIVE_SHEET_NAME;
}

function normalizeApproximateText_(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u200b-\u200d\u2060\ufeff]+/g, '')
    .replace(/[‐‑‒–—―−-]+/g, '')
    .replace(/[・･_＿/／]+/g, '');
}

function canReachSimilarityThreshold_(left, right, threshold) {
  if (!left || !right) return false;
  const longerLength = Math.max(left.length, right.length);
  return Math.min(left.length, right.length) / longerLength >= threshold;
}

function calculateCachedSimilarity_(left, right, cache) {
  if (!left || !right) return 0;
  const cacheKey = left <= right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
  if (!cache.has(cacheKey)) cache.set(cacheKey, calculateStringSimilarity_(left, right));
  return cache.get(cacheKey);
}

function calculateStringSimilarity_(left, right) {
  if (left === right) return left ? 1 : 0;
  if (!left || !right) return 0;

  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  const previous = Array.from({ length: rightChars.length + 1 }, (_, index) => index);
  const current = new Array(rightChars.length + 1);

  for (let i = 1; i <= leftChars.length; i++) {
    current[0] = i;
    for (let j = 1; j <= rightChars.length; j++) {
      const substitutionCost = leftChars[i - 1] === rightChars[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost
      );
    }
    for (let j = 0; j <= rightChars.length; j++) previous[j] = current[j];
  }

  const distance = previous[rightChars.length];
  return 1 - distance / Math.max(leftChars.length, rightChars.length);
}

function createSongStatistics() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sources = [
    { sheetName: MAIN_SHEET_NAME, startRow: START_ROW },
    { sheetName: ARCHIVE_SHEET_NAME, startRow: ARCHIVE_START_ROW },
  ];
  const statMap = new Map();

  for (const config of sources) {
    const sheet = ss.getSheetByName(config.sheetName);
    if (!sheet || sheet.getLastRow() < config.startRow) continue;
    const values = sheet.getRange(config.startRow, 1, sheet.getLastRow() - config.startRow + 1, 3).getValues();
    for (const row of values) {
      const artist = String(row[0] || '').trim();
      const title = String(row[1] || '').trim();
      const kind = String(row[2] || '').trim();
      if (!artist && !title) continue;
      if (kind !== '歌枠' && kind !== 'ショート') continue;
      const key = buildKey(artist, title);
      if (!statMap.has(key)) statMap.set(key, { artist, title, total: 0, utawake: 0, short: 0 });
      const stat = statMap.get(key);
      stat.total++;
      if (kind === '歌枠') stat.utawake++;
      if (kind === 'ショート') stat.short++;
    }
  }

  const resultRows = [...statMap.values()].sort((a, b) => b.total - a.total || a.artist.localeCompare(b.artist, 'ja') || a.title.localeCompare(b.title, 'ja'));
  const output = [
    ['アーティスト', '曲名', '合計(歌枠+ショート)', '歌枠のみ', 'ショートのみ'],
    ...resultRows.map(row => [row.artist, row.title, row.total, row.utawake, row.short]),
  ];

  let sheet = ss.getSheetByName(STATS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(STATS_SHEET_NAME);
  sheet.clearContents();
  sheet.clearFormats();
  sheet.getRange(1, 1, output.length, output[0].length).setValues(output);
  sheet.getRange(1, 1, 1, output[0].length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, output[0].length);
  ss.toast(`統計シート更新：${resultRows.length}曲を集計しました。`, '統計', 5);
}

function normalizeTimestampText_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return `${value.getHours()}:${String(value.getMinutes()).padStart(2, '0')}:${String(value.getSeconds()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    const seconds = Math.floor(value * 86400);
    return `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  const match = String(value || '').trim().match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return '';
  return `${Number(match[1])}:${String(Number(match[2])).padStart(2, '0')}:${String(Number(match[3] || 0)).padStart(2, '0')}`;
}

function timestampTextToSeconds_(value) {
  const normalized = normalizeTimestampText_(value);
  if (!normalized) return Number.MAX_SAFE_INTEGER;
  const parts = normalized.split(':').map(Number);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
