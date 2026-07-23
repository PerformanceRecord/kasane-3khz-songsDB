    const PROD_R2_STATIC_BASE = 'https://pub-34d8fa96953d472aa7cb424b9daf2d60.r2.dev/public-data/';
    const DEFAULT_STATIC_BASE = new URL('./public-data/', window.location.href).toString();
    const UI_TEXT = {
      loading: '読み込み中…',
      statusIdle: 'サーバー状態：＼ﾅｧﾝ／',
      statusError: 'サーバー状態：非稼働',
      statusOk: 'サーバー状態：稼働中'
    };
    const TAB_LABELS = {
      songs: '歌唱曲',
      gags: '一発ネタ'
    };
    const FEATURED_ARTIST = '花彩音_3kHz';
    const LIST_RENDER_CHUNK_SIZE = 100;
    const DESKTOP_MEDIA_QUERY = '(min-width: 769px) and (hover: hover) and (pointer: fine)';
    const desktopMedia = window.matchMedia(DESKTOP_MEDIA_QUERY);

    function resolveUrlFromQueryOrStorage({ queryKey, storageKey, fallback }){
      try {
        const queryValue = new URLSearchParams(window.location.search).get(queryKey);
        if (queryValue) return new URL(queryValue, window.location.href).toString();
      } catch {}
      try {
        const storageValue = localStorage.getItem(storageKey);
        if (storageValue) return new URL(storageValue, window.location.href).toString();
      } catch {}
      return fallback;
    }
    function isLocalDevHost(){
      const host = String(window.location.hostname || '').toLowerCase();
      return !host || host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
    }
function isCoarsePointer(){
      return window.matchMedia('(pointer: coarse)').matches;
    }
    function isDesktopMode(){
      return desktopMedia.matches;
    }
    function isMobileLayout(){
      return window.matchMedia('(max-width: 768px)').matches;
    }
    function resolveStaticDataBase(){
      const fallback = isLocalDevHost() ? DEFAULT_STATIC_BASE : PROD_R2_STATIC_BASE;
      return resolveUrlFromQueryOrStorage({
        queryKey: 'static_base',
        storageKey: 'staticDataBase',
        fallback
      });
    }
    const STATIC_DATA_BASE = resolveStaticDataBase();
    const HARD_LIMIT = 10000;
    const AUTO_COMPACT_FINAL_THRESHOLD = 0.9;
    const state = {
      current: 'songs',
      cache: { songs:null, gags:null },
      preloadPromise: null,
      debounce: null,
      lastScroll: 0,
      histKey: null,
      kindFilters: [],
      serverResponse: {
        inflight: 0,
        lastOkAt: 0,
        lastLabel: '-',
        lastError: ''
      },
      activeSnapIndex: -1,
      historyRenderSeq: 0,
      historyView: {},
      historyCache: new Map(),
      historyController: null,
      dataVersion: '',
      listRenderToken: 0,
      listStatusText: '',
      isFilterCompact: false,
      isFilterExpandedManually: false,
      filterAutoCollapseProgress: 0,
      filterAutoCollapseFrame: null,
      mobileLayoutFrame: null,
      desktopRows: [],
      desktopActiveIndex: -1,
      desktopSelectedKey: '',
      desktopSort: { key: 'date8', direction: 'desc' },
      desktopHistoryController: null,
      desktopHistorySeq: 0,
      desktopMode: isDesktopMode(),
      pendingDesktopHistory: null,
      filterSheetOpen: false
    };

    const $ = id => document.getElementById(id);
    const normalize = s => (s||'').toString().toLowerCase().replace(/\s+/g,' ').trim();
    const setStatus = (text) => {
      state.listStatusText = text || '';
      renderServerResponse();
    };
    const showToast = msg => { const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1400); };
    async function copyText(text){
      try{
        if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else{ const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
        showToast('コピーしました');
      }catch{ showToast('コピーに失敗しました'); }
    }
    async function copyPair(title, artist){
      const text = `${(title||'').trim()} / ${(artist||'').trim()}`.trim();
      await copyText(text);
    }
    document.getElementById('dm-copy').addEventListener('click', ()=>{
      const v = $('dm-select').value || '';
      copyText(v);
    });
    document.getElementById('clear-search').addEventListener('click', ()=>{
      $('q').value = '';
      state.kindFilters = [];
      render();
      $('q').focus();
    });
    function getListScroller(){
      return $('results-scroll');
    }
    function renderServerResponse(){
      const el = $('server-response');
      if (!el) return;
      const probe = state.serverResponse;
      const suffix = state.listStatusText ? ` ｜ ${state.listStatusText}` : '';
      el.className = 'server-response';
      if (probe.inflight > 0) {
        el.classList.add('loading');
        el.textContent = `${UI_TEXT.statusIdle}${suffix}`;
      } else if (probe.lastError) {
        el.classList.add('error');
        el.textContent = `${UI_TEXT.statusError}${suffix}`;
      } else if (probe.lastOkAt) {
        el.classList.add('ok');
        el.textContent = `${UI_TEXT.statusOk}${suffix}`;
      } else {
        el.textContent = `${UI_TEXT.statusIdle}${suffix}`;
      }
      scheduleFilterMetrics();
    }
    function beginServerRequest(){
      state.serverResponse.inflight += 1;
      renderServerResponse();
    }
    function endServerRequest(ok, label, message = ''){
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

    async function fetchWithTimeout(url, timeoutMs = 7000, { signal = null, cache = 'no-store' } = {}){
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

    function currentScrollTop(){
      if ($('page-list').classList.contains('active')) {
        return getListScroller()?.scrollTop || 0;
      }
      return window.scrollY || document.documentElement.scrollTop || 0;
    }
    function updateViewportMetrics(){
      const dock = $('input-dock');
      if (!dock) return;
      const dockHeight = Math.ceil(dock.getBoundingClientRect().height) + 22;
      document.documentElement.style.setProperty('--dock-height', `${dockHeight}px`);
      syncInitialMobileOffset();
      scheduleMobileLayoutSync();
    }

    function updateKeyboardOffset(){
      const isMobile = isCoarsePointer();
      if (!isMobile || !window.visualViewport) {
        document.documentElement.style.setProperty('--keyboard-offset', '0px');
        return;
      }
      const vv = window.visualViewport;
      const raw = window.innerHeight - vv.height - vv.offsetTop;
      const offset = Math.max(0, Math.round(raw));
      document.documentElement.style.setProperty('--keyboard-offset', `${offset}px`);
    }

    function ensureSearchInputVisible(){
      const input = $('q');
      if (!input) return;
      const dock = $('input-dock');
      const dockHeight = dock ? Math.ceil(dock.getBoundingClientRect().height) : 0;
      const keyboardOffset = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-offset'), 10) || 0;
      const reservedBottom = dockHeight + keyboardOffset + 12;

      const rect = input.getBoundingClientRect();
      const safeBottom = window.innerHeight - reservedBottom;
      if (rect.bottom > safeBottom) {
        const delta = rect.bottom - safeBottom;
        window.scrollBy({ top: delta, behavior: 'smooth' });
      }
    }

    function syncInitialMobileOffset(){
      const isMobile = isMobileLayout();
      const onListPage = $('page-list').classList.contains('active');
      if (!isMobile || !onListPage) return;
      const filterHeight = Math.ceil($('filter-panel').getBoundingClientRect().height);
      const listStartOffsetPx = 8;
      const panelHeightWithOffset = Math.max(filterHeight + listStartOffsetPx, 0);
      document.documentElement.style.setProperty('--filter-panel-height', `${panelHeightWithOffset}px`);
    }
    function syncMobileCardWidths(){
      const isMobile = isMobileLayout();
      const onListPage = $('page-list').classList.contains('active');
      if (!isMobile || !onListPage) return;
      const filter = $('filter-panel');
      if (!filter) return;
      const filterRect = filter.getBoundingClientRect();
      const sideGap = Math.max(4, Math.round(filterRect.left));
      const unifiedWidth = Math.max(0, Math.round(window.innerWidth - sideGap * 2));
      document.documentElement.style.setProperty('--mobile-card-side-gap', `${sideGap}px`);
      document.documentElement.style.setProperty('--mobile-unified-width', `${unifiedWidth}px`);
    }
    function stabilizeMobileActionRows(){
      const isMobile = isMobileLayout();
      if (!isMobile) return;
      const list = $('mblist');
      if (!list || list.style.display === 'none') return;
      const actions = [...list.querySelectorAll('.mobile-actions')];
      const dates = [...list.querySelectorAll('.mobile-date')];
      if (actions.length === 0) return;
      const maxActionHeight = Math.max(...actions.map(el => Math.ceil(el.getBoundingClientRect().height)));
      const maxDateWidth = dates.length ? Math.max(...dates.map(el => Math.ceil(el.getBoundingClientRect().width))) : 0;
      actions.forEach(el => el.style.setProperty('--mobile-actions-height', `${maxActionHeight}px`));
      dates.forEach(el => el.style.setProperty('--mobile-date-width', `${maxDateWidth}px`));
    }
    function scheduleMobileLayoutSync(){
      if (state.mobileLayoutFrame) cancelAnimationFrame(state.mobileLayoutFrame);
      state.mobileLayoutFrame = requestAnimationFrame(()=>{
        state.mobileLayoutFrame = null;
        syncMobileCardWidths();
        stabilizeMobileActionRows();
      });
    }

    function updateScrollGradient(){
      const scroller = getListScroller();
      const maxScroll = Math.max((scroller?.scrollHeight || 0) - (scroller?.clientHeight || 0), 1);
      const progress = Math.min(Math.max((scroller?.scrollTop || 0) / maxScroll, 0), 1);
      const sky = { r: 135, g: 206, b: 235 };
      const purple = { r: 138, g: 43, b: 226 };
      const mix = (start, end) => Math.round(start + (end - start) * progress);
      const current = `rgb(${mix(sky.r, purple.r)} ${mix(sky.g, purple.g)} ${mix(sky.b, purple.b)})`;

      document.documentElement.style.setProperty('--bg-top', 'rgb(135 206 235)');
      document.documentElement.style.setProperty('--bg-bottom', current);
    }
    document.getElementById('to-top').addEventListener('click', ()=>{
      if ($('page-list').classList.contains('active')) {
        getListScroller()?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    const urlFromText = s => { if(!s) return ''; const m=String(s).match(/https?:\/\/\S+/); return m ? m[0].replace(/[)\]\s]+$/,'') : ''; };
    const extractDate8 = s => { const m=/^(\d{8})/.exec(String(s||'')); return m ? parseInt(m[1],10) : 0; };

    function showPage(id){
      document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
      $(id).classList.add('active');
      document.body.classList.toggle('history-page', id === 'page-history');
      updateViewportMetrics();
    }

    function sortHistoryEntriesDesc(entries){
      return [...(entries || [])].sort((a, b) => {
        if ((b.date || 0) !== (a.date || 0)) return (b.date || 0) - (a.date || 0);
        return String(b.url || '').localeCompare(String(a.url || ''));
      });
    }

    const FETCH_TIMEOUT_MS = 10000;
    const INITIAL_ERROR_NOTICE_DELAY_MS = 12000;

    function showHistoryLoadError(_message){
      if (!$('page-history').classList.contains('active')) return;
      const wrap = $('hist-list');
      const empty = $('hist-empty');
      wrap.innerHTML = '';
      empty.style.display = 'block';
      $('hist-sub').textContent = '歌唱履歴を新しい順に表示します。';
      renderHistoryProcess();
    }

    function renderHistoryProcess(){
      // 履歴ページの内部処理表示は非表示運用
    }

    function normalizeBaseRow(r){
      if (Array.isArray(r)) {
        return {
          artist: r[0] ?? '',
          title : r[1] ?? '',
          kind  : r[2] ?? '',
          dText : r[3] ?? '',
          dUrl  : r[4] ?? '',
          date8 : Number(r[5]) || extractDate8(r[3]),
          rowId : String(r[6] ?? '').trim(),
          historyRef: String(r[7] ?? '').trim()
        };
      }
      const row = r && typeof r === 'object' ? r : {};
      const dText = row.dText  ?? row.dtext  ?? row.DTEXT ?? row.text ?? row.source ?? row['出典元情報(直リンク)'] ?? row.出典元情報 ?? row.出典 ?? '';
      const dUrl = row.dUrl   ?? row.durl   ?? row.DURL  ?? row.url ?? row.directUrl ?? row.link ?? '';
      const date8Raw = row.date8 ?? row.date ?? row.投稿日 ?? row.postedDate ?? '';
      const date8 = Number(date8Raw) || extractDate8(dText);
      const rowId = String(row.rowId ?? row.rowid ?? '').trim();
      const historyRef = String(row.historyRef ?? row.historyref ?? row.history ?? row.historyUrl ?? '').trim();
      return {
        artist: row.artist ?? row.Artist ?? row.artistName ?? row.singer ?? row.アーティスト ?? row.アーティスト名 ?? row.歌手名 ?? '',
        title : row.title  ?? row.Title  ?? row.song ?? row.songName ?? row.曲名 ?? row.楽曲名 ?? '',
        kind  : row.kind   ?? row.Kind   ?? row.category ?? row.type ?? row.区分 ?? '',
        dText,
        dUrl,
        date8,
        rowId,
        historyRef
      };
    }
    function normalizeListRows(payloadRows){
      return (payloadRows || [])
        .map(normalizeBaseRow)
        .filter(r => ((r.artist||'')+(r.title||'')).trim() !== '');
    }
    function resolvePayloadRows(payload){
      const visited = new Set();
      const queue = [payload];

      while (queue.length) {
        const cur = queue.shift();
        if (!cur || visited.has(cur)) continue;
        if (typeof cur === 'object') visited.add(cur);

        if (Array.isArray(cur)) {
          if (cur.length === 0 || Array.isArray(cur[0]) || typeof cur[0] === 'object') return cur;
          continue;
        }

        if (typeof cur !== 'object') continue;

        const directCandidates = [
          cur.rows,
          cur.data,
          cur.list,
          cur.items,
          cur.records,
          cur.values,
          cur.result && cur.result.rows,
          cur.result && cur.result.data,
          cur.payload && cur.payload.rows,
          cur.payload && cur.payload.data,
          cur.response && cur.response.rows,
          cur.response && cur.response.data
        ];
        for (const candidate of directCandidates) {
          if (Array.isArray(candidate)) return candidate;
        }

        for (const v of Object.values(cur)) {
          if (v && typeof v === 'object') queue.push(v);
        }
      }
      return null;
    }

    function normalizeArchiveCandidate(item){
      if (!item || typeof item !== 'object') return null;
      return {
        artist: item.artist ?? item.Artist ?? item.artistName ?? item.singer ?? item.アーティスト ?? item.アーティスト名 ?? item.歌手名 ?? '',
        title : item.title  ?? item.Title  ?? item.song ?? item.songName ?? item.曲名 ?? item.楽曲名 ?? '',
        kind  : item.kind   ?? item.Kind   ?? item.category ?? item.type ?? item.区分 ?? '',
        dText : item.dText  ?? item.dtext  ?? item.DTEXT ?? item.text ?? item.source ?? item.memo ?? item.note ?? item.出典 ?? item.出典元情報 ?? '',
        dUrl  : item.dUrl   ?? item.durl   ?? item.DURL  ?? item.url ?? item.directUrl ?? item.link ?? item.href ?? ''
      };
    }

    function extractArchiveRowsFallback(payload){
      if (Array.isArray(payload)) return payload;
      if (!payload || typeof payload !== 'object') return null;

      const direct = [
        payload.rows,
        payload.data,
        payload.list,
        payload.items,
        payload.records,
        payload.values,
        payload.result,
        payload.payload,
        payload.response,
        payload.histories,
        payload.history
      ];
      for (const candidate of direct) {
        if (Array.isArray(candidate)) return candidate;
      }

      const normalizedSingle = normalizeArchiveCandidate(payload);
      if (normalizedSingle && ((normalizedSingle.artist + normalizedSingle.title + normalizedSingle.dText + normalizedSingle.dUrl).trim() !== '')) {
        return [payload];
      }

      for (const value of Object.values(payload)) {
        if (Array.isArray(value) && value.length > 0) {
          const first = value[0];
          if (typeof first === 'object' || Array.isArray(first)) return value;
        }
      }
      return null;
    }

    function parsePayloadLoose(payload){
      if (typeof payload !== 'string') return payload;
      const text = payload.trim();
      if (!text) return payload;
      try {
        return JSON.parse(text);
      } catch {
        return payload;
      }
    }

    function normalizeRowsForTab(tab, payload){
      const parsed = parsePayloadLoose(payload);
      const rowsPayload = resolvePayloadRows(parsed);
      if (!rowsPayload) {
        const serverError = parsed && typeof parsed === 'object'
          ? (parsed.error || parsed.message || (parsed.result && parsed.result.error))
          : '';
        throw new Error(serverError ? `不正なレスポンス: ${serverError}` : '不正なレスポンス');
      }

      const rawSheet = String(parsed?.sheet || parsed?.sheetName || parsed?.name || '').toLowerCase();
      const shouldStrictMatch = tab === 'songs' || tab === 'gags';
      if (shouldStrictMatch && rawSheet && rawSheet !== tab) {
        throw new Error(`取得元不一致: request=${tab}, response=${rawSheet}`);
      }

      return normalizeListRows(rowsPayload).map(r => {
        const artistKey = normalize(r.artist);
        const titleKey = normalize(r.title);
        return {
          ...r,
          _search: `${artistKey}\n${titleKey}`,
          _kind: (r.kind || '').trim()
        };
      });
    }

    function isListDataReady(){
      return Boolean(state.cache.songs || state.cache.gags);
    }
    function isListRequestInflight(){
      return Boolean(state.preloadPromise);
    }

    setTimeout(()=>{
      if (!$('page-list').classList.contains('active')) return;
      if (isListDataReady()) return;
      if (isListRequestInflight()) return;
      setStatus(UI_TEXT.loading);
    }, INITIAL_ERROR_NOTICE_DELAY_MS);
    function buildStaticDataUrl(tab){
      const base = new URL(STATIC_DATA_BASE, window.location.href);
      const filename = tab === 'meta' ? 'meta.json' : `${tab}.json`;
      return new URL(filename, base).toString();
    }
    async function fetchStaticMeta(){
      const res = await fetchWithTimeout(buildStaticDataUrl('meta'), 7000);
      if (!res.ok) throw new Error(`static meta: HTTP ${res.status}`);
      const payload = await res.json();
      if (payload?.ok === false) throw new Error('static meta: ok=false');
      return payload && typeof payload === 'object' ? payload : {};
    }
    function validateStaticRowsWithMeta(tab, rows, meta){
      if (!meta || typeof meta !== 'object') return { ok: true, reason: '' };

      const tabs = Array.isArray(meta.tabs) ? meta.tabs.map(v => String(v).toLowerCase()) : null;
      if (tabs && tabs.length > 0 && !tabs.includes(tab)) {
        return { ok: false, reason: `meta.tabs に ${tab} がありません` };
      }

      const expected = meta?.counts?.[tab];
      if (Number.isFinite(Number(expected))) {
        const expectedCount = Number(expected);
        if (rows.length !== expectedCount) {
          return { ok: false, reason: `件数不一致 static=${rows.length}, meta=${expectedCount}` };
        }
      }

      return { ok: true, reason: '' };
    }
    async function fetchStaticSnapshot(tab){
      const res = await fetchWithTimeout(buildStaticDataUrl(tab), 7000);
      if (!res.ok) throw new Error(`static ${tab}: HTTP ${res.status}`);
      const payload = await res.json();
      if (payload?.ok === false) throw new Error(`static ${tab}: ok=false`);
      return normalizeRowsForTab(tab, payload);
    }


    function getCurrentTabLabel(){
      return TAB_LABELS[state.current] || state.current;
    }

    async function warmCaches({ forceReload = false } = {}){
      if (state.preloadPromise) return state.preloadPromise;
      if (!forceReload && state.cache.songs && state.cache.gags) {
        return;
      }

      state.preloadPromise = (async () => {
        beginServerRequest();
        setStatus('songs / gags をR2静的データから取得中…');

        try {
          const [metaStatic, songsStatic, gagsStatic] = await Promise.allSettled([
            fetchStaticMeta(),
            fetchStaticSnapshot('songs'),
            fetchStaticSnapshot('gags')
          ]);

          const staticMeta = metaStatic.status === 'fulfilled' ? metaStatic.value : null;
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
            ? validateStaticRowsWithMeta('songs', songsStatic.value, staticMeta)
            : { ok: false, reason: songsStatic.reason instanceof Error ? songsStatic.reason.message : 'static songs 取得失敗' };
          const gagsStaticCheck = gagsStatic.status === 'fulfilled'
            ? validateStaticRowsWithMeta('gags', gagsStatic.value, staticMeta)
            : { ok: false, reason: gagsStatic.reason instanceof Error ? gagsStatic.reason.message : 'static gags 取得失敗' };

          if (!songsStaticCheck.ok) console.warn(`[static] songs を不採用: ${songsStaticCheck.reason}`);
          if (!gagsStaticCheck.ok) console.warn(`[static] gags を不採用: ${gagsStaticCheck.reason}`);

          if (!songsStaticCheck.ok) throw new Error(`songs 読み込み失敗: ${songsStaticCheck.reason}`);
          if (!gagsStaticCheck.ok) throw new Error(`gags 読み込み失敗: ${gagsStaticCheck.reason}`);
          const songsRows = songsStatic.value;
          const gagsRows = gagsStatic.value;

          state.cache.songs = songsRows;
          state.cache.gags = gagsRows;
          renderHistoryProcess();

          if (state.cache[state.current]) {
            setStatus(`読み込み完了：${state.cache[state.current].length}件`);
            render();
          }

          if ($('page-history').classList.contains('active') && state.histKey?.historyRef) {
            renderHistory(state.histKey);
          }
          endServerRequest(true, 'warmCaches/static');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          renderHistoryProcess();
          setStatus(UI_TEXT.loading);
          endServerRequest(false, 'warmCaches/static', msg);
          throw err;
        } finally {
          state.preloadPromise = null;
        }
      })();

      return state.preloadPromise;
    }

    function setActiveTab(tab){
      if (state.current !== tab && state.desktopSelectedKey) closeDesktopHistory();
      state.current = tab;
      state.kindFilters = [];
      document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab===tab)));
      setStatus(UI_TEXT.loading);
      if (!state.cache[tab]) {
        warmCaches().catch(()=>{});
      }
      if (state.cache[tab]) {
        setStatus(`表示中：${state.cache[tab].length}件`);
        render();
      }
    }

    function extractHistoryEntriesFromRefPayload(payload){
      const parsed = parsePayloadLoose(payload);
      const rowsPayload = resolvePayloadRows(parsed)
        || (Array.isArray(parsed) ? parsed : null)
        || extractArchiveRowsFallback(parsed);
      if (!rowsPayload) return [];

      return sortHistoryEntriesDesc((rowsPayload || []).map((raw) => {
        const row = normalizeBaseRow(raw);
        return {
          date: Number(row.date8) || extractDate8(row.dText),
          url: row.dUrl || urlFromText(row.dText),
          kind: (row.kind || '').toString(),
          rowId: String(row.rowId || '').trim()
        };
      }).filter((entry) => entry.date || entry.url || entry.kind));
    }

    function normalizeHistoryRefByBase(ref, base){
      const basePath = String(base.pathname || '');
      if (
        ref.startsWith('public-data/') &&
        /\/public-data\/?$/.test(basePath)
      ) {
        return ref.slice('public-data/'.length);
      }
      return ref;
    }

    function resolveHistoryRefUrls(historyRef){
      const rawRef = String(historyRef || '').trim();
      if (!rawRef) return [];
      if (/^https?:\/\//i.test(rawRef)) return [rawRef];

      const urls = [];
      const addUrl = (u) => {
        if (!u || urls.includes(u)) return;
        urls.push(u);
      };

      // 第1候補: 既存ルール（STATIC_DATA_BASE 基準）
      const base = new URL(STATIC_DATA_BASE, window.location.href);
      addUrl(new URL(normalizeHistoryRefByBase(rawRef, base), base).toString());

      // 第2候補: HTML と同階層の public-data（static_base 未設定/誤設定の救済）
      const localPublicBase = new URL('./public-data/', window.location.href);
      addUrl(new URL(normalizeHistoryRefByBase(rawRef, localPublicBase), localPublicBase).toString());

      // 第3候補: historyRef が public-data/ 付きの場合の直指定
      if (rawRef.startsWith('public-data/')) {
        addUrl(new URL(rawRef, window.location.href).toString());
      }
      return urls;
    }

    function historyCacheKey_(historyRef){
      return `${state.dataVersion || 'session'}|${String(historyRef || '').trim()}`;
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
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
          errors.push(`${refUrl} (${reason})`);
        }
      }
      const reason = errors.join(' | ') || 'unknown';
      endServerRequest(false, 'historyRef/fetch', reason);
      throw new Error(reason);
    }

    function renderHistoryTitle(artist, title){
      const target = $('hist-title');
      if (!target) return;
      const artistText = (artist || '').trim();
      const titleText = (title || '').trim();
      target.textContent = '';

      target.append(document.createTextNode(artistText));
      const sep = document.createElement('span');
      sep.className = 'hist-sep';
      sep.textContent = ' /';
      target.append(sep);
      target.append(document.createElement('wbr'));
      target.append(document.createTextNode(` ${titleText}`));
    }

    function parseArtistTitleFromRowId(rowId){
      const parts = String(rowId || '').split('|');
      return {
        artist: (parts[0] || '').trim(),
        title: (parts[1] || '').trim()
      };
    }

    function updateHistoryRouteParams({ rowId, historyRef }){
      const u = new URL(window.location.href);
      if (rowId) u.searchParams.set('rowId', rowId);
      else u.searchParams.delete('rowId');
      if (historyRef) u.searchParams.set('historyRef', historyRef);
      else u.searchParams.delete('historyRef');
      history.replaceState({}, '', u.toString());
    }

    async function renderHistory({ artist, title, rowId, historyRef }){
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
        $('hist-sub').textContent = `新しい順に ${entries.length} 件を表示しています。`;
        drawHistoryEntries(wrap, entries);
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        if (renderSeq !== state.historyRenderSeq) return;
        const reason = err instanceof Error ? err.message : String(err);
        showHistoryLoadError(`historyRef の取得に失敗しました: ${reason}`);
      } finally {
        if (state.historyController === historyController) {
          state.historyController = null;
        }
      }
    }

    function drawHistoryEntries(wrap, list){
      const CHUNK = 50;
      let i = 0;
      function drawChunk(){
        const frag = document.createDocumentFragment();
        const end = Math.min(i + CHUNK, list.length);
        for (; i < end; i++) {
          const { date, url, kind } = list[i];
          const yyyy = Math.floor(date / 10000), mm = Math.floor((date % 10000) / 100), dd = date % 100;
          const dateLabel = date ? `${yyyy}/${String(mm).padStart(2,'0')}/${String(dd).padStart(2,'0')}` : '----/--/--';

          const row = document.createElement('div'); row.className = 'history-item';

          const left = document.createElement('div'); left.className = 'history-left';
          const dt = document.createElement('span');
          dt.className = 'history-date';
          dt.textContent = dateLabel;
          left.appendChild(dt);
          if ((kind || '').trim() !== '') {
            const k = document.createElement('span');
            k.className = 'kind-chip';
            k.textContent = kind;
            left.appendChild(k);
          }

          const right = document.createElement('div');
          if (url) {
            const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '▶ 開く'; right.appendChild(a);
          } else {
            const span = document.createElement('span'); span.className = 'muted'; span.textContent = 'リンクなし'; right.appendChild(span);
          }

          row.appendChild(left); row.appendChild(right);
          frag.appendChild(row);
        }
        wrap.appendChild(frag);
        if (i < list.length) requestAnimationFrame(drawChunk);
      }
      requestAnimationFrame(drawChunk);
    }

    function openHistory({ artist, title, rowId, historyRef }){
      if (!historyRef) {
        showToast('historyRef が未設定です');
        return;
      }
      if (isDesktopMode()) {
        openDesktopHistory({ artist, title, rowId, historyRef });
        return;
      }
      state.lastScroll = currentScrollTop();
      updateHistoryRouteParams({ rowId, historyRef });
      showPage('page-history');
      renderHistory({ artist, title, rowId, historyRef });
    }

    function scheduleFilterMetrics(){
      if (state.filterAutoCollapseFrame) return;
      state.filterAutoCollapseFrame = requestAnimationFrame(()=>{
        state.filterAutoCollapseFrame = null;
        syncInitialMobileOffset();
      });
    }

    function updateAutoFilterCollapse(){
      const panel = $('filter-panel');
      if (!panel) return;
      if (isMobileLayout()) {
        panel.classList.remove('auto-collapsing');
        panel.classList.remove('auto-compact-final');
        panel.style.setProperty('--scroll-collapse', '0');
        scheduleFilterMetrics();
        return;
      }
      if (state.isFilterCompact) {
        state.isFilterExpandedManually = false;
        panel.classList.remove('auto-collapsing');
        panel.classList.remove('auto-compact-final');
        panel.style.setProperty('--scroll-collapse', '1');
        scheduleFilterMetrics();
        return;
      }
      if (state.isFilterExpandedManually) {
        panel.classList.remove('auto-collapsing');
        panel.classList.remove('auto-compact-final');
        panel.style.setProperty('--scroll-collapse', '0');
        scheduleFilterMetrics();
        return;
      }
      const scroller = getListScroller();
      const y = scroller ? (scroller.scrollTop || 0) : 0;
      const progress = Math.min(Math.max(y / 180, 0), 1);
      state.filterAutoCollapseProgress = progress;
      panel.style.setProperty('--scroll-collapse', progress.toFixed(3));
      panel.classList.toggle('auto-collapsing', progress > 0.001);
      panel.classList.toggle('auto-compact-final', progress >= AUTO_COMPACT_FINAL_THRESHOLD);
      scheduleFilterMetrics();
    }

    function updateCompactFilterMode(force){
      if (typeof force === 'boolean') state.isFilterCompact = force;
      const panel = $('filter-panel');
      const btn = $('filter-toggle');
      if (!panel || !btn) return;
      if (isMobileLayout()) {
        state.isFilterCompact = false;
        panel.classList.remove('compact', 'auto-collapsing', 'auto-compact-final');
        panel.style.setProperty('--scroll-collapse', '0');
        btn.setAttribute('aria-expanded', String(state.filterSheetOpen));
        btn.textContent = '絞り込み';
        syncInitialMobileOffset();
        return;
      }
      panel.classList.toggle('compact', state.isFilterCompact);
      btn.setAttribute('aria-expanded', String(!state.isFilterCompact));
      btn.textContent = '表示切替';
      if (state.isFilterCompact) {
        panel.classList.remove('auto-collapsing');
        panel.classList.remove('auto-compact-final');
        panel.style.setProperty('--scroll-collapse', '1');
      } else {
        updateAutoFilterCollapse();
      }
      syncInitialMobileOffset();
    }

    function expandFilterPanel(){
      if (!state.isFilterCompact) return;
      state.isFilterCompact = false;
      state.isFilterExpandedManually = true;
      updateCompactFilterMode();
    }

    function normalizeKindFilters(allKinds){
      if (!Array.isArray(state.kindFilters) || state.kindFilters.length === 0) {
        state.kindFilters = [...allKinds];
        return;
      }
      const selected = new Set(state.kindFilters);
      state.kindFilters = allKinds.filter(kind => selected.has(kind));
      if (state.kindFilters.length === 0 && allKinds.length > 0) {
        state.kindFilters = [...allKinds];
      }
    }

    function availableKinds(){
      const rows = state.cache[state.current] || [];
      return [...new Set(rows.map(row => row._kind).filter(Boolean))].slice(0, 10);
    }

    function updateFilterSummary(kinds){
      const summary = $('active-filter-summary');
      if (!summary) return;
      const selected = kinds.filter(kind => state.kindFilters.includes(kind));
      if (kinds.length === 0 || selected.length === 0 || selected.length === kinds.length) {
        summary.textContent = '区分：すべて';
        return;
      }
      const visible = selected.slice(0, 2).join('、');
      const remainder = selected.length > 2 ? ` ほか${selected.length - 2}件` : '';
      summary.textContent = `区分：${visible}${remainder}`;
    }

    function renderMobileFilterOptions(kinds){
      const wrap = $('mobile-filter-options');
      if (!wrap) return;
      wrap.replaceChildren();
      const selected = new Set(state.kindFilters);
      const fragment = document.createDocumentFragment();
      kinds.forEach((kind, index)=>{
        const label = document.createElement('label');
        label.className = 'mobile-filter-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = kind;
        input.checked = selected.has(kind);
        input.id = `mobile-filter-${index}`;
        const text = document.createElement('span');
        text.textContent = kind;
        label.append(input, text);
        fragment.appendChild(label);
      });
      if (kinds.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = '選択できる区分はありません。';
        fragment.appendChild(empty);
      }
      wrap.appendChild(fragment);
    }

    function openMobileFilterSheet(){
      if (!isMobileLayout()) return;
      const sheet = $('mobile-filter-sheet');
      const backdrop = $('mobile-filter-backdrop');
      if (!sheet || !backdrop) return;
      renderMobileFilterOptions(availableKinds());
      sheet.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add('filter-sheet-open');
      state.filterSheetOpen = true;
      $('filter-toggle').setAttribute('aria-expanded', 'true');
      sheet.focus({ preventScroll: true });
    }

    function closeMobileFilterSheet({ restoreFocus = true } = {}){
      const sheet = $('mobile-filter-sheet');
      const backdrop = $('mobile-filter-backdrop');
      if (!sheet || !backdrop) return;
      sheet.hidden = true;
      backdrop.hidden = true;
      document.body.classList.remove('filter-sheet-open');
      state.filterSheetOpen = false;
      $('filter-toggle').setAttribute('aria-expanded', 'false');
      if (restoreFocus && isMobileLayout()) $('filter-toggle').focus({ preventScroll: true });
    }

    function applyMobileFilters(){
      const kinds = availableKinds();
      const checked = [...$('mobile-filter-options').querySelectorAll('input[type="checkbox"]:checked')]
        .map(input => input.value)
        .filter(kind => kinds.includes(kind));
      state.kindFilters = checked.length === 0 ? [...kinds] : checked;
      closeMobileFilterSheet({ restoreFocus: false });
      render();
      $('filter-toggle').focus({ preventScroll: true });
    }

    function desktopRowKey(row){
      return String(row.rowId || row.historyRef || `${row.artist}|${row.title}`).trim();
    }

    function setDesktopHistoryStatus(message, { error = false } = {}){
      const wrap = $('desktop-history-list');
      if (!wrap) return;
      wrap.replaceChildren();
      const status = document.createElement('div');
      status.className = `desktop-history-status${error ? ' error' : ''}`;
      status.textContent = message;
      wrap.appendChild(status);
    }

    function selectDesktopResultRow(index, { focus = false } = {}){
      const rows = [...$('table').querySelectorAll('.result-row')];
      if (rows.length === 0) {
        state.desktopActiveIndex = -1;
        return;
      }
      const nextIndex = Math.max(0, Math.min(index, rows.length - 1));
      rows.forEach((row, rowIndex)=>{
        const selected = rowIndex === nextIndex;
        row.tabIndex = selected ? 0 : -1;
        row.setAttribute('aria-selected', String(selected && row.dataset.rowKey === state.desktopSelectedKey));
      });
      state.desktopActiveIndex = nextIndex;
      if (focus) rows[nextIndex].focus({ preventScroll: true });
    }

    function markDesktopHistorySelection(key){
      state.desktopSelectedKey = key;
      const rows = [...$('table').querySelectorAll('.result-row')];
      rows.forEach((row, index)=>{
        const selected = row.dataset.rowKey === key;
        row.setAttribute('aria-selected', String(selected));
        if (selected) {
          state.desktopActiveIndex = index;
          row.tabIndex = 0;
        } else {
          row.tabIndex = -1;
        }
      });
    }

    function closeDesktopHistory({ clearRoute = true } = {}){
      if (state.desktopHistoryController) {
        state.desktopHistoryController.abort();
        state.desktopHistoryController = null;
      }
      state.desktopHistorySeq += 1;
      state.desktopSelectedKey = '';
      document.querySelector('.result-card')?.classList.remove('desktop-history-open');
      const title = $('desktop-history-title');
      const sub = $('desktop-history-sub');
      const close = $('desktop-history-close');
      if (title) title.textContent = '楽曲を選択';
      if (sub) sub.textContent = '一覧の行を選ぶと、ここに履歴を表示します。';
      if (close) close.hidden = true;
      if ($('desktop-history-list')) $('desktop-history-list').replaceChildren();
      selectDesktopResultRow(Math.max(state.desktopActiveIndex, 0));
      if (clearRoute) updateHistoryRouteParams({ rowId: '', historyRef: '' });
    }

    function renderDesktopHistoryEntries(entries){
      const wrap = $('desktop-history-list');
      wrap.replaceChildren();
      if (entries.length === 0) {
        setDesktopHistoryStatus('該当する履歴はありません。');
        return;
      }
      const fragment = document.createDocumentFragment();
      entries.forEach(entry=>{
        const item = document.createElement(entry.url ? 'a' : 'div');
        item.className = 'desktop-history-entry';
        if (entry.url) {
          item.href = entry.url;
          item.target = '_blank';
          item.rel = 'noopener';
        }
        const date = document.createElement('time');
        date.textContent = formatDate8(entry.date);
        const action = document.createElement('span');
        action.textContent = entry.url ? '動画を開く ↗' : 'リンクなし';
        item.append(date, action);
        fragment.appendChild(item);
      });
      wrap.appendChild(fragment);
    }

    async function openDesktopHistory({ artist, title, rowId, historyRef }){
      if (!historyRef) return;
      if (state.desktopHistoryController) state.desktopHistoryController.abort();
      const key = String(rowId || historyRef).trim();
      markDesktopHistorySelection(key);
      document.querySelector('.result-card')?.classList.add('desktop-history-open');
      updateHistoryRouteParams({ rowId, historyRef });
      $('desktop-history-title').textContent = `${artist || '不明'} / ${title || '不明'}`;
      $('desktop-history-sub').textContent = '歌唱日の新しい順に表示しています。';
      $('desktop-history-close').hidden = false;
      setDesktopHistoryStatus('履歴を読み込み中…');

      const seq = ++state.desktopHistorySeq;
      const controller = new AbortController();
      state.desktopHistoryController = controller;
      try {
        const entries = await fetchSongHistoryByRef(historyRef, { signal: controller.signal });
        if (seq !== state.desktopHistorySeq || state.desktopSelectedKey !== key) return;
        renderDesktopHistoryEntries(entries);
      } catch (error) {
        if (error && error.name === 'AbortError') return;
        if (seq !== state.desktopHistorySeq || state.desktopSelectedKey !== key) return;
        setDesktopHistoryStatus('履歴を取得できませんでした。もう一度行を選択してください。', { error: true });
      } finally {
        if (state.desktopHistoryController === controller) state.desktopHistoryController = null;
      }
    }

    function sortDesktopRows(rows){
      const { key, direction } = state.desktopSort;
      const factor = direction === 'asc' ? 1 : -1;
      return [...rows].sort((a, b)=>{
        if (key === 'date8') return ((Number(a.date8) || 0) - (Number(b.date8) || 0)) * factor;
        return String(a[key] || '').localeCompare(String(b[key] || ''), 'ja') * factor;
      });
    }

    function makeDesktopSortHeader(label, key, className){
      const th = document.createElement('th');
      th.scope = 'col';
      th.className = className;
      const active = state.desktopSort.key === key;
      th.setAttribute('aria-sort', active
        ? (state.desktopSort.direction === 'asc' ? 'ascending' : 'descending')
        : 'none');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sort-button';
      button.textContent = `${label}${active ? (state.desktopSort.direction === 'asc' ? ' ↑' : ' ↓') : ''}`;
      button.addEventListener('click', ()=>{
        if (active) {
          state.desktopSort.direction = state.desktopSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          state.desktopSort = { key, direction: key === 'date8' ? 'desc' : 'asc' };
        }
        render();
      });
      th.appendChild(button);
      return th;
    }

    function createDesktopRowAction({ label, text, onClick, href = '' }){
      const action = document.createElement(href ? 'a' : 'button');
      action.className = 'row-action';
      action.textContent = text;
      action.setAttribute('aria-label', label);
      action.title = label;
      if (href) {
        action.href = href;
        action.target = '_blank';
        action.rel = 'noopener';
      } else {
        action.type = 'button';
        action.addEventListener('click', onClick);
      }
      action.addEventListener('click', event => event.stopPropagation());
      return action;
    }

    function renderDesktopTable(rows){
      const tableWrap = $('table');
      const orderedRows = sortDesktopRows(rows);
      state.desktopRows = orderedRows;
      tableWrap.replaceChildren();

      const table = document.createElement('table');
      table.className = 'desktop-results-table';
      table.setAttribute('aria-label', '楽曲検索結果');
      const thead = document.createElement('thead');
      const header = document.createElement('tr');
      header.append(
        makeDesktopSortHeader('アーティスト', 'artist', 'col-artist'),
        makeDesktopSortHeader('曲名', 'title', 'col-title'),
        makeDesktopSortHeader('区分', 'kind', 'col-kind'),
        makeDesktopSortHeader('最終歌唱日', 'date8', 'col-date')
      );
      const actionsHeader = document.createElement('th');
      actionsHeader.scope = 'col';
      actionsHeader.className = 'col-actions';
      actionsHeader.textContent = '操作';
      header.appendChild(actionsHeader);
      thead.appendChild(header);

      const tbody = document.createElement('tbody');
      orderedRows.forEach((row, index)=>{
        const tr = document.createElement('tr');
        tr.className = 'result-row';
        tr.dataset.rowKey = desktopRowKey(row);
        tr.tabIndex = index === 0 ? 0 : -1;
        tr.setAttribute('aria-selected', String(tr.dataset.rowKey === state.desktopSelectedKey));

        const artist = document.createElement('td');
        artist.textContent = row.artist || '';
        const title = document.createElement('td');
        title.textContent = row.title || '';
        title.title = 'ダブルクリックで曲名とアーティストをコピー';
        title.addEventListener('dblclick', event=>{
          event.stopPropagation();
          copyPair(row.title, row.artist);
        });
        const kind = document.createElement('td');
        kind.appendChild(createTagInfo(row.kind));
        const date = document.createElement('td');
        date.textContent = formatDate8(row.date8);
        const actions = document.createElement('td');
        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'row-actions';
        actionsWrap.appendChild(createDesktopRowAction({
          label: '曲名とアーティストをコピー',
          text: '複',
          onClick: ()=>copyPair(row.title, row.artist)
        }));
        actionsWrap.appendChild(createDesktopRowAction({
          label: '歌唱履歴を表示',
          text: '履',
          onClick: ()=>openHistory(row)
        }));
        const videoUrl = row.dUrl || urlFromText(row.dText);
        if (videoUrl) {
          actionsWrap.appendChild(createDesktopRowAction({
            label: '動画を新しいタブで開く',
            text: '▶',
            href: videoUrl
          }));
        }
        actions.appendChild(actionsWrap);
        tr.append(artist, title, kind, date, actions);
        tr.addEventListener('click', event=>{
          if (event.target.closest('button,a')) return;
          state.desktopActiveIndex = index;
          openHistory(row);
        });
        tr.addEventListener('focus', ()=>{ state.desktopActiveIndex = index; });
        tbody.appendChild(tr);
      });

      table.append(thead, tbody);
      tableWrap.appendChild(table);
      const selectedIndex = orderedRows.findIndex(row => desktopRowKey(row) === state.desktopSelectedKey);
      selectDesktopResultRow(selectedIndex >= 0 ? selectedIndex : 0);
      if (state.pendingDesktopHistory) {
        const pending = state.pendingDesktopHistory;
        state.pendingDesktopHistory = null;
        const matched = orderedRows.find(row =>
          (pending.rowId && row.rowId === pending.rowId) ||
          (pending.historyRef && row.historyRef === pending.historyRef)
        );
        openDesktopHistory(matched || pending);
      }
    }

    function createTagInfo(kind){
      const tag = document.createElement('span');
      tag.className = 'tag-info';
      const normalized = (kind || '').trim();
      tag.textContent = normalized || '区分未設定';
      tag.title = normalized ? `タグ情報: ${normalized}` : 'タグ情報: 区分未設定';
      return tag;
    }

    function appendItemActions(target, {artist, title, kind, dText, dUrl, rowId, historyRef}){
      const copyBtn=document.createElement('button'); copyBtn.className='btn'; copyBtn.textContent='コピー';
      copyBtn.addEventListener('click', ()=>copyPair(title,artist));
      target.appendChild(copyBtn);

      const hbtn=document.createElement('button'); hbtn.className='btn'; hbtn.textContent='履歴';
      hbtn.disabled = !historyRef;
      hbtn.addEventListener('click', ()=>openHistory({ artist, title, rowId, historyRef }));
      target.appendChild(hbtn);

      target.appendChild(createTagInfo(kind));

      const url = dUrl || urlFromText(dText);
      if (url){
        const a=document.createElement('a'); a.href=url; a.target='_blank'; a.rel='noopener'; a.className='link-icon'; a.textContent='▶'; a.title='リンクを開く';
        target.appendChild(a);
      }
    }
    function getMobileItemKindClass(kind){
      const normalized = (kind || '').toString().trim();
      if (normalized === '歌枠') return 'item-kind-karaoke';
      if (normalized === '歌ってみた') return 'item-kind-utattemita';
      if (normalized === 'ショート') return 'item-kind-short';
      return '';
    }
    function formatDate8(date8){
      const n = Number(date8) || 0;
      if (!n) return '----/--/--';
      const yyyy = Math.floor(n / 10000);
      const mm = Math.floor((n % 10000) / 100);
      const dd = n % 100;
      return `${yyyy}/${String(mm).padStart(2,'0')}/${String(dd).padStart(2,'0')}`;
    }
    function youtubeThumbFromUrl(url){
      const raw = String(url || '').trim();
      if (!raw) return '';
      try{
        const parsed = new URL(raw);
        const host = parsed.hostname.toLowerCase();
        let id = '';
        if (host === 'youtu.be') {
          id = parsed.pathname.replace(/^\/+/, '').split('/')[0] || '';
        } else if (host.endsWith('youtube.com')) {
          id = parsed.searchParams.get('v') || '';
          if (!id && parsed.pathname.startsWith('/shorts/')) {
            id = parsed.pathname.split('/')[2] || '';
          }
        }
        if (!id) return '';
        return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
      }catch{
        return '';
      }
    }
    function createThumbElement({ dUrl, dText, title }){
      const url = dUrl || urlFromText(dText);
      const thumbUrl = youtubeThumbFromUrl(url);
      const thumb = document.createElement(url ? 'a' : 'span');
      thumb.className = 'thumb-link';
      if (url) {
        thumb.href = url;
        thumb.rel = 'noopener';
        thumb.setAttribute('aria-label', '動画を開く');
      }
      if (thumbUrl) {
        const img = document.createElement('img');
        img.src = thumbUrl;
        img.alt = `${title || '楽曲'} のサムネイル`;
        img.loading = 'lazy';
        img.decoding = 'async';
        thumb.appendChild(img);
      } else {
        thumb.textContent = 'NO IMAGE';
      }
      return thumb;
    }
    function createSongListItem(row){
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
        return `<button type="button" class="filter-chip${active ? ' active' : ''}" data-kind="${kind}">${kind}</button>`;
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
      updateFilterSummary(kinds);
      if (state.filterSheetOpen) renderMobileFilterOptions(kinds);

      setStatus(q
        ? `${rows.length}件ヒット（全${filtered.length}件）`
        : `表示中 ${rows.length}件（全${allRows.length}件）`);

      if (rows.length === 0) {
        hint.textContent = q ? '該当なし' : '検索結果がここに表示されます。';
        tableWrap.style.display = 'none';
        listWrap.style.display = 'none';
        state.desktopRows = [];
        if (state.desktopSelectedKey) closeDesktopHistory();
        state.activeSnapIndex = -1;
        return;
      }

      hint.textContent = '';
      scheduleFilterMetrics();
      state.activeSnapIndex = 0;
      if (isDesktopMode()) {
        if (state.desktopSelectedKey && !rows.some(row => desktopRowKey(row) === state.desktopSelectedKey)) {
          closeDesktopHistory();
        }
        listWrap.style.display = 'none';
        tableWrap.style.display = 'block';
        renderDesktopTable(rows);
      } else {
        state.desktopRows = [];
        tableWrap.style.display = 'none';
        listWrap.style.display = 'block';
        renderListRowsInChunks(listWrap, rows, renderToken);
      }
      updateScrollGradient();
    }

    $('btn-back').addEventListener('click', ()=>{
      abortCurrentHistoryRequest();
      state.historyRenderSeq += 1;
      updateHistoryRouteParams({ rowId: '', historyRef: '' });
      showPage('page-list');
      const scroller = getListScroller();
      if (scroller) scroller.scrollTop = state.lastScroll || 0;
      if (!state.cache[state.current]) {
        setActiveTab('songs');
        warmCaches().catch(()=>{});
      }
      updateCompactFilterMode();
    });

    function handleAppKeydown(event){
      if (state.filterSheetOpen && event.key === 'Escape') {
        event.preventDefault();
        closeMobileFilterSheet();
        return;
      }
      if (!isDesktopMode() || !$('page-list').classList.contains('active')) return;

      const target = event.target;
      const typing = target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (event.key === '/' && !typing) {
        event.preventDefault();
        $('q').focus();
        return;
      }
      if (event.key === 'Escape') {
        if (state.desktopSelectedKey) {
          event.preventDefault();
          closeDesktopHistory();
          return;
        }
        if ($('q').value) {
          event.preventDefault();
          $('q').value = '';
          render();
        }
        return;
      }
      if (typing || state.desktopRows.length === 0) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const current = state.desktopActiveIndex < 0 ? 0 : state.desktopActiveIndex;
        selectDesktopResultRow(current + delta, { focus: true });
        return;
      }
      const activeRow = state.desktopRows[state.desktopActiveIndex];
      if (!activeRow) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        openHistory(activeRow);
      } else if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copyPair(activeRow.title, activeRow.artist);
      }
    }
    document.addEventListener('keydown', handleAppKeydown);

    desktopMedia.addEventListener('change', event=>{
      state.desktopMode = event.matches;
      if (!event.matches && state.desktopSelectedKey) closeDesktopHistory();
      if (!isMobileLayout() && state.filterSheetOpen) {
        closeMobileFilterSheet({ restoreFocus: false });
      }
      render();
      updateCompactFilterMode();
    });

    window.addEventListener('resize', ()=>{
      clearTimeout(state.debounce);
      state.debounce=setTimeout(()=>{
        if (!isMobileLayout() && state.filterSheetOpen) closeMobileFilterSheet({ restoreFocus: false });
        updateKeyboardOffset();
        updateViewportMetrics();
        updateCompactFilterMode();
      },150);
    });

    if (window.visualViewport) {
      const onViewportChanged = () => {
        updateKeyboardOffset();
        updateViewportMetrics();
        scheduleMobileLayoutSync();
      };
      window.visualViewport.addEventListener('resize', onViewportChanged);
      window.visualViewport.addEventListener('scroll', onViewportChanged);
    }
    window.addEventListener('scroll', ()=>{
      if (!$('page-list').classList.contains('active')) {
        const y = window.scrollY || document.documentElement.scrollTop || 0;
        $('to-top').classList.toggle('show', y > 280);
      }
    });

    getListScroller().addEventListener('scroll', ()=>{
      const y = getListScroller().scrollTop || 0;
      $('to-top').classList.toggle('show', y > 280 && $('page-list').classList.contains('active'));
      updateScrollGradient();
      updateAutoFilterCollapse();
    });

    (function init(){
      document.getElementById('tab-songs').addEventListener('click', ()=> setActiveTab('songs'));
      document.getElementById('tab-gags').addEventListener('click',  ()=> setActiveTab('gags'));
      $('q').addEventListener('input', ()=>{ clearTimeout(state.debounce); state.debounce=setTimeout(render,200); });
      $('q').addEventListener('focus', ()=>{
        [0, 60, 150, 280].forEach(ms => {
          window.setTimeout(() => {
            updateKeyboardOffset();
            updateViewportMetrics();
            ensureSearchInputVisible();
          }, ms);
        });
      });
      $('q').addEventListener('blur', ()=>{
        window.setTimeout(() => {
          updateKeyboardOffset();
          updateViewportMetrics();
        }, 90);
      });
      $('filter-toggle').addEventListener('click', ()=>{
        if (isMobileLayout()) {
          openMobileFilterSheet();
          return;
        }
        if (state.isFilterCompact) {
          expandFilterPanel();
          return;
        }
        state.isFilterCompact = true;
        state.isFilterExpandedManually = false;
        updateCompactFilterMode();
      });
      $('mobile-filter-close').addEventListener('click', ()=>closeMobileFilterSheet());
      $('mobile-filter-backdrop').addEventListener('click', ()=>closeMobileFilterSheet());
      $('mobile-filter-apply').addEventListener('click', applyMobileFilters);
      $('mobile-filter-reset').addEventListener('click', ()=>{
        $('mobile-filter-options').querySelectorAll('input[type="checkbox"]')
          .forEach(input => { input.checked = true; });
      });
      $('desktop-history-close').addEventListener('click', ()=>closeDesktopHistory());
      showPage('page-list');
      updateKeyboardOffset();
      updateViewportMetrics();
      const params = new URLSearchParams(window.location.search);
      const historyRef = params.get('historyRef') || '';
      const rowId = params.get('rowId') || '';
      if (historyRef) {
        const guessed = parseArtistTitleFromRowId(rowId);
        const historyTarget = {
          artist: guessed.artist || '不明',
          title: guessed.title || '不明',
          rowId,
          historyRef
        };
        if (isDesktopMode()) {
          state.pendingDesktopHistory = historyTarget;
          setActiveTab('songs');
        } else {
          showPage('page-history');
          renderHistory(historyTarget);
        }
      } else {
        setActiveTab('songs');
      }
      renderServerResponse();
      updateCompactFilterMode();
      updateScrollGradient();
      updateAutoFilterCollapse();
      scheduleMobileLayoutSync();
    })();
  
