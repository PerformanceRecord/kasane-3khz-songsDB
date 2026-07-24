(() => {
  'use strict';

  const originalCreateSongListItem = createSongListItem;
  let inlineRequestSeq = 0;
  let inlineController = null;
  let expandedCard = null;
  let expandedKey = '';

  function historyKey(row) {
    return String(row.historyRef || row.rowId || '').trim();
  }

  function closeExpandedCard({ abort = true } = {}) {
    if (abort && inlineController) {
      inlineController.abort();
      inlineController = null;
    }
    inlineRequestSeq += 1;
    if (!expandedCard) {
      expandedKey = '';
      return;
    }
    const region = expandedCard.querySelector('.inline-history');
    const control = expandedCard.querySelector('.inline-history-trigger');
    if (region) {
      region.hidden = true;
      region.replaceChildren();
    }
    if (control) control.setAttribute('aria-expanded', 'false');
    expandedCard.classList.remove('item-history-open');
    expandedCard = null;
    expandedKey = '';
    scheduleMobileLayoutSync();
  }

  function formatInlineDate(date) {
    return formatDate8(Number(date) || 0);
  }

  function renderLoading(region) {
    region.replaceChildren();
    const status = document.createElement('div');
    status.className = 'inline-history-status';
    status.textContent = '履歴を読み込み中…';
    region.appendChild(status);
  }

  function renderEmpty(region) {
    region.replaceChildren();
    const status = document.createElement('div');
    status.className = 'inline-history-status';
    status.textContent = '該当する履歴がありません。';
    region.appendChild(status);
  }

  function renderError(region, row, control) {
    region.replaceChildren();
    const status = document.createElement('div');
    status.className = 'inline-history-status inline-history-error';
    status.textContent = '履歴を取得できませんでした。';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-subtle inline-history-retry';
    retry.textContent = '再試行';
    retry.addEventListener('click', () => openInlineHistory(control.closest('.item'), row, control, true));
    region.append(status, retry);
  }

  function renderEntries(region, entries) {
    region.replaceChildren();
    const header = document.createElement('div');
    header.className = 'inline-history-heading';
    header.textContent = `歌唱履歴 ${entries.length}件`;
    region.appendChild(header);

    const list = document.createElement('div');
    list.className = 'inline-history-list';
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const row = document.createElement(entry.url ? 'a' : 'div');
      row.className = 'inline-history-row';
      if (entry.url) {
        row.href = entry.url;
        row.target = '_blank';
        row.rel = 'noopener';
      }

      const date = document.createElement('time');
      date.className = 'inline-history-date';
      date.textContent = formatInlineDate(entry.date);
      row.appendChild(date);

      const action = document.createElement('span');
      action.className = entry.url ? 'inline-history-link-label' : 'inline-history-no-link';
      action.textContent = entry.url ? '▶ 開く' : 'リンクなし';
      row.appendChild(action);
      fragment.appendChild(row);
    }
    list.appendChild(fragment);
    region.appendChild(list);
  }

  async function openInlineHistory(card, row, control, forceReload = false) {
    if (!card || !row.historyRef) return;
    const key = historyKey(row);
    if (!forceReload && expandedCard === card && expandedKey === key) {
      closeExpandedCard();
      return;
    }

    closeExpandedCard();
    expandedCard = card;
    expandedKey = key;
    card.classList.add('item-history-open');

    const region = card.querySelector('.inline-history');
    if (!region) return;
    region.hidden = false;
    control.setAttribute('aria-expanded', 'true');
    renderLoading(region);
    scheduleMobileLayoutSync();

    const seq = ++inlineRequestSeq;
    inlineController = new AbortController();
    const controller = inlineController;

    try {
      const entries = await fetchSongHistoryByRef(row.historyRef, {
        signal: controller.signal
      });
      if (seq !== inlineRequestSeq || expandedCard !== card || expandedKey !== key) return;
      if (entries.length === 0) renderEmpty(region);
      else renderEntries(region, entries);
      requestAnimationFrame(() => {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        scheduleMobileLayoutSync();
      });
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (seq !== inlineRequestSeq || expandedCard !== card || expandedKey !== key) return;
      renderError(region, row, control);
      scheduleMobileLayoutSync();
    } finally {
      if (inlineController === controller) inlineController = null;
    }
  }

  createSongListItem = function createSongListItemWithInlineHistory(row) {
    const item = originalCreateSongListItem(row);
    const oldButton = [...item.querySelectorAll('.mobile-actions .btn')]
      .find((button) => button.textContent.trim() === '履歴');
    if (oldButton) oldButton.remove();

    const region = document.createElement('div');
    region.className = 'inline-history';
    region.hidden = true;
    item.appendChild(region);

    const trigger = item.querySelector('.l1');
    if (!trigger) return item;
    trigger.classList.add('inline-history-trigger');
    const regionId = `inline-history-${String(row.rowId || Math.random()).replace(/[^a-zA-Z0-9_-]/g, '-').slice(-48)}`;
    trigger.setAttribute('aria-controls', regionId);
    trigger.setAttribute('aria-expanded', 'false');
    region.id = regionId;

    if (!row.historyRef) {
      trigger.setAttribute('aria-disabled', 'true');
      return item;
    }
    item.classList.add('item-history-interactive');
    trigger.tabIndex = 0;
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-label', `${row.artist || ''} ${row.title || ''} の歌唱履歴を開く`);
    trigger.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openInlineHistory(item, row, trigger);
    });
    item.addEventListener('click', (event) => {
      if (event.target.closest('a,button,input,select')) return;
      openInlineHistory(item, row, trigger);
    });
    return item;
  };

  const originalRender = render;
  render = function renderWithInlineHistoryReset() {
    closeExpandedCard();
    return originalRender();
  };
})();
