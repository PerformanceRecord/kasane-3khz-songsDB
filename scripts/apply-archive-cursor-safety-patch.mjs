import fs from 'node:fs';

const apiPath = 'google-apps-script-reference/code.gs';
const syncPath = 'scripts/sync-gas.mjs';

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`${label}: target not found`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: target is not unique`);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

function replaceBlock(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: start marker not found`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`${label}: end marker not found`);
  return text.slice(0, start) + replacement + text.slice(end);
}

function patchApiCursor() {
  let text = fs.readFileSync(apiPath, 'utf8');
  let changed = false;

  if (!text.includes('const afterDate8Param = Number(p.afterDate8 || 0);')) {
    text = replaceOnce(
      text,
      `  const limitParam = Number(p.limit || 0);
  const offsetParam = Number(p.offset || 0);
  const sheetMaxReturn = CFG.SHEET_MAX_RETURN[tabKey] || CFG.MAX_RETURN;
`,
      `  const limitParam = Number(p.limit || 0);
  const offsetParam = Number(p.offset || 0);
  const afterDate8Param = Number(p.afterDate8 || 0);
  const afterKeyParam = String(p.afterKey || '').trim();
  const sheetMaxReturn = CFG.SHEET_MAX_RETURN[tabKey] || CFG.MAX_RETURN;
`,
      'archive cursor params'
    );
    changed = true;
  }

  if (!text.includes('if (tabKey === \'archive\' && (afterDate8 > 0 || afterKey))')) {
    text = replaceOnce(
      text,
      `  const offset = Number.isFinite(offsetParam) && offsetParam > 0
    ? Math.floor(offsetParam)
    : 0;

  if (tabKey === 'archive' && exact && exactArtist && exactTitle) {
`,
      `  const offset = Number.isFinite(offsetParam) && offsetParam > 0
    ? Math.floor(offsetParam)
    : 0;
  const afterDate8 = Number.isFinite(afterDate8Param) && afterDate8Param > 0
    ? Math.floor(afterDate8Param)
    : 0;
  const afterKey = afterKeyParam;

  if (tabKey === 'archive' && exact && exactArtist && exactTitle) {
`,
      'archive cursor normalized params'
    );

    text = replaceOnce(
      text,
      `  const uniq = uniqueByKey_(
    filtered,
    (r) => r.rowId || makeRowId_(r.artist, r.title, r.kind, r.dUrl)
  );

  const sorted = uniq.sort((a, b) => (b.date8 || 0) - (a.date8 || 0));

  return {
    ok: true,
    sheet: tabKey,
    total: rows.length,
    matched: sorted.length,
    offset,
    limit,
    rows: sorted.slice(offset, offset + limit),
  };
`,
      `  const uniq = uniqueByKey_(
    filtered,
    (r) => r.rowId || makeRowId_(r.artist, r.title, r.kind, r.dUrl)
  );

  if (tabKey === 'archive' && (afterDate8 > 0 || afterKey)) {
    const cursorSorted = uniq.sort(compareArchiveCursorRows_);
    const remaining = cursorSorted.filter((row) => isAfterArchiveCursor_(row, afterDate8, afterKey));
    const pageRows = remaining.slice(0, limit);
    const lastRow = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;
    return {
      ok: true,
      sheet: tabKey,
      total: rows.length,
      matched: cursorSorted.length,
      offset: 0,
      limit,
      hasMore: remaining.length > pageRows.length,
      nextCursorDate8: lastRow ? Number(lastRow.date8 || 0) : afterDate8,
      nextCursorKey: lastRow ? archiveCursorKey_(lastRow) : afterKey,
      rows: pageRows,
    };
  }

  const sorted = uniq.sort((a, b) => (b.date8 || 0) - (a.date8 || 0));

  return {
    ok: true,
    sheet: tabKey,
    total: rows.length,
    matched: sorted.length,
    offset,
    limit,
    rows: sorted.slice(offset, offset + limit),
  };
`,
      'archive cursor response'
    );

    const helpers = `function archiveCursorKey_(row) {
  return String(
    row && (row.rowId || makeRowId_(row.artist, row.title, row.kind, row.dUrl)) || ''
  ).trim();
}

function compareArchiveCursorRows_(a, b) {
  const dateDiff = Number(a && a.date8 || 0) - Number(b && b.date8 || 0);
  if (dateDiff !== 0) return dateDiff;
  return archiveCursorKey_(a).localeCompare(archiveCursorKey_(b));
}

function isAfterArchiveCursor_(row, afterDate8, afterKey) {
  const date8 = Number(row && row.date8 || 0);
  if (date8 > afterDate8) return true;
  if (date8 < afterDate8) return false;
  return archiveCursorKey_(row).localeCompare(String(afterKey || '')) > 0;
}

`;
    text = replaceOnce(
      text,
      'function out_(payload, e) {',
      helpers + 'function out_(payload, e) {',
      'archive cursor helpers'
    );
    changed = true;
  }

  if (changed) fs.writeFileSync(apiPath, text);
  return changed;
}

function patchSyncKeys() {
  let text = fs.readFileSync(syncPath, 'utf8');
  let changed = false;

  if (!text.includes('function archiveStableRowKey(row)')) {
    const replacement = `function archiveStableRowKey(row) {
  if (!row || typeof row !== 'object') return '';
  const existingRowId = String(row.rowId ?? '').trim().toLowerCase();
  if (existingRowId) return existingRowId;
  return buildRowId({
    artist: row.artist,
    title: row.title,
    kind: row.kind,
    dUrl: row.dUrl,
  });
}

function archiveLogicalKey(row) {
  if (!row || typeof row !== 'object') return '';
  const artist = String(row.artist ?? '').trim().toLowerCase();
  const title = String(row.title ?? '').trim().toLowerCase();
  const kind = String(row.kind ?? '').trim().toLowerCase();
  const date8 = Number(row.date8) || extractDate8(row.dText);
  const stableRowKey = archiveStableRowKey(row);
  return \`${artist}\u001f${title}\u001f${kind}\u001f${Number.isFinite(date8) ? date8 : 0}\u001f${stableRowKey}\`;
}

function archiveCursorKey(row) {
  return archiveStableRowKey(row);
}

`;
    text = replaceBlock(
      text,
      'function archiveLogicalKey(row) {',
      'function makeHistoryId(historyKey) {',
      replacement,
      'archive stable logical and cursor keys'
    );
    changed = true;
  }

  if (changed) fs.writeFileSync(syncPath, text);
  return changed;
}

const changed = [patchApiCursor(), patchSyncKeys()].some(Boolean);
console.log(changed ? 'archive cursor safety patch applied' : 'archive cursor safety patch already applied');
