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
    const button = expandedCard.querySelector('.inline-history-toggle');
    if (region) {
      region.hidden = true;
      region.replaceChildren();
    }
    if (button) {
      button.setAttribute('aria-expanded', 'false');
      button.textContent = '履歴 ▼';
    }
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

  function renderError(region, row, button) {
    region.replaceChildren();
    const status = document.createElement('div');
    status.className = 'inline-history-status inline-history-error';
    status.textContent = '履歴を取得できませんでした。';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-subtle inline-history-retry';
    retry.textContent = '再試行';
    retry.addEventListener('click', () => openInlineHistory(button.closest('.item'), row, button, true));
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

  async function openInlineHistory(card, row, button, forceReload = false) {
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
    button.setAttribute('aria-expanded', 'true');
    button.textContent = '履歴 ▲';
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
      renderError(region, row, button);
      scheduleMobileLayoutSync();
    } finally {
      if (inlineController === controller) inlineController = null;
    }
  }

  createSongListItem = function createSongListItemWithInlineHistory(row) {
    const item = originalCreateSongListItem(row);
    const oldButton = [...item.querySelectorAll('.mobile-actions .btn')]
      .find((button) => button.textContent.trim() === '履歴');

    const region = document.createElement('div');
    region.className = 'inline-history';
    region.hidden = true;
    item.appendChild(region);

    if (!oldButton) return item;
    const button = oldButton.cloneNode(true);
    button.classList.add('inline-history-toggle');
    button.textContent = '履歴 ▼';
    button.disabled = !row.historyRef;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', `inline-history-${String(row.rowId || Math.random()).replace(/[^a-zA-Z0-9_-]/g, '-').slice(-48)}`);
    region.id = button.getAttribute('aria-controls');
    button.addEventListener('click', () => openInlineHistory(item, row, button));
    oldButton.replaceWith(button);
    return item;
  };

  const originalRender = render;
  render = function renderWithInlineHistoryReset() {
    closeExpandedCard();
    return originalRender();
  };
})();
