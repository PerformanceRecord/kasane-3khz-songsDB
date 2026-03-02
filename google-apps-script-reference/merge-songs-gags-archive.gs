/**
 * songs / gags / archive（実体は既存定数を優先）を統合し、
 * A:D + E(投稿日 yyyy/mm/dd) + F(タイムスタンプ h:mm:ss) を merged シートへ出力。
 * 並び順: 投稿日昇順 → タイムスタンプ昇順。
 */
const MERGED_OUTPUT_SHEET_NAME = 'merged';
const MERGED_HEADER = ['A', 'B', 'C', 'D', '投稿日', 'タイムスタンプ'];
const MERGED_GAGS_SHEET_FALLBACK = '企画/一発ネタシリーズ';

function mergeSongsGagsArchiveToMergedSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheets = resolveMergeSourceSheets_(ss);
  const rows = [];

  sourceSheets.forEach((sh) => {
    const lastRow = sh.getLastRow();
    if (lastRow < 1) return;

    const range = sh.getRange(1, 1, lastRow, 4);
    const values = range.getDisplayValues();
    const rich = range.getRichTextValues();
    const formulas = range.getFormulas();

    for (let i = 0; i < values.length; i += 1) {
      const row = values[i];
      if (row.every((v) => String(v || '').trim() === '')) continue;

      const dText = String(row[3] || '').trim();
      const dUrl = resolveUrlForMerge_(rich[i][3], formulas[i][3], dText);
      const posted = extractPostedDateForMerge_(dText);
      const tsSec = extractTimestampSecondsForMerge_(dUrl);

      rows.push({
        values: [row[0], row[1], row[2], row[3], posted, tsSec == null ? '' : formatHmsForMerge_(tsSec)],
        dateKey: posted || '9999/99/99',
        tsKey: tsSec == null ? Number.MAX_SAFE_INTEGER : tsSec,
      });
    }
  });

  rows.sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
    return a.tsKey - b.tsKey;
  });

  let out = ss.getSheetByName(MERGED_OUTPUT_SHEET_NAME);
  if (!out) out = ss.insertSheet(MERGED_OUTPUT_SHEET_NAME);
  out.clearContents();

  out.getRange(1, 1, 1, MERGED_HEADER.length).setValues([MERGED_HEADER]);
  if (rows.length > 0) {
    out.getRange(2, 1, rows.length, MERGED_HEADER.length).setValues(rows.map((r) => r.values));
  }

  out.setFrozenRows(1);
  out.autoResizeColumns(1, MERGED_HEADER.length);
}

function resolveMergeSourceSheets_(ss) {
  const names = [];
  if (typeof MAIN_SHEET_NAME !== 'undefined' && MAIN_SHEET_NAME) names.push(MAIN_SHEET_NAME);
  names.push(MERGED_GAGS_SHEET_FALLBACK);
  if (typeof ARCHIVE_SHEET_NAME !== 'undefined' && ARCHIVE_SHEET_NAME) names.push(ARCHIVE_SHEET_NAME);

  const unique = [...new Set(names)];
  return unique.map((n) => ss.getSheetByName(n)).filter((sh) => !!sh);
}

function extractPostedDateForMerge_(dText) {
  if (typeof parseHeadDate === 'function') {
    const dt = parseHeadDate(dText);
    if (dt && typeof toYYYYMMDD_ === 'function') {
      const ymd = toYYYYMMDD_(dt);
      return `${ymd.slice(0, 4)}/${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`;
    }
  }

  const s = String(dText || '').trim();
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\b/);
  if (!m) return '';
  return `${m[1]}/${('0' + m[2]).slice(-2)}/${('0' + m[3]).slice(-2)}`;
}

function resolveUrlForMerge_(richTextValue, formula, displayText) {
  if (typeof extractUrlFromCell_ === 'function') {
    return extractUrlFromCell_(richTextValue, formula, displayText) || '';
  }

  const rtUrl = extractFirstUrlFromRichTextForMerge_(richTextValue);
  if (rtUrl) return rtUrl;

  const f = String(formula || '').trim();
  let m = f.match(/HYPERLINK\(\s*"([^"]+)"\s*,/i);
  if (m && m[1]) return m[1];

  m = f.match(/HYPERLINK\(\s*(https?:\/\/[^,\s)]+)\s*,/i);
  if (m && m[1]) return m[1];

  const txt = String(displayText || '').trim();
  if (/^https?:\/\//i.test(txt)) return txt;
  return '';
}

function extractTimestampSecondsForMerge_(url) {
  const u = String(url || '');
  if (!u) return null;

  const t = u.match(/[?&#]t=([^&#]+)/i);
  if (t && t[1]) {
    const sec = parseTimeParamForMerge_(t[1]);
    if (sec != null) return sec;
  }

  const start = u.match(/[?&#]start=(\d+)/i);
  if (start && start[1]) return Number(start[1]);

  return null;
}

function parseTimeParamForMerge_(raw) {
  const v = decodeURIComponent(String(raw || '').trim().toLowerCase());
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);

  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return null;

  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const sec = Number(m[3] || 0);
  return h * 3600 + min * 60 + sec;
}

function formatHmsForMerge_(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${('0' + m).slice(-2)}:${('0' + s).slice(-2)}`;
}

function extractFirstUrlFromRichTextForMerge_(rt) {
  if (!rt) return '';
  try {
    const whole = rt.getLinkUrl();
    if (whole) return whole;
    const runs = rt.getRuns ? rt.getRuns() : [];
    for (let i = 0; i < runs.length; i += 1) {
      const u = runs[i].getLinkUrl && runs[i].getLinkUrl();
      if (u) return u;
    }
  } catch (e) {
    // noop
  }
  return '';
}
