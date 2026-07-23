/**
 * 花彩音 3kHz 歌唱曲DB
 * 仕分け／統計／動画監査／統合一覧：統合版
 *
 * 主な仕様
 * - 「歌った曲リスト」と「アーカイブ」を横断して重複を整理する
 * - 再アップロードは、同一アーティスト×同一曲名×同一区分×同一投稿日で後から追加されたURLを正とする
 * - A列＋B列＋D列表示文言＋D列URLの完全重複は、先に追加された1件だけ残す
 * - 同一アーティスト×同一曲名は、区分優先度の最も高いものをメインへ配置する
 * - 同一区分ならD列表示文言の文頭から抽出した投稿日が新しいものをメインへ、残りをアーカイブへ配置する
 * - 日常用は前回処理後にメイン末尾へ追加された行の楽曲だけを照合する
 * - 総点検用は両シート全件を再評価し、配置異常も含めて訂正する
 * - 並び順は 曲名昇順 → アーティスト名昇順 → 日付降順
 */

const MAIN_SHEET_NAME = '歌った曲リスト';
const GAGS_SHEET_NAME = '企画/一発ネタシリーズ';
const ARCHIVE_SHEET_NAME = 'アーカイブ';
const UNIFIED_LIST_SHEET_NAME = '一覧';
const STATS_SHEET_NAME = '統計';
const VIDEO_HISTORY_SHEET_NAME = '動画履歴チェック';

const START_ROW = 4;
const ARCHIVE_START_ROW = 2;
const COL_COUNT = 4;
const MAIN_DATA_COL_COUNT = 6;
const SOURCE_URL_COL = 4;
const BACKUP_PREFIX = '_backup_';
const BACKUP_KEEP_GENERATIONS = 5;
const DAILY_LAST_MAIN_ROW_KEY = 'songMaintenance.lastMainDataRow';

const PRIORITY = {
  '歌ってみた': 3,
  '歌枠': 2,
  'ショート': 1,
};

const VH_HISTORY_START_COL = 1;
const VH_HISTORY_COLS = 3;
const VH_GAP_COL = 4;
const VH_LOGGED_START_COL = 5;
const VH_LOGGED_COLS = 4;
const VH_HISTORY_HEADER = ['upload_yyyymmdd', 'title', 'videoId'];
const VH_LOGGED_HEADER = ['logged_upload_yyyymmdd', 'logged_title', 'logged_videoId', 'logged_url'];

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('仕分け')
    .addItem('新規追加分を仕分け（日常用）', 'classifyNewSongEntries')
    .addItem('全件を総点検・訂正', 'auditAllSongEntries')
    .addItem('一覧シートを再構築', 'updateUnifiedListSheet')
    .addSeparator()
    .addItem('統計シートを更新', 'createSongStatistics')
    .addToUi();

  ui.createMenu('動画監査')
    .addItem('動画履歴チェック：記帳済み動画一覧をE列に再生成', 'rebuildLoggedVideoListOnVideoHistorySheet')
    .addItem('動画履歴チェック：既に記帳済みを削除して未記帳だけ残す', 'pruneVideoHistoryCheck')
    .addItem('動画履歴チェック：未記帳だけを別シートに出力（安全版）', 'exportMissingToSheet')
    .addToUi();
}

function dedupeAndArchive() {
  return auditAllSongEntries();
}

function classifyNewSongEntries() {
  const properties = PropertiesService.getDocumentProperties();
  return runSongMaintenance_({
    mode: 'daily',
    properties,
  });
}

function auditAllSongEntries() {
  return runSongMaintenance_({
    mode: 'audit',
    properties: PropertiesService.getDocumentProperties(),
  });
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
    const lastMainDataRow = options.mode === 'daily'
      ? readDailyCheckpoint_(properties)
      : null;

    if (allEntries.length === 0) {
      saveDailyCheckpoint_(properties, mainEntries);
      ss.toast('整理対象のデータがありません。', '仕分け', 5);
      return;
    }

    let targetSongKeys = null;
    let newMainEntries = [];

    if (options.mode === 'daily') {
      const currentLastMainRow = getLastEntryRow_(mainEntries, START_ROW - 1);
      if (currentLastMainRow < lastMainDataRow) {
        throw new Error('歌った曲リストの行数が前回処理時より減っています。「全件を総点検・訂正」を実行してください。');
      }

      newMainEntries = mainEntries.filter(entry => entry.rowIndex > lastMainDataRow);
      if (newMainEntries.length === 0) {
        ss.toast('前回処理後に追加された新規データはありません。', '日常用仕分け', 5);
        return;
      }
      targetSongKeys = new Set(newMainEntries.map(entry => entry.songKey));
    }

    const scopedEntries = targetSongKeys
      ? allEntries.filter(entry => targetSongKeys.has(entry.songKey))
      : allEntries;

    validateEntryDates_(scopedEntries);
    validateEntryKinds_(scopedEntries);

    const result = buildMaintenancePlacement_(mainEntries, archiveEntries, targetSongKeys);
    const placement = result.placement;

    placement.mainEntries.sort(compareSheetOrder_);
    placement.archiveEntries.sort(compareSheetOrder_);

    if (!hasDedupePlacementChanges_(
      mainEntries,
      archiveEntries,
      placement.mainEntries,
      placement.archiveEntries
    )) {
      saveDailyCheckpoint_(properties, mainEntries);
      const title = options.mode === 'daily' ? '日常用仕分け' : '総点検';
      const message = options.mode === 'daily'
        ? `新規${newMainEntries.length}行を確認しました。移動・削除対象はありません。`
        : '異常はありません。バックアップと書換えを省略しました。';
      ss.toast(message, title, 6);
      return;
    }

    createDedupeBackups_(ss, main, archive);

    rewriteSongSheet_(main, START_ROW, placement.mainEntries, true);
    rewriteSongSheet_(archive, ARCHIVE_START_ROW, placement.archiveEntries, false);

    clearConditionalFormatting_(archive);
    saveDailyCheckpoint_(properties, placement.mainEntries, true);

    ss.toast(
      [
        options.mode === 'daily' ? `新規確認=${newMainEntries.length}行` : '全件確認',
        `再アップロード置換=${result.replacement.replacedGroups}組`,
        `旧リンク除外=${result.replacement.removedRows}行`,
        `完全重複除外=${result.exact.removedRows}行`,
        `歌唱曲=${placement.mainEntries.length}行`,
        `履歴=${placement.archiveEntries.length}行`,
      ].join('、'),
      options.mode === 'daily' ? '日常用仕分け完了' : '総点検完了',
      10
    );
  } finally {
    lock.releaseLock();
  }
}

function buildMaintenancePlacement_(mainEntries, archiveEntries, targetSongKeys) {
  const isTarget = entry => !targetSongKeys || targetSongKeys.has(entry.songKey);
  const targetEntries = [...mainEntries, ...archiveEntries].filter(isTarget);
  const untouchedMain = targetSongKeys ? mainEntries.filter(entry => !isTarget(entry)) : [];
  const untouchedArchive = targetSongKeys ? archiveEntries.filter(entry => !isTarget(entry)) : [];

  const replacement = resolveReuploadedVideos_(targetEntries);
  const exact = removeExactDuplicates_(replacement.entries);
  const scopedPlacement = placeEntriesBySong_(exact.entries);

  return {
    replacement,
    exact,
    placement: {
      mainEntries: [...untouchedMain, ...scopedPlacement.mainEntries],
      archiveEntries: [...untouchedArchive, ...scopedPlacement.archiveEntries],
    },
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
    throw new Error('日常用仕分けの初回実行前に「全件を総点検・訂正」を実行してください。');
  }

  const lastMainDataRow = Number(checkpointText);
  if (!Number.isInteger(lastMainDataRow) || lastMainDataRow < START_ROW - 1) {
    throw new Error('日常用仕分けの基準位置が不正です。「全件を総点検・訂正」を実行し直してください。');
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
    const date = parseHeadDate(linkText);
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
  const byExactKey = groupBy_(entries, entry => entry.exactKey);
  const kept = [];
  let removedRows = 0;

  for (const group of byExactKey.values()) {
    group.sort(compareDuplicateRepresentative_);
    kept.push(group[0]);
    removedRows += Math.max(group.length - 1, 0);
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
  // 再アップロードはメインへ追記する運用を優先し、同一シートでは下の行ほど新しいものとする。
  if (a.source !== b.source) return a.source === 'main' ? -1 : 1;
  return b.rowIndex - a.rowIndex;
}

function compareWinnerCandidates_(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (b.dateMs !== a.dateMs) return b.dateMs - a.dateMs;
  if (a.source !== b.source) return a.source === 'main' ? -1 : 1;
  return b.rowIndex - a.rowIndex;
}

function compareSheetOrder_(a, b) {
  const titleCompare = normalizeSongText_(a.title).localeCompare(normalizeSongText_(b.title), 'ja');
  if (titleCompare !== 0) return titleCompare;

  const artistCompare = normalizeSongText_(a.artist).localeCompare(normalizeSongText_(b.artist), 'ja');
  if (artistCompare !== 0) return artistCompare;

  if (b.dateMs !== a.dateMs) return b.dateMs - a.dateMs;
  if (b.priority !== a.priority) return b.priority - a.priority;
  return normalizeUrlForCompare_(a.url).localeCompare(normalizeUrlForCompare_(b.url));
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
  return [
    normalizeSongText_(entry.artist),
    normalizeSongText_(entry.title),
    normalizeSongText_(entry.kind),
    entry.date ? toYYYYMMDD_(entry.date) : String(entry.dateMs || ''),
  ].join('｜');
}

function buildExactOccurrenceKey_(entry) {
  return [
    normalizeSongText_(entry.artist),
    normalizeSongText_(entry.title),
    normalizeDisplayText_(entry.linkText),
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

function normalizeDisplayText_(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
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

function clearConditionalFormatting_(sheet) {
  if (sheet && sheet.getConditionalFormatRules().length > 0) {
    sheet.setConditionalFormatRules([]);
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

function extractVideoIdLoose_(value) {
  const match = String(value || '').match(/([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : '';
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

function extractTitleFromDisplayText_(value) {
  return String(value || '').trim()
    .replace(/^\s*(\d{4})(\d{2})(\d{2})\b\s*/, '')
    .replace(/^\s*(\d{4})-(\d{1,2})-(\d{1,2})\b\s*/, '')
    .replace(/^\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\b\s*/, '')
    .replace(/^\s*(\d{4})\.(\d{1,2})\.(\d{1,2})\b\s*/, '')
    .replace(/^\s*(\d{4})年(\d{1,2})月(\d{1,2})日?\s*/, '')
    .replace(/^[\s\-–—_:：|｜]+/, '')
    .trim();
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

function ensureVideoHistoryLayout_(sheet) {
  const current = sheet.getRange(1, VH_HISTORY_START_COL, 1, VH_HISTORY_COLS).getValues()[0];
  if (current.every(value => String(value || '').trim() === '')) {
    sheet.getRange(1, VH_HISTORY_START_COL, 1, VH_HISTORY_COLS).setValues([VH_HISTORY_HEADER]);
  }
  sheet.getRange(1, VH_GAP_COL).setValue('');
  sheet.getRange(1, VH_LOGGED_START_COL, 1, VH_LOGGED_COLS).setValues([VH_LOGGED_HEADER]);
  sheet.setFrozenRows(1);
}

function rebuildLoggedVideoListOnVideoHistorySheet() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(VIDEO_HISTORY_SHEET_NAME);
  if (!sheet) throw new Error(`シート「${VIDEO_HISTORY_SHEET_NAME}」が見つかりません。`);
  ensureVideoHistoryLayout_(sheet);
  const loggedMap = collectLoggedVideosMap_();
  writeLoggedVideosToE_(sheet, loggedMap);
  ss.toast(`記帳済み動画一覧を再生成しました：${loggedMap.size}件`, '動画監査', 6);
}

function pruneVideoHistoryCheck() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(VIDEO_HISTORY_SHEET_NAME);
  if (!sheet) throw new Error(`シート「${VIDEO_HISTORY_SHEET_NAME}」が見つかりません。`);
  ensureVideoHistoryLayout_(sheet);
  const loggedMap = collectLoggedVideosMap_();
  writeLoggedVideosToE_(sheet, loggedMap);
  const loggedSet = new Set(loggedMap.keys());
  const lastRow = Math.max(sheet.getLastRow(), 2);
  const range = sheet.getRange(2, VH_HISTORY_START_COL, lastRow - 1, VH_HISTORY_COLS);
  const values = range.getValues();
  const kept = [];
  let removed = 0;
  let unknown = 0;
  for (const row of values) {
    if (row.every(value => String(value || '').trim() === '')) continue;
    const videoId = extractVideoIdLoose_(row[2]) || extractVideoIdLoose_(row.join(' '));
    if (!videoId) {
      kept.push(row);
      unknown++;
    } else if (loggedSet.has(videoId)) {
      removed++;
    } else {
      kept.push(row);
    }
  }
  range.clearContent();
  if (kept.length > 0) sheet.getRange(2, VH_HISTORY_START_COL, kept.length, VH_HISTORY_COLS).setValues(kept);
  ss.toast(`完了：除外=${removed}行、未記帳候補=${kept.length}行、videoId不明=${unknown}行`, '動画監査', 8);
}

function exportMissingToSheet() {
  const ss = SpreadsheetApp.getActive();
  const sourceSheet = ss.getSheetByName(VIDEO_HISTORY_SHEET_NAME);
  if (!sourceSheet) throw new Error(`シート「${VIDEO_HISTORY_SHEET_NAME}」が見つかりません。`);
  ensureVideoHistoryLayout_(sourceSheet);
  const loggedMap = collectLoggedVideosMap_();
  writeLoggedVideosToE_(sourceSheet, loggedMap);
  const loggedSet = new Set(loggedMap.keys());
  const lastRow = Math.max(sourceSheet.getLastRow(), 2);
  const values = sourceSheet.getRange(2, VH_HISTORY_START_COL, lastRow - 1, VH_HISTORY_COLS).getValues();
  const output = [[...VH_HISTORY_HEADER, 'url']];
  let unknown = 0;
  for (const row of values) {
    if (row.every(value => String(value || '').trim() === '')) continue;
    const videoId = extractVideoIdLoose_(row[2]) || extractVideoIdLoose_(row.join(' '));
    if (!videoId) {
      output.push([...row, '']);
      unknown++;
    } else if (!loggedSet.has(videoId)) {
      output.push([...row, `https://www.youtube.com/watch?v=${videoId}`]);
    }
  }
  let outputSheet = ss.getSheetByName('未記帳動画');
  if (!outputSheet) outputSheet = ss.insertSheet('未記帳動画');
  outputSheet.clearContents();
  outputSheet.getRange(1, 1, output.length, output[0].length).setValues(output);
  outputSheet.setFrozenRows(1);
  outputSheet.autoResizeColumns(1, output[0].length);
  ss.toast(`未記帳動画：${output.length - 1}件（うちvideoId不明=${unknown}件）`, '動画監査', 6);
}

function collectLoggedVideosMap_() {
  const ss = SpreadsheetApp.getActive();
  const map = new Map();
  const main = ss.getSheetByName(MAIN_SHEET_NAME);
  if (main) collectLoggedVideosFromSheet_(main, START_ROW, map);
  const archive = ss.getSheetByName(ARCHIVE_SHEET_NAME);
  if (archive) collectLoggedVideosFromSheet_(archive, ARCHIVE_START_ROW, map);
  return map;
}

function collectLoggedVideosFromSheet_(sheet, startRow, outMap) {
  const lastRow = sheet.getLastRow();
  if (lastRow < startRow) return;
  const numRows = lastRow - startRow + 1;
  const range = sheet.getRange(startRow, SOURCE_URL_COL, numRows, 1);
  const values = range.getDisplayValues();
  const richValues = range.getRichTextValues();
  const formulas = range.getFormulas();
  for (let i = 0; i < numRows; i++) {
    const displayText = String(values[i][0] || '').trim();
    const url = extractUrlFromCell_(richValues[i][0], formulas[i][0], displayText);
    const videoId = extractVideoIdFromUrl_(url);
    if (!videoId) continue;
    const date = parseHeadDate(displayText);
    const item = { yyyymmdd: date ? toYYYYMMDD_(date) : '', title: extractTitleFromDisplayText_(displayText), url };
    const previous = outMap.get(videoId);
    if (!previous || (!previous.yyyymmdd && item.yyyymmdd) || item.yyyymmdd > previous.yyyymmdd) outMap.set(videoId, item);
  }
}

function writeLoggedVideosToE_(sheet, loggedMap) {
  const rows = [...loggedMap.entries()]
    .map(([videoId, item]) => [item.yyyymmdd || '', item.title || '', videoId, item.url || ''])
    .sort((a, b) => String(b[0]).localeCompare(String(a[0])) || String(a[1]).localeCompare(String(b[1]), 'ja'));
  const lastRow = Math.max(sheet.getLastRow(), 2);
  sheet.getRange(2, VH_LOGGED_START_COL, lastRow - 1, VH_LOGGED_COLS).clearContent();
  if (rows.length > 0) sheet.getRange(2, VH_LOGGED_START_COL, rows.length, VH_LOGGED_COLS).setValues(rows);
}

function updateUnifiedListSheet() {
  const ss = SpreadsheetApp.getActive();
  const sources = [
    { name: MAIN_SHEET_NAME, startRow: START_ROW },
    { name: GAGS_SHEET_NAME, startRow: START_ROW },
    { name: ARCHIVE_SHEET_NAME, startRow: ARCHIVE_START_ROW },
  ];
  const header = ['アーティスト名', '曲名', '区分', '出典元情報(直リンク)', '投稿日', 'タイムスタンプ', '動画URL'];
  const rows = [];
  const seen = new Set();

  for (const source of sources) {
    const sheet = ss.getSheetByName(source.name);
    if (!sheet || sheet.getLastRow() < source.startRow) continue;
    const numRows = sheet.getLastRow() - source.startRow + 1;
    const range = sheet.getRange(source.startRow, 1, numRows, COL_COUNT);
    const values = range.getDisplayValues();
    const richValues = range.getRichTextValues();
    const formulas = range.getFormulas();
    for (let i = 0; i < numRows; i++) {
      const artist = String(values[i][0] || '').trim();
      const title = String(values[i][1] || '').trim();
      const kind = String(values[i][2] || '').trim();
      const linkText = String(values[i][3] || '').trim();
      if (!artist && !title && !kind && !linkText) continue;
      const url = extractUrlFromCell_(richValues[i][3], formulas[i][3], linkText) || '';
      const posted = parseHeadDate(linkText) || '';
      const timestampSerial = secondsToTimeSerial_(extractTimestampSeconds_(url, linkText));
      const uniqueKey = makeUnifiedRowUniqueKey_(artist, title, kind, url, posted, timestampSerial);
      if (seen.has(uniqueKey)) continue;
      rows.push([artist, title, kind, linkText, posted, timestampSerial, url]);
      seen.add(uniqueKey);
    }
  }

  rows.sort((a, b) => normalizeDateText_(b[4]).localeCompare(normalizeDateText_(a[4])) || timestampTextToSeconds_(a[5]) - timestampTextToSeconds_(b[5]));
  let listSheet = ss.getSheetByName(UNIFIED_LIST_SHEET_NAME);
  if (!listSheet) listSheet = ss.insertSheet(UNIFIED_LIST_SHEET_NAME);
  listSheet.clearContents();
  listSheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (rows.length > 0) {
    listSheet.getRange(2, 1, rows.length, header.length).setValues(rows);
    listSheet.getRange(2, 5, rows.length, 1).setNumberFormat('yyyy/mm/dd');
    listSheet.getRange(2, 6, rows.length, 1).setNumberFormat('[h]:mm:ss');
  }
  listSheet.setFrozenRows(1);
  listSheet.autoResizeColumns(1, header.length);
  ss.toast(`一覧シート再構築完了：${rows.length}件`, '仕分け', 6);
}

function makeUnifiedRowUniqueKey_(artist, title, kind, url, posted, timestamp) {
  return [normalizeSongText_(artist), normalizeSongText_(title), normalizeSongText_(kind), normalizeUrlForCompare_(url), normalizeDateText_(posted), normalizeTimestampText_(timestamp)].join('｜');
}

function secondsToTimeSerial_(seconds) {
  if (!Number.isFinite(seconds) || seconds === Number.MAX_SAFE_INTEGER || seconds < 0) return '';
  return Math.floor(seconds) / 86400;
}

function normalizeDateText_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return `${value.getFullYear()}/${String(value.getMonth() + 1).padStart(2, '0')}/${String(value.getDate()).padStart(2, '0')}`;
  }
  const match = String(value || '').trim().match(/^(\d{4})[\/-]?(\d{2})[\/-]?(\d{2})$/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : '';
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
