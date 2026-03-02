/**
 * songs / gags / archive の A:D を 1シートに統合し、
 * E=投稿日(yyyy/mm/dd), F=タイムスタンプ(h:mm:ss) を付与して
 * 日付昇順→タイムスタンプ昇順で並べる。
 */
const MERGE_SOURCE_SHEETS = ['songs', 'gags', 'archive'];
const MERGE_TARGET_SHEET = 'merged';
const MERGE_HEADER = ['A', 'B', 'C', 'D', '投稿日', 'タイムスタンプ'];

function mergeSongsGagsArchiveToMergedSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const outRows = [];

  MERGE_SOURCE_SHEETS.forEach((name) => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;

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
      const dUrl = extractUrlFromCellForMerge_(rich[i][3], formulas[i][3], dText);

      const posted = extractPostedDateForMerge_(dText); // yyyy/mm/dd or ''
      const tsSec = extractTimestampSecondsForMerge_(dUrl);
      const tsText = tsSec == null ? '' : formatHmsForMerge_(tsSec);

      outRows.push({
        values: [row[0], row[1], row[2], row[3], posted, tsText],
        sortDate: posted || '9999/99/99',
        sortTs: tsSec == null ? Number.MAX_SAFE_INTEGER : tsSec,
      });
    }
  });

  outRows.sort((a, b) => {
    if (a.sortDate !== b.sortDate) return a.sortDate.localeCompare(b.sortDate);
    return a.sortTs - b.sortTs;
  });

  let out = ss.getSheetByName(MERGE_TARGET_SHEET);
  if (!out) out = ss.insertSheet(MERGE_TARGET_SHEET);
  out.clearContents();

  out.getRange(1, 1, 1, MERGE_HEADER.length).setValues([MERGE_HEADER]);
  if (outRows.length > 0) {
    out.getRange(2, 1, outRows.length, MERGE_HEADER.length)
      .setValues(outRows.map((r) => r.values));
  }

  out.setFrozenRows(1);
  out.autoResizeColumns(1, MERGE_HEADER.length);
}

function extractPostedDateForMerge_(text) {
  const s = String(text || '').trim();
  const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return '';
  return `${m[1]}/${m[2]}/${m[3]}`;
}

function extractTimestampSecondsForMerge_(url) {
  const u = String(url || '');
  if (!u) return null;

  const tMatch = u.match(/[?&#]t=([^&#]+)/i);
  if (tMatch && tMatch[1]) {
    const sec = parseTimeParamForMerge_(tMatch[1]);
    if (sec != null) return sec;
  }

  const sMatch = u.match(/[?&#]start=(\d+)/i);
  if (sMatch && sMatch[1]) return Number(sMatch[1]);

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

function extractUrlFromCellForMerge_(richTextValue, formula, displayText) {
  const rtUrl = extractFirstUrlFromRichTextForMerge_(richTextValue);
  if (rtUrl) return rtUrl;

  const fx = String(formula || '').trim();
  let m = fx.match(/HYPERLINK\(\s*"([^"]+)"\s*,/i);
  if (m && m[1]) return m[1];

  m = fx.match(/HYPERLINK\(\s*(https?:\/\/[^,\s)]+)\s*,/i);
  if (m && m[1]) return m[1];

  const txt = String(displayText || '').trim();
  if (/^https?:\/\//i.test(txt)) return txt;
  return '';
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
