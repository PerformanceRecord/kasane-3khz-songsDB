/**
 * ==============================
 * 定数定義（仕分け／発表年／統計／動画監査：統合版）
 * ==============================
 */
const MAIN_SHEET_NAME = '歌った曲リスト';
const GAGS_SHEET_NAME = '企画/一発ネタシリーズ';
const ARCHIVE_SHEET_NAME = 'アーカイブ';
const UNIFIED_LIST_SHEET_NAME = '一覧';
const START_ROW = 4;         // メインのデータ開始行（4行目）
const COL_COUNT = 4;         // A-D：アーティスト名 / 曲名 / 区分 / 出典元情報(直リンク)

// 統計シート名
const STATS_SHEET_NAME = '統計';

// 区分の優先度（高いほど強い）
const PRIORITY = {
  '歌ってみた': 3,
  '歌枠': 2,
  'ショート': 1,
};

/**
 * ==============================
 * 追加：動画監査（Python CSV → 動画履歴チェック）
 * ==============================
 */
const VIDEO_HISTORY_SHEET_NAME = '動画履歴チェック';

// アーカイブ側のデータ開始行（ヘッダー1行目想定）
const ARCHIVE_START_ROW = 2;

// 歌った曲リスト/アーカイブの D列（出典元情報=リンク）
const SOURCE_URL_COL = 4;

// 動画履歴チェックのレイアウト（固定）
const VH_HISTORY_START_COL = 1; // A（Python貼り付け）
const VH_HISTORY_COLS = 3;      // A-C（upload_yyyymmdd / title / videoId）
const VH_GAP_COL = 4;           // D（空列）
const VH_LOGGED_START_COL = 5;  // E（記帳済み動画一覧の出力開始）
const VH_LOGGED_COLS = 4;       // E-H（date,title,videoId,url）

const VH_HISTORY_HEADER = ['upload_yyyymmdd', 'title', 'videoId']; // A-C
const VH_LOGGED_HEADER  = ['logged_upload_yyyymmdd', 'logged_title', 'logged_videoId', 'logged_url']; // E-H


/**
 * ==============================
 * メニュー追加（統合版）
 * ==============================
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  // 既存：仕分けメニュー
  ui.createMenu('仕分け')
    .addItem('重複を整理（最新のみ残す）', 'dedupeAndArchive')
    .addItem('一覧シートを更新（不足分のみ追記）', 'updateUnifiedListSheet')
    .addSeparator()
    .addItem('発表年＆元号を更新（全体）', 'updateReleaseYears')
    .addItem('発表年＆元号を更新（選択範囲）', 'updateReleaseYearsForSelection')
    .addSeparator()
    .addItem('統計シートを更新', 'createSongStatistics')
    .addToUi();

  // 追加：動画監査メニュー
  ui.createMenu('動画監査')
    .addItem('動画履歴チェック：記帳済み動画一覧をE列に再生成', 'rebuildLoggedVideoListOnVideoHistorySheet')
    .addItem('動画履歴チェック：既に記帳済みを削除して未記帳だけ残す', 'pruneVideoHistoryCheck')
    .addItem('動画履歴チェック：未記帳だけを別シートに出力（安全版）', 'exportMissingToSheet')
    .addToUi();
}


/**
 * ==============================
 * 既存：重複整理 → アーカイブ
 * ==============================
 *
 * メイン処理：
 * - 重複（同一アーティスト×曲名）を検出
 * - 区分優先＞日付（直リンク文頭から抽出）の規則で「残す1件」を決定
 * - それ以外はアーカイブへコピー（ハイパーリンク含む・重複挿入回避）
 * - 本シートからはアーカイブ対象行を削除（下から）
 * - アーカイブシートの条件付き書式を全削除
 * - アーカイブシートを D列降順→B列昇順→A列昇順 でソート（2行目以降）
 */
function dedupeAndArchive() {
  const ss = SpreadsheetApp.getActive();
  const main = ss.getSheetByName(MAIN_SHEET_NAME);
  if (!main) throw new Error('シート「' + MAIN_SHEET_NAME + '」が見つかりません。');
  let archive = ss.getSheetByName(ARCHIVE_SHEET_NAME);
  if (!archive) archive = ss.insertSheet(ARCHIVE_SHEET_NAME);

  // アーカイブのヘッダーを保証（1行目）
  ensureArchiveHeader_(archive);

  const lastRow = main.getLastRow();
  if (lastRow < START_ROW) {
    ss.toast('対象データがありません。', '仕分け', 5);
    return;
  }

  // メインデータ取得（値＋リッチテキスト）
  const readRange = main.getRange(START_ROW, 1, lastRow - START_ROW + 1, COL_COUNT);
  const rows = readRange.getValues();              // [[artist, title, category, linkText], ...]
  const richRows = readRange.getRichTextValues();  // [[RT, RT, RT, RT], ... ]

  const entries = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rr = richRows[i];
    const artist = (r[0] || '').toString().trim();
    const title  = (r[1] || '').toString().trim();
    const cat    = (r[2] || '').toString().trim();
    const linkText = (r[3] || '').toString().trim();

    // 空行（アーティスト名・曲名ともに空）はスキップ
    if (!artist && !title) continue;

    const key = buildKey(artist, title);
    const prio = PRIORITY.hasOwnProperty(cat) ? PRIORITY[cat] : 0;

    // 表示テキストから日付抽出（文頭）
    const dateObj = parseHeadDate(linkText);
    if (!dateObj) {
      const rowNo = START_ROW + i;
      main.getRange(rowNo, 4).setBackground('#ffd1d1'); // 直リンクセルを赤系でマーキング
      throw new Error(`日付抽出に失敗しました（${rowNo}行目, 直リンク="${linkText}"）。直リンク文頭に日付を入れてください。`);
    }

    // ハイパーリンクURL（リッチテキストのURLを優先）
    const url = extractFirstUrlFromRichText_(rr[3]) || linkText;

    entries.push({
      rowIndex: START_ROW + i, // 1始まりのシート行番号
      key,                     // 正規化キー（アーティスト｜曲名）
      prio,                    // 区分優先度
      date: dateObj,           // Date
      linkText,                // 表示テキスト
      url,                     // URL（なければ表示テキスト）
    });
  }

  if (entries.length === 0) {
    ss.toast('有効なデータがありません。', '仕分け', 5);
    return;
  }

  // 既存アーカイブのユニークセット（key｜dateISO｜url）
  const archiveExisting = buildArchiveUniqueSet_(archive);

  // キーごとにグループ化 → 区分優先＞日付降順で選抜
  const byKey = new Map();
  for (const e of entries) {
    if (!byKey.has(e.key)) byKey.set(e.key, []);
    byKey.get(e.key).push(e);
  }

  const winners = new Set();   // 残す行（rowIndex）
  const rowsToArchive = [];    // アーカイブへ移動するメイン側の行番号
  for (const [key, list] of byKey.entries()) {
    list.sort((a, b) => {
      if (b.prio !== a.prio) return b.prio - a.prio; // 区分優先度（降順）
      return b.date - a.date;                        // 日付（降順）
    });

    const winner = list[0];
    winners.add(winner.rowIndex);

    for (let i = 1; i < list.length; i++) {
      const e = list[i];
      const dateIso = toISO_(e.date);
      const uniq = `${e.key}｜${dateIso}｜${e.url}`;
      if (!archiveExisting.has(uniq)) {
        rowsToArchive.push(e.rowIndex);
        archiveExisting.add(uniq);
      }
    }
  }

  // アーカイブへコピー（ハイパーリンク含む）：行ごとに copyTo（2行目以降に追記）
  if (rowsToArchive.length > 0) {
    rowsToArchive.sort((a, b) => a - b);

    for (const row of rowsToArchive) {
      const src = main.getRange(row, 1, 1, COL_COUNT);
      const destRow = Math.max(archive.getLastRow() + 1, 2); // 常に2行目以降
      const dest = archive.getRange(destRow, 1, 1, COL_COUNT);
      src.copyTo(dest, { contentsOnly: false }); // ハイパーリンク等の書式ごとコピー
    }
  }

  // 本シートから削除（下から）
  if (rowsToArchive.length > 0) {
    const rowsToDelete = [...rowsToArchive].sort((a, b) => b - a);
    for (const row of rowsToDelete) {
      main.deleteRow(row);
    }
  }

  // アーカイブシートの条件付き書式を全削除
  clearConditionalFormatting_(archive);

  // アーカイブシートを D列降順→B列昇順→A列昇順 でソート（2行目以降）
  sortArchiveSheet_(archive);

  ss.toast(
    `処理完了：残すキー=${winners.size}件、アーカイブ行追加=${rowsToArchive.length}件、削除=${rowsToArchive.length}行。`,
    '仕分け',
    8
  );
}

/**
 * 正規化キー生成（軽量）
 */
function buildKey(artist, title) {
  const norm = s => String(s)
    .replace(/[　]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[‐‒–—―ー−-]/g, '-');

  return `${norm(artist)}｜${norm(title)}`;
}

/**
 * 直リンク文頭から日付を抽出して Date を返す
 * 対応：YYYYMMDD / YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD / YYYY年M月D日
 */
function parseHeadDate(s) {
  const str = (s || '').toString().trim();
  const patterns = [
    /^\s*(\d{4})(\d{2})(\d{2})\b/,         // 20250913
    /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\b/,   // 2025-09-24
    /^\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\b/, // 2025/09/24
    /^\s*(\d{4})\.(\d{1,2})\.(\d{1,2})\b/, // 2025.09.24
    /^\s*(\d{4})年(\d{1,2})月(\d{1,2})日?/ // 2025年9月24日
  ];
  for (const re of patterns) {
    const m = str.match(re);
    if (m) {
      const y = +m[1], mo = +m[2], d = +m[3];
      const dt = new Date(y, mo - 1, d);
      if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) {
        return dt;
      }
    }
  }
  return null;
}

/**
 * Date → YYYY-MM-DD
 */
function toISO_(d) {
  const y = d.getFullYear();
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  const day = ('0' + d.getDate()).slice(-2);
  return `${y}-${m}-${day}`;
}

/**
 * アーカイブの1行目にヘッダーを保証
 */
function ensureArchiveHeader_(archiveSheet) {
  const header = ['アーティスト名', '曲名', '区分', '出典元情報(直リンク)'];
  const lastRow = archiveSheet.getLastRow();
  const hasHeader =
    lastRow >= 1 &&
    archiveSheet.getRange(1, 1, 1, header.length).getValues()[0]
      .some(v => String(v || '').trim() !== '');

  if (!hasHeader) {
    archiveSheet.getRange(1, 1, 1, header.length).setValues([header]);
  }
}

/**
 * RichTextValue から最初に見つかったリンクURLを取り出す
 */
function extractFirstUrlFromRichText_(rt) {
  if (!rt) return null;
  try {
    const whole = rt.getLinkUrl();
    if (whole) return whole;
    const runs = rt.getRuns ? rt.getRuns() : [];
    for (const run of runs) {
      const u = run.getLinkUrl && run.getLinkUrl();
      if (u) return u;
    }
  } catch (e) {}
  return null;
}

/**
 * 既存アーカイブのユニークセットを構築
 * キーは「正規化キー｜YYYY-MM-DD｜URL」
 */
function buildArchiveUniqueSet_(archiveSheet) {
  const last = archiveSheet.getLastRow();
  if (last < 2) return new Set();

  const rng = archiveSheet.getRange(2, 1, last - 1, COL_COUNT);
  const vals = rng.getValues();
  const rich = rng.getRichTextValues();

  const set = new Set();
  for (let i = 0; i < vals.length; i++) {
    const r = vals[i];
    const rr = rich[i];
    const artist = (r[0] || '').toString().trim();
    const title  = (r[1] || '').toString().trim();
    const linkText = (r[3] || '').toString().trim();
    if (!artist && !title) continue;

    const key = buildKey(artist, title);

    const dateObj = parseHeadDate(linkText);
    if (!dateObj) continue;
    const iso = toISO_(dateObj);

    const url = extractFirstUrlFromRichText_(rr[3]) || linkText;
    set.add(`${key}｜${iso}｜${url}`);
  }
  return set;
}

/**
 * 条件付き書式を全削除
 */
function clearConditionalFormatting_(sheet) {
  if (!sheet) return;
  const rules = sheet.getConditionalFormatRules();
  if (!rules || rules.length === 0) return;
  sheet.setConditionalFormatRules([]);
}

/**
 * アーカイブを D降順→B昇順→A昇順 で段階ソート
 */
function sortArchiveSheet_(archiveSheet) {
  if (!archiveSheet) return;
  const lastRow = archiveSheet.getLastRow();
  if (lastRow <= 2) return;

  const numRows = lastRow - 1; // 2行目〜
  const range = archiveSheet.getRange(2, 1, numRows, COL_COUNT);

  range.sort({ column: 4, ascending: false });
  range.sort({ column: 2, ascending: true });
  range.sort({ column: 1, ascending: true });
}


/* --------------------------------------------------
 * 既存：発表年（E列）＆元号（F列）
 * -------------------------------------------------- */

function updateReleaseYears() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MAIN_SHEET_NAME);
  if (!sheet) throw new Error('シート「' + MAIN_SHEET_NAME + '」が見つかりません');

  const lastRow = sheet.getLastRow();
  if (lastRow < START_ROW) return;

  const numRows = lastRow - START_ROW + 1;
  processReleaseYearsForRows_(sheet, START_ROW, numRows);
  ensureYearHeaderAndBorders_(sheet);
}

function updateReleaseYearsForSelection() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MAIN_SHEET_NAME);
  if (!sheet) throw new Error('シート「' + MAIN_SHEET_NAME + '」が見つかりません');

  const range = sheet.getActiveRange();
  if (!range) {
    SpreadsheetApp.getUi().alert('範囲が選択されていません。');
    return;
  }

  const startRow = Math.max(range.getRow(), START_ROW);
  const endRow = Math.min(range.getLastRow(), sheet.getLastRow());
  if (endRow < startRow) {
    SpreadsheetApp.getUi().alert('有効なデータ範囲が選択されていません。');
    return;
  }

  const numRows = endRow - startRow + 1;
  processReleaseYearsForRows_(sheet, startRow, numRows);
  ensureYearHeaderAndBorders_(sheet);
}

function processReleaseYearsForRows_(sheet, startRow, numRows) {
  if (numRows <= 0) return;

  const values = sheet.getRange(startRow, 1, numRows, 6).getValues();
  const outEF = [];

  for (let i = 0; i < numRows; i++) {
    const row = values[i];
    const artist = row[0];
    const title  = row[1];
    let year     = row[4];
    let era      = row[5];

    if (!artist || !title) {
      outEF.push([year || '', era || '']);
      continue;
    }

    if (!year) {
      year = fetchReleaseYearFromMusicBrainz(artist, title);
      if (year) Utilities.sleep(1100);
    }

    if (year && !era) {
      era = getJapaneseEraFromYear(year);
    }

    outEF.push([year || '', era || '']);
  }

  sheet.getRange(startRow, 5, numRows, 2).setValues(outEF);
}

function fetchReleaseYearFromMusicBrainz(artist, title) {
  const baseUrl = 'https://musicbrainz.org/ws/2/recording/';
  const query = `recording:"${title}" AND artist:"${artist}"`;

  const params = {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      // MusicBrainz の利用規約上、User-Agent は必須
      'User-Agent': 'SongYearFetcher/1.0 (korothethird@gmail.com)'
    }
  };

  const url = baseUrl + '?query=' + encodeURIComponent(query) + '&fmt=json&limit=1';

  try {
    const res = UrlFetchApp.fetch(url, params);
    const code = res.getResponseCode();
    if (code !== 200) {
      Logger.log(`HTTP error ${code} for "${artist}" - "${title}"`);
      return '';
    }

    const data = JSON.parse(res.getContentText());
    if (!data.recordings || data.recordings.length === 0) {
      Logger.log(`No recording found for "${artist}" - "${title}"`);
      return '';
    }

    const rec = data.recordings[0];

    let date = rec['first-release-date'];
    if (!date && rec.releases && rec.releases.length > 0) {
      date = rec.releases[0].date;
    }
    if (!date) {
      Logger.log(`No date found for "${artist}" - "${title}"`);
      return '';
    }

    const yearStr = date.substring(0, 4);
    const yearNum = parseInt(yearStr, 10);
    if (isNaN(yearNum)) return '';
    return yearNum;

  } catch (e) {
    Logger.log(`Error for "${artist}" - "${title}": ${e}`);
    return '';
  }
}

function getJapaneseEraFromYear(year) {
  if (!year || isNaN(year)) return '';
  const y = Number(year);

  if (y >= 2019) return '令和';
  if (y >= 1989) return '平成';
  if (y >= 1926) return '昭和';
  return '';
}

function ensureYearHeaderAndBorders_(sheet) {
  const headerRow = START_ROW - 1; // 3行目想定
  if (headerRow <= 0) return;

  sheet.getRange(headerRow, 5).setValue('発表年');
  sheet.getRange(headerRow, 6).setValue('元号');

  const lastRow = sheet.getLastRow();
  if (lastRow < headerRow) return;

  const borderRange = sheet.getRange(headerRow, 5, lastRow - headerRow + 1, 2);
  borderRange.setBorder(true, true, true, true, true, true);
}


/* --------------------------------------------------
 * 既存：統計シート（歌枠 / ショート集計）
 * -------------------------------------------------- */

function createSongStatistics() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sources = [
    { sheetName: MAIN_SHEET_NAME,    headerRow: 3 },
    { sheetName: ARCHIVE_SHEET_NAME, headerRow: 1 },
  ];

  const records = [];

  sources.forEach(config => {
    const sheet = ss.getSheetByName(config.sheetName);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    const startRow = config.headerRow + 1;
    if (lastRow < startRow) return;

    const range = sheet.getRange(startRow, 1, lastRow - startRow + 1, 3);
    const values = range.getValues();

    values.forEach(row => {
      const artist = (row[0] || '').toString().trim();
      const title  = (row[1] || '').toString().trim();
      const kind   = (row[2] || '').toString().trim();

      if (!artist && !title) return;
      if (kind !== '歌枠' && kind !== 'ショート') return;

      records.push({ artist, title, kind });
    });
  });

  if (records.length === 0) {
    SpreadsheetApp.getActive().toast('集計対象データがありません。', '統計', 5);
    return;
  }

  const statMap = {};

  records.forEach(rec => {
    const key = rec.artist + '||' + rec.title;
    if (!statMap[key]) {
      statMap[key] = {
        artist: rec.artist,
        title: rec.title,
        total: 0,
        utawake: 0,
        short: 0,
      };
    }

    if (rec.kind === '歌枠') {
      statMap[key].utawake++;
      statMap[key].total++;
    } else if (rec.kind === 'ショート') {
      statMap[key].short++;
      statMap[key].total++;
    }
  });

  let resultRows = Object.keys(statMap).map(key => statMap[key]);

  resultRows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    const artistCompare = a.artist.localeCompare(b.artist);
    if (artistCompare !== 0) return artistCompare;
    return a.title.localeCompare(b.title);
  });

  const output = [];
  const header = ['アーティスト', '曲名', '合計(歌枠+ショート)', '歌枠のみ', 'ショートのみ'];
  output.push(header);

  resultRows.forEach(row => {
    output.push([row.artist, row.title, row.total, row.utawake, row.short]);
  });

  let statsSheet = ss.getSheetByName(STATS_SHEET_NAME);
  if (!statsSheet) {
    statsSheet = ss.insertSheet(STATS_SHEET_NAME);
  } else {
    statsSheet.clearContents();
    statsSheet.clearFormats();
  }

  statsSheet.getRange(1, 1, output.length, header.length).setValues(output);
  statsSheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  statsSheet.setFrozenRows(1);
  statsSheet.autoResizeColumns(1, header.length);

  SpreadsheetApp.getActive().toast(
    `統計シート更新：${resultRows.length}曲を集計しました。`,
    '統計',
    5
  );
}


/**
 * ============================================================
 * 追加：動画監査（A-CにPython貼り付け / E-Hに記帳済み動画一覧）
 * ============================================================
 */

/**
 * 動画履歴チェック：ヘッダ＆レイアウト保証
 * - A-C: Python貼り付け（未設定ならヘッダ補完）
 * - D  : 空列
 * - E-H: 記帳済み動画一覧（必ずヘッダ再設定）
 */
function ensureVideoHistoryLayout_(vh) {
  const a1c1 = vh.getRange(1, VH_HISTORY_START_COL, 1, VH_HISTORY_COLS).getValues()[0];
  const empty = a1c1.every(v => String(v || '').trim() === '');
  if (empty) {
    vh.getRange(1, VH_HISTORY_START_COL, 1, VH_HISTORY_COLS).setValues([VH_HISTORY_HEADER]);
  }
  vh.getRange(1, VH_GAP_COL).setValue(''); // Dは空
  vh.getRange(1, VH_LOGGED_START_COL, 1, VH_LOGGED_COLS).setValues([VH_LOGGED_HEADER]);
  vh.setFrozenRows(1);
}

/**
 * 動画履歴チェック：E列以降に「記帳済み動画一覧（歌った曲リスト＋アーカイブ）」を再生成
 */
function rebuildLoggedVideoListOnVideoHistorySheet() {
  const ss = SpreadsheetApp.getActive();
  const vh = ss.getSheetByName(VIDEO_HISTORY_SHEET_NAME);
  if (!vh) throw new Error(`シート「${VIDEO_HISTORY_SHEET_NAME}」が見つかりません。`);

  ensureVideoHistoryLayout_(vh);

  const loggedMap = collectLoggedVideosMap_(); // videoId -> { yyyymmdd, title, url }
  writeLoggedVideosToE_(vh, loggedMap);

  vh.autoResizeColumns(VH_HISTORY_START_COL, VH_HISTORY_COLS);
  vh.autoResizeColumns(VH_LOGGED_START_COL, VH_LOGGED_COLS);

  ss.toast(`記帳済み動画一覧を再生成しました：${loggedMap.size}件`, '動画監査', 6);
}

/**
 * A-C（Python貼り付け）から、記帳済み（E列側）と重複する行を除外し、
 * 未記帳だけを A-C に残します。E列以降は残します。
 */
function pruneVideoHistoryCheck() {
  const ss = SpreadsheetApp.getActive();
  const vh = ss.getSheetByName(VIDEO_HISTORY_SHEET_NAME);
  if (!vh) throw new Error(`シート「${VIDEO_HISTORY_SHEET_NAME}」が見つかりません。`);

  ensureVideoHistoryLayout_(vh);

  // E列以降の記帳済み動画一覧を最新化
  const loggedMap = collectLoggedVideosMap_();
  writeLoggedVideosToE_(vh, loggedMap);

  const loggedSet = new Set([...loggedMap.keys()]);

  // A-C を読む（2行目以降）
  const lastRow = Math.max(vh.getLastRow(), 2);
  const histRange = vh.getRange(2, VH_HISTORY_START_COL, lastRow - 1, VH_HISTORY_COLS);
  const hist = histRange.getValues();

  const kept = [];
  let removed = 0;
  let unknown = 0;

  for (const row of hist) {
    if (row.every(v => String(v || '').trim() === '')) continue;

    const vid = extractVideoIdLoose_(row[2]) || extractVideoIdLoose_(row.join(' '));
    if (!vid) {
      kept.push(row);
      unknown++;
      continue;
    }
    if (loggedSet.has(vid)) {
      removed++;
      continue;
    }
    kept.push(row);
  }

  // A2:C をクリアして、未記帳のみを書き戻す（E列以降には触らない）
  histRange.clearContent();
  if (kept.length > 0) {
    vh.getRange(2, VH_HISTORY_START_COL, kept.length, VH_HISTORY_COLS).setValues(kept);
  }

  ss.toast(`完了：除外=${removed}行、未記帳候補=${kept.length}行、videoId不明=${unknown}行`, '動画監査', 8);
}

/**
 * 破壊が嫌ならこちら：未記帳だけを「未記帳動画」シートへ出力。
 * ついでに URL 列も追加（videoIdから生成）します。
 */
function exportMissingToSheet() {
  const ss = SpreadsheetApp.getActive();
  const vh = ss.getSheetByName(VIDEO_HISTORY_SHEET_NAME);
  if (!vh) throw new Error(`シート「${VIDEO_HISTORY_SHEET_NAME}」が見つかりません。`);

  ensureVideoHistoryLayout_(vh);

  const loggedMap = collectLoggedVideosMap_();
  writeLoggedVideosToE_(vh, loggedMap);
  const loggedSet = new Set([...loggedMap.keys()]);

  const lastRow = Math.max(vh.getLastRow(), 2);
  const hist = vh.getRange(2, VH_HISTORY_START_COL, lastRow - 1, VH_HISTORY_COLS).getValues();

  const out = [];
  out.push([...VH_HISTORY_HEADER, 'url']); // A-C + url

  let missing = 0;
  let unknown = 0;

  for (const row of hist) {
    if (row.every(v => String(v || '').trim() === '')) continue;

    const vid = extractVideoIdLoose_(row[2]) || extractVideoIdLoose_(row.join(' '));
    if (!vid) {
      out.push([...row, '']);
      missing++;
      unknown++;
      continue;
    }
    if (!loggedSet.has(vid)) {
      out.push([...row, `https://www.youtube.com/watch?v=${vid}`]);
      missing++;
    }
  }

  const outName = '未記帳動画';
  let sh = ss.getSheetByName(outName);
  if (!sh) sh = ss.insertSheet(outName);
  sh.clearContents();

  sh.getRange(1, 1, out.length, out[0].length).setValues(out);
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, out[0].length);

  ss.toast(`未記帳動画：${missing}件（うち videoId不明=${unknown}件）`, '動画監査', 6);
}

/**
 * 歌った曲リスト＋アーカイブから「記帳済み動画」を videoId で集約して返す
 * return: Map(videoId -> {yyyymmdd, title, url})
 */
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
  const rng = sheet.getRange(startRow, SOURCE_URL_COL, numRows, 1);

  const vals = rng.getValues();            // 表示テキスト（label）
  const rich = rng.getRichTextValues();    // リッチテキスト
  const formulas = rng.getFormulas();      // HYPERLINK式

  for (let i = 0; i < numRows; i++) {
    const displayText = (vals[i][0] || '').toString().trim();
    const rt = rich[i][0];
    const fx = (formulas[i][0] || '').toString().trim();

    const url = extractUrlFromCell_(rt, fx, displayText);
    if (!url) continue;

    const vid = extractVideoIdFromUrl_(url);
    if (!vid) continue;

    const dt = parseHeadDate(displayText);
    const yyyymmdd = dt ? toYYYYMMDD_(dt) : '';
    const title = extractTitleFromDisplayText_(displayText);

    const prev = outMap.get(vid);
    if (!prev) {
      outMap.set(vid, { yyyymmdd, title, url });
      continue;
    }

    // 既存より日付が埋まる or より新しいなら上書き（タイトル/URLも更新）
    if (!prev.yyyymmdd && yyyymmdd) {
      outMap.set(vid, { yyyymmdd, title, url });
      continue;
    }
    if (prev.yyyymmdd && yyyymmdd && yyyymmdd > prev.yyyymmdd) {
      outMap.set(vid, { yyyymmdd, title, url });
      continue;
    }

    // URLだけ空なら埋める
    if (!prev.url && url) {
      outMap.set(vid, { yyyymmdd: prev.yyyymmdd, title: prev.title, url });
    }
  }
}

/**
 * 収集した loggedMap を E2:H に書く
 */
function writeLoggedVideosToE_(vh, loggedMap) {
  const rows = [];
  for (const [vid, obj] of loggedMap.entries()) {
    rows.push([obj.yyyymmdd || '', obj.title || '', vid, obj.url || '']);
  }

  // 日付降順→タイトル昇順
  rows.sort((a, b) => {
    const da = a[0] || '';
    const db = b[0] || '';
    if (da !== db) return db.localeCompare(da);
    return (a[1] || '').localeCompare(b[1] || '');
  });

  const lastRow = Math.max(vh.getLastRow(), 2);
  vh.getRange(2, VH_LOGGED_START_COL, lastRow - 1, VH_LOGGED_COLS).clearContent();

  if (rows.length > 0) {
    vh.getRange(2, VH_LOGGED_START_COL, rows.length, VH_LOGGED_COLS).setValues(rows);
  }
}

/**
 * displayText から yyyymmdd 部分を除去してタイトルらしき文字列を返す
 */
function extractTitleFromDisplayText_(s) {
  const t = (s || '').toString().trim();
  if (!t) return '';

  let out = t
    .replace(/^\s*(\d{4})(\d{2})(\d{2})\b\s*/, '')                 // 20250101
    .replace(/^\s*(\d{4})-(\d{1,2})-(\d{1,2})\b\s*/, '')           // 2025-1-2
    .replace(/^\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\b\s*/, '')         // 2025/1/2
    .replace(/^\s*(\d{4})\.(\d{1,2})\.(\d{1,2})\b\s*/, '')         // 2025.1.2
    .replace(/^\s*(\d{4})年(\d{1,2})月(\d{1,2})日?\s*/, '');       // 2025年1月2日

  out = out.replace(/^[\s\-–—_:：|｜]+/, '').trim();
  return out;
}

/**
 * Date -> yyyymmdd
 */
function toYYYYMMDD_(d) {
  const y = d.getFullYear();
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  const day = ('0' + d.getDate()).slice(-2);
  return `${y}${m}${day}`;
}

/**
 * 11文字videoIdを雑に抜く（セルに余計な文字が混ざっても拾う）
 */
function extractVideoIdLoose_(s) {
  const t = (s || '').toString();
  const m = t.match(/([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : '';
}

/**
 * RichText / HYPERLINK式 / 生URL から「実URL」を抽出
 */
function extractUrlFromCell_(richTextValue, formula, displayText) {
  const rtUrl = extractFirstUrlFromRichText_(richTextValue);
  if (rtUrl) return rtUrl;

  const fxUrl = extractUrlFromHyperlinkFormula_(formula);
  if (fxUrl) return fxUrl;

  const txt = (displayText || '').toString().trim();
  if (/^https?:\/\//i.test(txt)) return txt;

  return null;
}

function extractUrlFromHyperlinkFormula_(formula) {
  const f = (formula || '').toString().trim();
  if (!f) return null;

  // =HYPERLINK("url","label")
  let m = f.match(/HYPERLINK\(\s*"([^"]+)"\s*,/i);
  if (m && m[1]) return m[1];

  // 変則：=HYPERLINK(https://..., "label")
  m = f.match(/HYPERLINK\(\s*(https?:\/\/[^,\s)]+)\s*,/i);
  if (m && m[1]) return m[1];

  return null;
}

/**
 * URLから videoId 抽出（watch?v= / youtu.be / shorts/ / live/ / embed/ 対応）
 */
function extractVideoIdFromUrl_(url) {
  const u = (url || '').toString().trim();
  if (!u) return null;

  // youtu.be/VIDEOID
  let m = u.match(/https?:\/\/(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];

  // youtube.com/watch?v=VIDEOID（&t= 等が付いていてもOK）
  m = u.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];

  // youtube.com/shorts/VIDEOID
  m = u.match(/https?:\/\/(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];

  // youtube.com/live/VIDEOID
  m = u.match(/https?:\/\/(?:www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];

  // youtube.com/embed/VIDEOID
  m = u.match(/https?:\/\/(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];

  return null;
}


/**
 * ============================================================
 * 追加：songs/gags/archive 統合一覧
 * ============================================================
 */

function updateUnifiedListSheet() {
  const ss = SpreadsheetApp.getActive();
  const sources = [
    { name: MAIN_SHEET_NAME, startRow: START_ROW },
    { name: GAGS_SHEET_NAME, startRow: START_ROW },
    { name: ARCHIVE_SHEET_NAME, startRow: ARCHIVE_START_ROW },
  ];

  const header = ['アーティスト名', '曲名', '区分', '出典元情報(直リンク)', '投稿日', 'タイムスタンプ', '動画URL'];

  let listSheet = ss.getSheetByName(UNIFIED_LIST_SHEET_NAME);
  if (!listSheet) listSheet = ss.insertSheet(UNIFIED_LIST_SHEET_NAME);

  ensureUnifiedListHeader_(listSheet, header);
  const existingSet = buildUnifiedExistingSet_(listSheet);

  const rowsToAppend = [];
  for (const src of sources) {
    const sh = ss.getSheetByName(src.name);
    if (!sh) continue;

    const lastRow = sh.getLastRow();
    if (lastRow < src.startRow) continue;

    const numRows = lastRow - src.startRow + 1;
    const rng = sh.getRange(src.startRow, 1, numRows, COL_COUNT);
    const vals = rng.getValues();
    const rich = rng.getRichTextValues();
    const formulas = rng.getFormulas();

    for (let i = 0; i < numRows; i++) {
      const artist = (vals[i][0] || '').toString().trim();
      const title = (vals[i][1] || '').toString().trim();
      const kind = (vals[i][2] || '').toString().trim();
      const linkText = (vals[i][3] || '').toString().trim();

      if (!artist && !title && !kind && !linkText) continue;

      const url = extractUrlFromCell_(rich[i][3], formulas[i][3], linkText) || '';
      const posted = extractHeadDateAsDateFromFirst8Chars_(linkText);
      const tsSeconds = extractTimestampSecondsFromUrl_(url);
      const tsText = secondsToHMMSS_(tsSeconds);

      const out = [artist, title, kind, linkText, posted, tsText, url];
      const uniq = makeUnifiedRowUniqueKey_(artist, title, kind, url, posted, tsText);
      if (existingSet.has(uniq)) continue;

      rowsToAppend.push(out);
      existingSet.add(uniq);
    }
  }

  if (rowsToAppend.length > 0) {
    const appendStart = Math.max(listSheet.getLastRow() + 1, 2);
    listSheet.getRange(appendStart, 1, rowsToAppend.length, header.length).setValues(rowsToAppend);
  }

  // E列（投稿日）は日付シリアル値として保持しつつ見た目は YYYY/MM/DD に整形
  listSheet.getRange(2, 5, Math.max(listSheet.getLastRow() - 1, 1), 1).setNumberFormat('yyyy/mm/dd');

  sortUnifiedListSheet_(listSheet);
  listSheet.setFrozenRows(1);
  listSheet.autoResizeColumns(1, header.length);

  ss.toast(`一覧シート更新完了：追記=${rowsToAppend.length}件`, '仕分け', 6);
}

function ensureUnifiedListHeader_(sheet, header) {
  const now = sheet.getRange(1, 1, 1, header.length).getValues()[0];
  const same = header.every((v, i) => String(now[i] || '').trim() === v);
  if (!same) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
  }
}

function buildUnifiedExistingSet_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Set();

  const numRows = lastRow - 1;
  const rng = sheet.getRange(2, 1, numRows, 7);
  const vals = rng.getValues();
  const rich = rng.getRichTextValues();
  const formulas = rng.getFormulas();

  const set = new Set();
  for (let i = 0; i < numRows; i++) {
    const artist = (vals[i][0] || '').toString().trim();
    const title = (vals[i][1] || '').toString().trim();
    const kind = (vals[i][2] || '').toString().trim();
    const linkText = (vals[i][3] || '').toString().trim();
    const posted = normalizeDateText_(vals[i][4]);
    const tsText = normalizeTimestampText_(vals[i][5]);
    const url = (vals[i][6] || '').toString().trim() || extractUrlFromCell_(rich[i][3], formulas[i][3], linkText) || '';

    if (!artist && !title && !kind && !linkText && !posted && !tsText && !url) continue;
    set.add(makeUnifiedRowUniqueKey_(artist, title, kind, url, posted, tsText));
  }
  return set;
}

function makeUnifiedRowUniqueKey_(artist, title, kind, url, posted, tsText) {
  return [artist, title, kind, (url || '').trim(), normalizeDateText_(posted), normalizeTimestampText_(tsText)].join('｜');
}

function extractHeadDateAsDateFromFirst8Chars_(text) {
  const t = (text || '').toString().trim();
  const head = t.slice(0, 8);
  const m = head.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return '';

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
  return dt;
}

function extractTimestampSecondsFromUrl_(url) {
  const u = (url || '').toString().trim();
  if (!u) return Number.MAX_SAFE_INTEGER;

  let m = u.match(/[?&#]t=(\d+)(?:s)?(?:[&#]|$)/i);
  if (m) return Number(m[1]);

  m = u.match(/[?&#](?:start|time_continue)=(\d+)(?:[&#]|$)/i);
  if (m) return Number(m[1]);

  m = u.match(/[?&#]t=(\d+)h(\d+)m(\d+)s?(?:[&#]|$)/i);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);

  m = u.match(/[?&#]t=(\d+)m(\d+)s?(?:[&#]|$)/i);
  if (m) return Number(m[1]) * 60 + Number(m[2]);

  return Number.MAX_SAFE_INTEGER;
}

function secondsToHMMSS_(seconds) {
  if (!Number.isFinite(seconds) || seconds === Number.MAX_SAFE_INTEGER || seconds < 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${('0' + m).slice(-2)}:${('0' + s).slice(-2)}`;
}

function normalizeDateText_(text) {
  if (Object.prototype.toString.call(text) === '[object Date]' && !isNaN(text.getTime())) {
    const y = text.getFullYear();
    const m = ('0' + (text.getMonth() + 1)).slice(-2);
    const d = ('0' + text.getDate()).slice(-2);
    return `${y}/${m}/${d}`;
  }

  const t = (text || '').toString().trim();
  const m = t.match(/^(\d{4})[\/-]?(\d{2})[\/-]?(\d{2})$/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : '';
}

function normalizeTimestampText_(text) {
  const t = (text || '').toString().trim();
  const m = t.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return '';

  const h = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] !== undefined ? Number(m[3]) : 0;
  if (![h, mm, ss].every(Number.isFinite)) return '';
  return `${h}:${('0' + mm).slice(-2)}:${('0' + ss).slice(-2)}`;
}

function timestampTextToSeconds_(text) {
  const t = normalizeTimestampText_(text);
  if (!t) return Number.MAX_SAFE_INTEGER;
  const p = t.split(':').map(Number);
  return p[0] * 3600 + p[1] * 60 + p[2];
}

function dateTextToSortKey_(text) {
  const d = normalizeDateText_(text);
  if (!d) return Number.MAX_SAFE_INTEGER;
  return Number(d.replace(/\//g, ''));
}

function sortUnifiedListSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;

  const numRows = lastRow - 1;
  const vals = sheet.getRange(2, 1, numRows, 7).getValues();
  vals.sort((a, b) => {
    const tsA = timestampTextToSeconds_(a[5]);
    const tsB = timestampTextToSeconds_(b[5]);
    if (tsA !== tsB) return tsA - tsB;

    const dateA = dateTextToSortKey_(a[4]);
    const dateB = dateTextToSortKey_(b[4]);
    return dateA - dateB;
  });

  sheet.getRange(2, 1, numRows, 7).setValues(vals);
}
