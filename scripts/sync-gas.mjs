#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';

const GAS_URL = process.env.GAS_URL;
if (!GAS_URL) {
  throw new Error('GAS_URL is required. Set GAS_URL env (e.g. GitHub Actions secret).');
}
const OUT_DIR = process.env.OUT_DIR || 'public-data';
const CORE_TABS = ['songs', 'gags'];
const ARCHIVE_TAB = 'archive';
const HISTORY_DIR_NAME = 'history';
const HISTORY_VERSION = 1;
const ARCHIVE_STATE_FILE = `${OUT_DIR}/archive-crawl-state.json`;
// 通常フローでは archive は使わない。必要な同期バッチ時のみ有効化する。
const ENABLE_ARCHIVE_SYNC = process.env.ENABLE_ARCHIVE_SYNC === 'true';
const ARCHIVE_STRICT_SYNC = process.env.ARCHIVE_STRICT_SYNC === 'true';
const ARCHIVE_RESET_CURSOR = process.env.ARCHIVE_RESET_CURSOR === 'true';
const ARCHIVE_FORCE_RESEED = process.env.ARCHIVE_FORCE_RESEED === 'true';
const ARCHIVE_BATCH_SIZE_MIN = Number(process.env.ARCHIVE_BATCH_SIZE_MIN || 50);
const ARCHIVE_BATCH_SIZE_MAX = Number(process.env.ARCHIVE_BATCH_SIZE_MAX || 500);
const ARCHIVE_BATCH_SIZE_FALLBACK = Number(process.env.ARCHIVE_BATCH_SIZE_FALLBACK || 150);
const DEFAULT_LIMITS = {
  songs: 500,
  gags: 100,
  archive: ARCHIVE_BATCH_SIZE_FALLBACK,
};
const TIMEOUT_MS = Number(process.env.SYNC_TIMEOUT_MS || 8000);
const MAX_RETRY = Number(process.env.SYNC_MAX_RETRY || 3);

function parseJsonLoose(input) {
  if (typeof input !== 'string') return input;
  const trimmed = input.trim();
  if (!trimmed) return input;
  try {
    return JSON.parse(trimmed);
  } catch {
    return input;
  }
}

function resolveRows(payload) {
  const queue = [payload];
  const visited = new Set();

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) continue;

    if (typeof cur === 'string') {
      const parsed = parseJsonLoose(cur);
      if (parsed !== cur) queue.push(parsed);
      continue;
    }

    if (typeof cur !== 'object') continue;
    if (visited.has(cur)) continue;
    visited.add(cur);

    if (Array.isArray(cur)) {
      if (cur.length === 0 || Array.isArray(cur[0]) || typeof cur[0] === 'object') return cur;
      continue;
    }

    const direct = [
      cur.rows,
      cur.data,
      cur.items,
      cur.list,
      cur.values,
      cur.records,
      cur.result,
      cur.payload,
      cur.response,
      cur.result && cur.result.rows,
      cur.payload && cur.payload.rows,
      cur.response && cur.response.rows,
    ];
    for (const candidate of direct) {
      if (Array.isArray(candidate)) return candidate;
      if (candidate && typeof candidate === 'object') queue.push(candidate);
    }

    for (const value of Object.values(cur)) {
      if (value && (typeof value === 'object' || typeof value === 'string')) queue.push(value);
    }
  }

  return null;
}


function extractDate8(text) {
  const m = String(text || '').match(/^(\d{8})/);
  return m ? Number(m[1]) : 0;
}

function buildRowId({ artist = '', title = '', kind = '', dUrl = '' } = {}) {
  return [artist, title, kind, dUrl].map((v) => String(v ?? '').trim().toLowerCase()).join('|');
}

function buildHistoryKey({ artist = '', title = '' } = {}) {
  return [artist, title].map((v) => String(v ?? '').trim().toLowerCase()).join('|');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isArgumentTooLargeError(err) {
  let cur = err;
  while (cur) {
    if (cur?.code === 'ARG_TOO_LARGE') return true;
    const msg = String(cur?.message ?? cur).toLowerCase();
    if (
      msg.includes('argument too large')
      || msg.includes('引数が大きすぎます')
    ) {
      return true;
    }
    cur = cur?.cause;
  }
  return false;
}

function buildUrl(tab, {
  offset = 0, limit, afterDate8, afterKey,
} = {}) {
  const url = new URL(GAS_URL);
  url.searchParams.set('sheet', tab);
  const resolvedLimit = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMITS[tab];
  if (Number.isFinite(resolvedLimit) && resolvedLimit > 0) {
    url.searchParams.set('limit', String(resolvedLimit));
  }
  if (Number.isFinite(offset) && offset > 0) {
    url.searchParams.set('offset', String(Math.floor(offset)));
  }
  if (Number.isFinite(Number(afterDate8)) && Number(afterDate8) > 0) {
    url.searchParams.set('afterDate8', String(Math.floor(Number(afterDate8))));
  }
  if (typeof afterKey === 'string' && afterKey.trim()) {
    url.searchParams.set('afterKey', afterKey.trim());
  }
  url.searchParams.set('authuser', '0');
  url.searchParams.set('v', String(Date.now()));
  return url.toString();
}

async function fetchJsonWithRetry(tab, {
  offset = 0, limit, afterDate8, afterKey,
} = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(buildUrl(tab, {
        offset, limit, afterDate8, afterKey,
      }), {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const text = await res.text();
      const payload = parseJsonLoose(text);
      const parsedPayload = payload && typeof payload === 'object' ? payload : {};
      if (parsedPayload.ok === false) {
        throw new Error(parsedPayload.error || 'GAS が ok=false を返しました');
      }
      const rawSheet = String(parsedPayload.sheet || '').toLowerCase();
      if ((tab === 'songs' || tab === 'gags') && rawSheet && rawSheet !== tab) {
        throw new Error(`sheet mismatch: request=${tab}, response=${rawSheet}`);
      }

      const rows = resolveRows(payload);
      if (!rows) {
        throw new Error('rows が配列として取得できませんでした');
      }

      const normalized = (rows || [])
        .map((r) => {
          if (Array.isArray(r)) {
            const dText = r[3] ?? '';
            const dUrl = r[4] ?? '';
            const date8 = Number(r[5]) || extractDate8(dText);
            const rowId = String(r[6] ?? '').trim() || buildRowId({ artist: r[0], title: r[1], kind: r[2], dUrl });
            return {
              artist: r[0] ?? '',
              title: r[1] ?? '',
              kind: r[2] ?? '',
              dText,
              dUrl,
              date8,
              rowId,
            };
          }
          if (!r || typeof r !== 'object') return null;
          const dText = r.dText ?? '';
          const dUrl = r.dUrl ?? '';
          return {
            ...r,
            date8: Number(r.date8) || extractDate8(dText),
            rowId: String(r.rowId ?? '').trim() || buildRowId({ artist: r.artist, title: r.title, kind: r.kind, dUrl }),
          };
        })
        .filter((r) => r && typeof r === 'object');

      return {
        sheet: parsedPayload.sheet,
        total: parsedPayload.total,
        matched: parsedPayload.matched,
        hasMore: parsedPayload.hasMore,
        nextCursorDate8: parsedPayload.nextCursorDate8,
        nextCursorKey: parsedPayload.nextCursorKey,
        rows: normalized,
      };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < MAX_RETRY) {
        await sleep(400 * attempt);
      }
    }
  }

  const wrapped = new Error(`[${tab}] 取得失敗: ${String(lastError)}`, { cause: lastError });
  if (isArgumentTooLargeError(lastError)) {
    wrapped.code = 'ARG_TOO_LARGE';
  }
  throw wrapped;
}


async function verifyArchiveHealthCheck() {
  const payload = await fetchJsonWithRetry('archive', { offset: 0, limit: 1 });
  if (!Array.isArray(payload.rows)) {
    throw new Error('[archive] health check failed: rows が配列ではありません');
  }
  if (payload.rows.length < 1 && Number(payload.total || 0) > 0) {
    throw new Error('[archive] health check failed: total > 0 なのに rows が空です');
  }
  return payload;
}

function archiveLogicalKey(row) {
  if (!row || typeof row !== 'object') return '';
  const artist = String(row.artist ?? '').trim().toLowerCase();
  const title = String(row.title ?? '').trim().toLowerCase();
  const kind = String(row.kind ?? '').trim().toLowerCase();
  const date8 = Number(row.date8) || extractDate8(row.dText);
  return `${artist}${title}${kind}${Number.isFinite(date8) ? date8 : 0}`;
}

function archiveCursorKey(row) {
  if (!row || typeof row !== 'object') return '';
  const artist = String(row.artist ?? '').trim().toLowerCase();
  const title = String(row.title ?? '').trim().toLowerCase();
  const kind = String(row.kind ?? '').trim().toLowerCase();
  const date8 = Number(row.date8) || extractDate8(row.dText);
  return `${artist}|${title}|${kind}|${Number.isFinite(date8) ? date8 : 0}`;
}

function makeHistoryId(historyKey) {
  return createHash('sha1').update(String(historyKey || '')).digest('hex').slice(0, 12);
}

function normalizeArchiveHistoryEntry(row) {
  if (!row || typeof row !== 'object') return null;
  const dText = String(row.dText ?? '');
  const dUrl = String(row.dUrl ?? '');
  return {
    artist: String(row.artist ?? ''),
    title: String(row.title ?? ''),
    kind: String(row.kind ?? ''),
    dText,
    dUrl,
    date8: Number(row.date8) || extractDate8(dText),
    rowId: String(row.rowId ?? '').trim() || buildRowId({
      artist: row.artist,
      title: row.title,
      kind: row.kind,
      dUrl,
    }),
    historyKey: String(row.historyKey ?? '').trim() || buildHistoryKey({
      artist: row.artist,
      title: row.title,
    }),
  };
}

function buildHistoryFromArchiveRows(archiveRows) {
  const groups = new Map();
  for (const rawRow of archiveRows || []) {
    const row = normalizeArchiveHistoryEntry(rawRow);
    if (!row || !row.historyKey) continue;
    if (!groups.has(row.historyKey)) groups.set(row.historyKey, []);
    groups.get(row.historyKey).push(row);
  }

  const historyByKey = new Map();
  const historyFiles = [];

  for (const [historyKey, rows] of groups.entries()) {
    const sortedRows = rows.sort((a, b) => {
      const dateDiff = (Number(b.date8) || 0) - (Number(a.date8) || 0);
      if (dateDiff !== 0) return dateDiff;
      return String(b.dText || '').localeCompare(String(a.dText || ''));
    });
    const id = makeHistoryId(historyKey);
    const lastSungAt = Number(sortedRows[0]?.date8) || 0;
    const historyPayload = {
      ok: true,
      version: HISTORY_VERSION,
      historyKey,
      rowId: sortedRows[0]?.rowId || '',
      generatedAt: new Date().toISOString(),
      total: sortedRows.length,
      lastSungAt,
      rows: sortedRows,
    };
    historyFiles.push({ id, payload: historyPayload });
    historyByKey.set(historyKey, {
      id,
      count: sortedRows.length,
      lastSungAt,
    });
  }

  return {
    historyByKey,
    historyFiles,
  };
}

async function clearHistoryDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
  const files = await readdir(dirPath, { withFileTypes: true });
  await Promise.all(files
    .filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.json'))
    .map((f) => unlink(`${dirPath}/${f.name}`)));
}

async function loadArchiveRowsFromDisk() {
  try {
    const text = await readFile(`${OUT_DIR}/${ARCHIVE_TAB}.json`, 'utf8');
    const parsed = parseJsonLoose(text);
    const rows = normalizeRowsForArchive(parsed?.rows);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function loadArchiveState() {
  const fallback = {
    cursorDate8: 0,
    cursorKey: '',
    batchSize: ARCHIVE_BATCH_SIZE_FALLBACK,
    wrapped: false,
    cycle: 0,
    lastCycleCompletedAt: '',
    lastCollisionCount: 0,
    updatedAt: new Date(0).toISOString(),
  };

  try {
    const text = await readFile(ARCHIVE_STATE_FILE, 'utf8');
    const parsed = parseJsonLoose(text);
    if (!parsed || typeof parsed !== 'object') return { ...fallback };
    return {
      ...fallback,
      ...parsed,
    };
  } catch {
    return { ...fallback };
  }
}

async function writeArchiveState(state) {
  await writeFile(ARCHIVE_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function normalizeRowsForArchive(rows) {
  return (rows || [])
    .map((row) => normalizeArchiveHistoryEntry(row))
    .filter((row) => row && row.historyKey);
}

function appendHistoryInfoToRows(rows, historyByKey) {
  return (rows || []).map((row) => {
    const historyKey = buildHistoryKey({
      artist: row?.artist ?? '',
      title: row?.title ?? '',
    });
    const info = historyByKey.get(historyKey);
    if (!info) {
      return {
        ...row,
        historyRef: '',
        historyCount: 0,
        lastSungAt: Number(row?.date8) || 0,
      };
    }
    return {
      ...row,
      historyRef: `${HISTORY_DIR_NAME}/${info.id}.json`,
      historyCount: info.count,
      lastSungAt: info.lastSungAt || 0,
    };
  });
}

function ensureHistoryCoverageForCoreRows(coreOutputs, historyBuilt) {
  const existingById = new Set((historyBuilt.historyFiles || []).map((file) => String(file?.id ?? '')));

  for (const tab of CORE_TABS) {
    const rows = coreOutputs?.[tab]?.rows || [];
    for (const row of rows) {
      const historyKey = buildHistoryKey({
        artist: row?.artist ?? '',
        title: row?.title ?? '',
      });
      if (!historyKey) continue;
      if (historyBuilt.historyByKey.has(historyKey)) continue;

      const id = makeHistoryId(historyKey);
      const dText = String(row?.dText ?? '');
      const date8 = Number(row?.date8) || extractDate8(dText);
      const rowId = String(row?.rowId ?? '').trim() || buildRowId({
        artist: row?.artist ?? '',
        title: row?.title ?? '',
        kind: row?.kind ?? '',
        dUrl: row?.dUrl ?? '',
      });
      const normalized = normalizeArchiveHistoryEntry({
        artist: row?.artist ?? '',
        title: row?.title ?? '',
        kind: row?.kind ?? '',
        dText,
        dUrl: row?.dUrl ?? '',
        date8,
        rowId,
        historyKey,
      });
      if (!normalized) continue;

      historyBuilt.historyByKey.set(historyKey, {
        id,
        count: 1,
        lastSungAt: date8,
      });

      if (!existingById.has(id)) {
        historyBuilt.historyFiles.push({
          id,
          payload: {
            ok: true,
            version: HISTORY_VERSION,
            historyKey,
            rowId,
            generatedAt: new Date().toISOString(),
            total: 1,
            lastSungAt: date8,
            rows: [normalized],
          },
        });
        existingById.add(id);
      }
    }
  }
}


function resolveArchiveBatchSize(totalRows) {
  const safeMin = Math.max(1, Number.isFinite(ARCHIVE_BATCH_SIZE_MIN) ? Math.floor(ARCHIVE_BATCH_SIZE_MIN) : 1);
  const safeMax = Math.max(safeMin, Number.isFinite(ARCHIVE_BATCH_SIZE_MAX) ? Math.floor(ARCHIVE_BATCH_SIZE_MAX) : safeMin);
  const total = Number.isFinite(Number(totalRows)) ? Number(totalRows) : 0;
  if (total <= 0) {
    return Math.min(safeMax, Math.max(safeMin, ARCHIVE_BATCH_SIZE_FALLBACK));
  }
  return Math.min(safeMax, Math.max(safeMin, Math.ceil(total / 7)));
}

function upsertArchiveRows({ existingRows, incomingRows }) {
  const merged = new Map();
  const collisionKeys = new Set();

  for (const row of normalizeRowsForArchive(existingRows)) {
    const key = archiveLogicalKey(row);
    if (!key) continue;
    if (merged.has(key)) collisionKeys.add(key);
    merged.set(key, row);
  }

  for (const row of normalizeRowsForArchive(incomingRows)) {
    const key = archiveLogicalKey(row);
    if (!key) continue;
    if (merged.has(key)) collisionKeys.add(key);
    merged.set(key, row);
  }

  const rows = Array.from(merged.values()).sort((a, b) => {
    const d = (Number(a.date8) || 0) - (Number(b.date8) || 0);
    if (d !== 0) return d;
    return archiveCursorKey(a).localeCompare(archiveCursorKey(b));
  });

  return {
    rows,
    collisionCount: collisionKeys.size,
  };
}

async function fetchArchiveRollingBatch(currentState, existingRows) {
  const totalHint = Array.isArray(existingRows) ? existingRows.length : 0;
  const batchSize = resolveArchiveBatchSize(totalHint);
  const cursorDate8 = ARCHIVE_RESET_CURSOR ? 0 : Number(currentState?.cursorDate8 || 0);
  const cursorKey = ARCHIVE_RESET_CURSOR ? '' : String(currentState?.cursorKey || '');
  // reset は cursor のみ先頭化、reseed は既存 archive を使わず再収集開始。
  const reseedMode = ARCHIVE_FORCE_RESEED;

  // archive は週次ローリング更新: 毎回1バッチだけ進める。
  const payload = await fetchJsonWithRetry('archive', {
    limit: batchSize,
    afterDate8: cursorDate8 > 0 ? cursorDate8 : undefined,
    afterKey: cursorKey || undefined,
  });
  const rows = normalizeRowsForArchive(payload.rows || []);
  const nextCursorDate8 = Number(payload.nextCursorDate8 || 0);
  const nextCursorKey = String(payload.nextCursorKey || '');
  const hasMore = payload.hasMore !== false;

  if (rows.length === 0 && hasMore) {
    return { ok: false, reason: 'rows が 0 件なのに hasMore=true です', batchSize };
  }
  if (rows.length > 0 && nextCursorDate8 === cursorDate8 && nextCursorKey === cursorKey) {
    return { ok: false, reason: 'cursor が進行していません', batchSize };
  }

  const upserted = upsertArchiveRows({
    existingRows: reseedMode ? [] : existingRows,
    incomingRows: rows,
  });
  if (upserted.collisionCount > 0) {
    console.warn(`[archive] 論理キー衝突を検知: ${upserted.collisionCount} 件`);
  }

  const nowIso = new Date().toISOString();
  let wrapped = false;
  let cycle = Number(currentState?.cycle || 0);
  let lastCycleCompletedAt = String(currentState?.lastCycleCompletedAt || '');
  let resolvedDate8 = nextCursorDate8;
  let resolvedKey = nextCursorKey;
  if (!hasMore || rows.length === 0) {
    wrapped = true;
    cycle += 1;
    lastCycleCompletedAt = nowIso;
    resolvedDate8 = 0;
    resolvedKey = '';
  }

  return {
    ok: true,
    rows: upserted.rows,
    batchSize,
    collisionCount: upserted.collisionCount,
    nextState: {
      cursorDate8: resolvedDate8,
      cursorKey: resolvedKey,
      batchSize,
      wrapped,
      cycle,
      lastCycleCompletedAt,
      lastCollisionCount: upserted.collisionCount,
      updatedAt: nowIso,
    },
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();

  const outputs = {};
  const historyDir = `${OUT_DIR}/${HISTORY_DIR_NAME}`;
  for (const tab of CORE_TABS) {
    const payload = await fetchJsonWithRetry(tab);
    outputs[tab] = {
      ok: true,
      sheet: tab,
      fetchedAt: new Date().toISOString(),
      rows: payload.rows,
      total: payload.total ?? payload.rows.length,
      matched: payload.matched ?? payload.rows.length,
    };
    await writeFile(`${OUT_DIR}/${tab}.json`, `${JSON.stringify(outputs[tab], null, 2)}\n`, 'utf8');
  }

  if (ENABLE_ARCHIVE_SYNC) {
    const existingArchiveRows = normalizeRowsForArchive(await loadArchiveRowsFromDisk());
    const currentState = await loadArchiveState();
    try {
      await verifyArchiveHealthCheck();
      const archive = await fetchArchiveRollingBatch(currentState, existingArchiveRows);
      if (!archive.ok) {
        console.warn(`[archive] 巡回取得をスキップ: ${archive.reason}`);
      }
      const archivePayload = {
        ok: true,
        sheet: ARCHIVE_TAB,
        fetchedAt: new Date().toISOString(),
        rows: archive.ok ? archive.rows : existingArchiveRows,
        total: archive.ok ? archive.rows.length : existingArchiveRows.length,
        matched: archive.ok ? archive.rows.length : existingArchiveRows.length,
      };
      outputs.archive = archivePayload;
      await writeFile(`${OUT_DIR}/${ARCHIVE_TAB}.json`, `${JSON.stringify(archivePayload, null, 2)}\n`, 'utf8');
      if (archive.ok) {
        await writeArchiveState(archive.nextState);
      }
    } catch (e) {
      const strictMsg = '[archive] 取得に失敗しました。前回の public-data/archive.json を維持して続行します';
      if (ARCHIVE_STRICT_SYNC) {
        throw new Error(strictMsg, { cause: e });
      } else {
        console.warn(strictMsg);
        console.warn(e);
      }
      outputs.archive = {
        ok: true,
        sheet: ARCHIVE_TAB,
        fetchedAt: new Date().toISOString(),
        rows: existingArchiveRows,
        total: existingArchiveRows.length,
        matched: existingArchiveRows.length,
      };
    }
  } else {
    console.warn('[archive] 通常フローのため archive 取得をスキップしました。必要時のみ ENABLE_ARCHIVE_SYNC=true を指定してください');
  }

  let historySourceMode = 'core-fallback';
  let archiveRows = [];

  if (ENABLE_ARCHIVE_SYNC) {
    historySourceMode = 'live-archive';
    archiveRows = normalizeRowsForArchive(outputs.archive?.rows || []);
  } else {
    const diskArchiveRows = normalizeRowsForArchive(await loadArchiveRowsFromDisk());
    if (diskArchiveRows.length > 0) {
      historySourceMode = 'disk-archive';
      archiveRows = diskArchiveRows;
    }
  }

  const historyBuilt = buildHistoryFromArchiveRows(archiveRows);
  ensureHistoryCoverageForCoreRows(outputs, historyBuilt);
  await clearHistoryDir(historyDir);
  for (const historyFile of historyBuilt.historyFiles) {
    await writeFile(
      `${historyDir}/${historyFile.id}.json`,
      `${JSON.stringify(historyFile.payload, null, 2)}\n`,
      'utf8',
    );
  }

  for (const tab of CORE_TABS) {
    const rowsWithHistory = appendHistoryInfoToRows(outputs[tab].rows, historyBuilt.historyByKey);
    outputs[tab].rows = rowsWithHistory;
    outputs[tab].total = rowsWithHistory.length;
    outputs[tab].matched = rowsWithHistory.length;
    await writeFile(`${OUT_DIR}/${tab}.json`, `${JSON.stringify(outputs[tab], null, 2)}\n`, 'utf8');
  }

  const outputTabs = [...CORE_TABS];

  const meta = {
    ok: true,
    source: 'gas-sync',
    generatedAt: new Date().toISOString(),
    startedAt,
    tabs: outputTabs,
    counts: Object.fromEntries(outputTabs.map((tab) => [tab, outputs[tab]?.rows?.length ?? null])),
    history: {
      version: HISTORY_VERSION,
      generatedAt: new Date().toISOString(),
      sourceMode: historySourceMode,
      sourceRows: archiveRows.length,
      files: historyBuilt.historyFiles.length,
      multiEntryFiles: historyBuilt.historyFiles.filter((file) => Number(file?.payload?.total || 0) > 1).length,
      skipped: false,
    },
  };
  await writeFile(`${OUT_DIR}/meta.json`, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  console.log('sync complete', meta);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
