import fs from 'node:fs';

const appPath = 'assets/js/app.js';
const indexPath = 'index.html';
const featuredPath = 'assets/js/featured-artist.js';
const dedupePath = 'google-apps-script-reference/merge-songs-gags-archive.gs';

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

function patchApp() {
  let text = fs.readFileSync(appPath, 'utf8');
  let changed = false;

  if (!text.includes("const FEATURED_ARTIST = '花彩音_3kHz';")) {
    text = replaceOnce(
      text,
      `    const TAB_LABELS = {
      songs: '歌唱曲',
      gags: '一発ネタ'
    };
`,
      `    const TAB_LABELS = {
      songs: '歌唱曲',
      gags: '一発ネタ'
    };
    const FEATURED_ARTIST = '花彩音_3kHz';
    const LIST_RENDER_CHUNK_SIZE = 100;
`,
      'frontend constants'
    );
    changed = true;
  }

  if (!text.includes('historyCache: new Map()')) {
    text = replaceOnce(
      text,
      `      historyRenderSeq: 0,
      historyView: {},
      listStatusText: '',
`,
      `      historyRenderSeq: 0,
      historyView: {},
      historyCache: new Map(),
      historyController: null,
      dataVersion: '',
      listRenderToken: 0,
      listStatusText: '',
`,
      'frontend state'
    );
    changed = true;
  }

  if (!text.includes('function cancelServerRequest()')) {
    text = replaceOnce(
      text,
      `    function endServerRequest(ok, label, message = ''){
      state.serverResponse.inflight = Math.max(0, state.serverResponse.inflight - 1);
      state.serverResponse.lastLabel = label || '-';
      if (ok) {
        state.serverResponse.lastOkAt = Date.now();
        state.serverResponse.lastError = '';
      } else {
        state.serverResponse.lastError = message || '不明なエラー';
      }
      renderServerResponse();
    }

`,
      `    function endServerRequest(ok, label, message = ''){
      state.serverResponse.inflight = Math.max(0, state.serverResponse.inflight - 1);
      state.serverResponse.lastLabel = label || '-';
      if (ok) {
        state.serverResponse.lastOkAt = Date.now();
        state.serverResponse.lastError = '';
      } else {
        state.serverResponse.lastError = message || '不明なエラー';
      }
      renderServerResponse();
    }
    function cancelServerRequest(){
      state.serverResponse.inflight = Math.max(0, state.serverResponse.inflight - 1);
      renderServerResponse();
    }

`,
      'cancel server request'
    );
    changed = true;
  }

  if (!text.includes("async function fetchWithTimeout(url, timeoutMs = 7000, { signal = null, cache = 'no-store' } = {})")) {
    text = replaceOnce(
      text,
      `    async function fetchWithTimeout(url, timeoutMs = 7000){
      const controller = new AbortController();
      const timer = setTimeout(()=>controller.abort(), timeoutMs);
      try {
        return await fetch(url, { cache: 'no-store', signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    }
`,
      `    async function fetchWithTimeout(url, timeoutMs = 7000, { signal = null, cache = 'no-store' } = {}){
      const controller = new AbortController();
      const abortFromParent = () => controller.abort();
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', abortFromParent, { once: true });
      }
      const timer = setTimeout(()=>controller.abort(), timeoutMs);
      try {
        return await fetch(url, { cache, signal: controller.signal });
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', abortFromParent);
      }
    }
`,
      'fetch timeout with external cancellation'
    );
    changed = true;
  }

  if (!text.includes("_search: `${artistKey}\\n${titleKey}`")) {
    text = replaceOnce(
      text,
      `      return normalizeListRows(rowsPayload).map(r => ({
        ...r,
        _na: normalize(r.artist),
        _nt: normalize(r.title)
      }));
`,
      `      return normalizeListRows(rowsPayload).map(r => {
        const artistKey = normalize(r.artist);
        const titleKey = normalize(r.title);
        return {
          ...r,
          _search: \`\${artistKey}\\n\${titleKey}\`,
          _kind: (r.kind || '').trim()
        };
      });
`,
      'precomputed search key'
    );
    changed = true;
  }

  if (!text.includes('const nextDataVersion = String(')) {
    text = replaceOnce(
      text,
      `          const staticMeta = metaStatic.status === 'fulfilled' ? metaStatic.value : null;
          const songsStaticCheck = songsStatic.status === 'fulfilled'
`,
      `          const staticMeta = metaStatic.status === 'fulfilled' ? metaStatic.value : null;
          const nextDataVersion = String(
            staticMeta?.dataVersion
            || staticMeta?.generatedAt
            || staticMeta?.fetchedAt
            || ''
          );
          if (state.dataVersion && nextDataVersion && state.dataVersion !== nextDataVersion) {
            state.historyCache.clear();
          }
          state.dataVersion = nextDataVersion;

          const songsStaticCheck = songsStatic.status === 'fulfilled'
`,
      'history cache version'
    );
    changed = true;
  }

  if (!text.includes('function abortCurrentHistoryRequest()')) {
    const historyFetchReplacement = `    function historyCacheKey_(historyRef){
      return \`\${state.dataVersion || 'session'}|\${String(historyRef || '').trim()}\`;
    }

    function abortCurrentHistoryRequest(){
      if (!state.historyController) return;
      state.historyController.abort();
      state.historyController = null;
    }

    async function fetchSongHistoryByRef(historyRef, { signal = null } = {}){
      const resolvedRefs = resolveHistoryRefUrls(historyRef);
      if (resolvedRefs.length === 0) return [];

      const cacheKey = historyCacheKey_(historyRef);
      if (state.historyCache.has(cacheKey)) {
        return state.historyCache.get(cacheKey);
      }

      renderHistoryProcess();
      beginServerRequest();
      const errors = [];
      for (const refUrl of resolvedRefs) {
        try {
          const res = await fetchWithTimeout(refUrl, FETCH_TIMEOUT_MS, {
            signal,
            cache: 'no-store'
          });
          if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
          const entries = extractHistoryEntriesFromRefPayload(await res.text());
          state.historyCache.set(cacheKey, entries);
          renderHistoryProcess();
          endServerRequest(true, 'historyRef/fetch');
          return entries;
        } catch (err) {
          if (err && err.name === 'AbortError') {
            cancelServerRequest();
            throw err;
          }
          const reason = err instanceof Error ? err.message : String(err);
          errors.push(\`\${refUrl} (\${reason})\`);
        }
      }
      const reason = errors.join(' | ') || 'unknown';
      endServerRequest(false, 'historyRef/fetch', reason);
      throw new Error(reason);
    }

`;
    text = replaceBlock(
      text,
      '    async function fetchSongHistoryByRef(historyRef){',
      '    function renderHistoryTitle(artist, title){',
      historyFetchReplacement,
      'history fetch cache and abort'
    );
    changed = true;
  }

  if (!text.includes('const historyController = new AbortController();')) {
    const renderHistoryReplacement = `    async function renderHistory({ artist, title, rowId, historyRef }){
      // 通常フローでは archive を取得しない（PROGRESS Final Goal: historyRef 単一 fetch）。
      abortCurrentHistoryRequest();
      const historyController = new AbortController();
      state.historyController = historyController;
      const renderSeq = ++state.historyRenderSeq;
      state.histKey = { artist, title, rowId, historyRef };
      state.historyView = {};
      renderHistoryTitle(artist, title);
      $('hist-sub').textContent = '履歴を読み込み中…';
      renderHistoryProcess();

      const wrap = $('hist-list');
      const empty = $('hist-empty');
      wrap.innerHTML = '';
      empty.style.display = 'none';
      for (let i = 0; i < 3; i++) {
        const sk = document.createElement('div');
        sk.className = 'skeleton';
        wrap.appendChild(sk);
      }

      try {
        const entries = await fetchSongHistoryByRef(historyRef, {
          signal: historyController.signal
        });
        if (renderSeq !== state.historyRenderSeq) return;
        wrap.innerHTML = '';
        if (entries.length === 0) {
          empty.style.display = 'block';
          $('hist-sub').textContent = '該当する履歴が見つかりませんでした。';
          return;
        }
        $('hist-sub').textContent = \`新しい順に \${entries.length} 件を表示しています。\`;
        drawHistoryEntries(wrap, entries);
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        if (renderSeq !== state.historyRenderSeq) return;
        const reason = err instanceof Error ? err.message : String(err);
        showHistoryLoadError(\`historyRef の取得に失敗しました: \${reason}\`);
      } finally {
        if (state.historyController === historyController) {
          state.historyController = null;
        }
      }
    }

`;
    text = replaceBlock(
      text,
      '    async function renderHistory({ artist, title, rowId, historyRef }){',
      '    function drawHistoryEntries(wrap, list){',
      renderHistoryReplacement,
      'history render cancellation'
    );
    changed = true;
  }

  if (!text.includes('function createSongListItem(row){')) {
    const renderReplacement = `    function createSongListItem(row){
      const { artist, title, kind, dText, dUrl, rowId, historyRef, date8 } = row;
      const item = document.createElement('div');
      item.className = 'item';

      const kindClass = getMobileItemKindClass(kind);
      if (kindClass) item.classList.add(kindClass);
      if (String(artist || '').trim() === FEATURED_ARTIST) {
        item.classList.add('item-featured-artist');
      }

      const l1 = document.createElement('div');
      l1.className = 'l1';
      const meta = document.createElement('div');
      meta.className = 'song-meta';
      const artistEl = document.createElement('span');
      artistEl.className = 'artist';
      artistEl.textContent = artist || '';
      const titleEl = document.createElement('span');
      titleEl.className = 'title';
      titleEl.textContent = title || '';
      meta.appendChild(artistEl);
      meta.appendChild(titleEl);
      l1.appendChild(meta);

      const thumb = createThumbElement({ dUrl, dText, title });

      const l2 = document.createElement('div');
      l2.className = 'l2';
      const actions = document.createElement('div');
      actions.className = 'mobile-actions';
      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn';
      copyBtn.textContent = 'コピー';
      copyBtn.addEventListener('click', ()=>copyPair(title, artist));
      actions.appendChild(copyBtn);
      const historyBtn = document.createElement('button');
      historyBtn.className = 'btn';
      historyBtn.textContent = '履歴';
      historyBtn.disabled = !historyRef;
      historyBtn.addEventListener('click', ()=>openHistory({ artist, title, rowId, historyRef }));
      actions.appendChild(historyBtn);
      actions.appendChild(createTagInfo(kind));

      const dateEl = document.createElement('div');
      dateEl.className = 'mobile-date';
      dateEl.textContent = formatDate8(date8);
      l2.appendChild(actions);
      l2.appendChild(dateEl);

      item.appendChild(l1);
      item.appendChild(thumb);
      item.appendChild(l2);
      return item;
    }

    function appendBlankListItem(listWrap){
      const blank = document.createElement('div');
      blank.className = 'item item-blank';
      blank.setAttribute('aria-hidden', 'true');
      blank.appendChild(document.createTextNode('＼'));
      const naanLink = document.createElement('a');
      naanLink.href = 'https://youtube.com/@kasane_3khz?si=EJw9wRmkUnRrWfCn';
      naanLink.target = '_blank';
      naanLink.rel = 'noopener noreferrer';
      naanLink.className = 'stealth-link';
      naanLink.textContent = 'ﾅｧｧﾝ';
      blank.appendChild(naanLink);
      blank.appendChild(document.createTextNode('／'));
      listWrap.appendChild(blank);
    }

    function renderListRowsInChunks(listWrap, rows, renderToken){
      let index = 0;

      const drawChunk = () => {
        if (renderToken !== state.listRenderToken) return;

        const fragment = document.createDocumentFragment();
        const end = Math.min(index + LIST_RENDER_CHUNK_SIZE, rows.length);
        for (; index < end; index++) {
          fragment.appendChild(createSongListItem(rows[index]));
        }
        listWrap.appendChild(fragment);

        if (index < rows.length) {
          requestAnimationFrame(drawChunk);
          return;
        }

        appendBlankListItem(listWrap);
        scheduleMobileLayoutSync();
      };

      drawChunk();
    }

    function render(){
      const renderToken = ++state.listRenderToken;
      const tableWrap = $('table');
      const listWrap = $('mblist');
      tableWrap.innerHTML = '';
      listWrap.innerHTML = '';
      const hint = $('hint');

      if (!state.cache[state.current]) {
        setStatus(UI_TEXT.loading);
        tableWrap.style.display = 'none';
        listWrap.style.display = 'none';
        return;
      }

      const q = normalize($('q').value || '');
      const allRows = state.cache[state.current] || [];
      const kinds = [...new Set(allRows.map(r => r._kind).filter(Boolean))].slice(0, 10);
      normalizeKindFilters(kinds);
      const selectedKinds = new Set(state.kindFilters);
      const filterByKinds = kinds.length > 0 && state.kindFilters.length < kinds.length;

      let filtered = allRows;
      if (q) filtered = filtered.filter(r => r._search.includes(q));
      if (filterByKinds) filtered = filtered.filter(r => selectedKinds.has(r._kind));
      const rows = filtered.slice(0, HARD_LIMIT);

      const filterButtons = kinds.map(kind => {
        const active = selectedKinds.has(kind);
        return \`<button type="button" class="filter-chip\${active ? ' active' : ''}" data-kind="\${kind}">\${kind}</button>\`;
      }).join('');
      $('quick-filters').innerHTML = filterButtons;
      $('quick-filters').querySelectorAll('.filter-chip').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const kind = btn.dataset.kind || '';
          if (!kind) return;
          const next = new Set(state.kindFilters);
          if (next.has(kind)) next.delete(kind);
          else next.add(kind);
          state.kindFilters = kinds.filter(name => next.has(name));
          if (state.kindFilters.length === 0) {
            state.kindFilters = [...kinds];
          }
          render();
        });
      });

      setStatus(q
        ? \`\${rows.length}件ヒット（全\${filtered.length}件）\`
        : \`表示中 \${rows.length}件（全\${allRows.length}件）\`);

      if (rows.length === 0) {
        hint.textContent = q ? '該当なし' : '検索結果がここに表示されます。';
        tableWrap.style.display = 'none';
        listWrap.style.display = 'none';
        state.activeSnapIndex = -1;
        return;
      }

      hint.textContent = '';
      listWrap.style.display = 'block';
      tableWrap.style.display = 'none';
      scheduleFilterMetrics();
      state.activeSnapIndex = 0;
      renderListRowsInChunks(listWrap, rows, renderToken);
      updateScrollGradient();
    }

`;
    text = replaceBlock(
      text,
      '    function render(){',
      "    $('btn-back').addEventListener('click', ()=>{",
      renderReplacement,
      'chunked list renderer'
    );
    changed = true;
  }

  if (!text.includes("abortCurrentHistoryRequest();\n      updateHistoryRouteParams")) {
    text = replaceOnce(
      text,
      `    $('btn-back').addEventListener('click', ()=>{
      updateHistoryRouteParams({ rowId: '', historyRef: '' });
`,
      `    $('btn-back').addEventListener('click', ()=>{
      abortCurrentHistoryRequest();
      state.historyRenderSeq += 1;
      updateHistoryRouteParams({ rowId: '', historyRef: '' });
`,
      'abort history on back'
    );
    changed = true;
  }

  if (text.includes('        render();\n        updateCompactFilterMode();')) {
    text = replaceOnce(
      text,
      `        updateKeyboardOffset();
        updateViewportMetrics();
        render();
        updateCompactFilterMode();
`,
      `        updateKeyboardOffset();
        updateViewportMetrics();
        updateCompactFilterMode();
`,
      'avoid rerender on resize'
    );
    changed = true;
  }

  if (text.includes('      mobileLayoutFrame: null,\n      mobileResizeObserver: null')) {
    text = replaceOnce(
      text,
      '      mobileLayoutFrame: null,\n      mobileResizeObserver: null',
      '      mobileLayoutFrame: null',
      'remove resize observer state'
    );
    changed = true;
  }

  if (text.includes("      if (window.ResizeObserver) {\n        state.mobileResizeObserver = new ResizeObserver(()=>scheduleMobileLayoutSync());\n        state.mobileResizeObserver.observe($('mblist'));\n      }\n")) {
    text = replaceOnce(
      text,
      `      if (window.ResizeObserver) {
        state.mobileResizeObserver = new ResizeObserver(()=>scheduleMobileLayoutSync());
        state.mobileResizeObserver.observe($('mblist'));
      }

`,
      '',
      'remove list resize observer'
    );
    changed = true;
  }

  if (changed) fs.writeFileSync(appPath, text);
  return changed;
}

function patchIndexAndFeaturedScript() {
  let changed = false;
  let html = fs.readFileSync(indexPath, 'utf8');
  if (html.includes('  <script src="./assets/js/featured-artist.js" defer></script>\n')) {
    html = replaceOnce(
      html,
      '  <script src="./assets/js/featured-artist.js" defer></script>\n',
      '',
      'remove featured artist observer script'
    );
    fs.writeFileSync(indexPath, html);
    changed = true;
  }
  if (fs.existsSync(featuredPath)) {
    fs.unlinkSync(featuredPath);
    changed = true;
  }
  return changed;
}

function patchDedupeNoChangeSkip() {
  let text = fs.readFileSync(dedupePath, 'utf8');
  let changed = false;

  if (!text.includes('hasDedupePlacementChanges_(')) {
    text = replaceOnce(
      text,
      `    placement.mainEntries.sort(compareSheetOrder_);
    placement.archiveEntries.sort(compareSheetOrder_);

    createDedupeBackups_(ss, main, archive);
`,
      `    placement.mainEntries.sort(compareSheetOrder_);
    placement.archiveEntries.sort(compareSheetOrder_);

    if (!hasDedupePlacementChanges_(
      mainEntries,
      archiveEntries,
      placement.mainEntries,
      placement.archiveEntries
    )) {
      ss.toast('変更対象はありません。バックアップと書換えを省略しました。', '仕分け', 6);
      return;
    }

    createDedupeBackups_(ss, main, archive);
`,
      'skip unchanged dedupe write'
    );

    const helper = `function hasDedupePlacementChanges_(beforeMain, beforeArchive, afterMain, afterArchive) {
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

`;
    text = replaceOnce(
      text,
      'function createDedupeBackups_(ss, mainSheet, archiveSheet) {',
      helper + 'function createDedupeBackups_(ss, mainSheet, archiveSheet) {',
      'dedupe change detection helpers'
    );
    changed = true;
  }

  if (changed) fs.writeFileSync(dedupePath, text);
  return changed;
}

const changed = [
  patchApp(),
  patchIndexAndFeaturedScript(),
  patchDedupeNoChangeSkip(),
].some(Boolean);

console.log(changed ? 'phase 1 lightweight patch applied' : 'phase 1 lightweight patch already applied');
