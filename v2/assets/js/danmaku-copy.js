(function(){
  'use strict';

  var select = document.getElementById('dm-select');
  var openButton = document.getElementById('dm-open');
  var sheet = document.getElementById('dm-sheet');
  var closeButton = document.getElementById('dm-close');
  var dragHandle = document.getElementById('dm-drag');
  var addButton = document.getElementById('dm-add');
  var clearButton = document.getElementById('dm-clear');
  var preview = document.getElementById('dm-preview');
  var previewText = document.getElementById('dm-preview-text');
  var copyButton = document.getElementById('dm-copy');
  var quickCopyButton = document.getElementById('dm-quick-copy');
  var toast = document.getElementById('toast');
  if (!select || !openButton || !sheet || !closeButton || !dragHandle ||
      !addButton || !clearButton || !preview || !previewText || !copyButton || !quickCopyButton || !toast) return;

  var STORAGE_KEY = 'saikyoDB.danmakuDraft.v1';
  var LIFETIME = 30 * 60 * 1000;
  var parts = [];
  var expiresAt = 0;
  var expiryTimer = 0;
  var toastTimer = 0;
  var closeTimer = 0;
  var copying = false;
  var revision = 0;
  var scrollState = null;
  var dragStart = null;
  var backdropPressed = false;
  var defaultSelection = select.value;
  var optionValues = Array.from(select.options, function(option){ return option.value; });

  function removeSavedDraft(){
    try { localStorage.removeItem(STORAGE_KEY); } catch (_error) {}
  }

  function render(){
    previewText.textContent = parts.join('');
    clearButton.disabled = copying || parts.length === 0;
    copyButton.disabled = copying || parts.length === 0;
    quickCopyButton.disabled = copying || parts.length === 0;
    addButton.disabled = copying;
    select.disabled = copying;
  }

  function scheduleExpiry(){
    window.clearTimeout(expiryTimer);
    if (expiresAt) expiryTimer = window.setTimeout(checkExpiry, Math.max(0, expiresAt - Date.now()));
  }

  function checkExpiry(){
    if (!expiresAt) return false;
    if (Date.now() < expiresAt) {
      scheduleExpiry();
      return false;
    }
    parts = [];
    expiresAt = 0;
    select.value = defaultSelection;
    revision++;
    window.clearTimeout(expiryTimer);
    removeSavedDraft();
    render();
    return true;
  }

  function saveDraft(){
    expiresAt = Date.now() + LIFETIME;
    revision++;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        parts: parts,
        selected: select.value,
        expiresAt: expiresAt
      }));
    } catch (_error) {}
    scheduleExpiry();
  }

  function restoreDraft(){
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.parts) ||
          !saved.parts.every(function(part){ return optionValues.includes(part); }) ||
          !optionValues.includes(saved.selected) ||
          !Number.isFinite(saved.expiresAt) || saved.expiresAt <= Date.now()) {
        removeSavedDraft();
        return;
      }
      parts = saved.parts.slice();
      select.value = saved.selected;
      expiresAt = saved.expiresAt;
      scheduleExpiry();
    } catch (_error) {
      removeSavedDraft();
    }
  }

  function showToast(message){
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function(){
      toast.classList.remove('show');
    }, 1400);
  }

  function lockScroll(){
    scrollState = {
      x: window.scrollX,
      y: window.scrollY,
      bodyStyle: document.body.getAttribute('style'),
      rootStyle: document.documentElement.getAttribute('style')
    };
    var scrollbar = window.innerWidth - document.documentElement.clientWidth;
    var padding = parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = -scrollState.y + 'px';
    document.body.style.left = -scrollState.x + 'px';
    document.body.style.width = '100%';
    document.body.style.paddingRight = padding + scrollbar + 'px';
    document.documentElement.style.overflow = 'hidden';
  }

  function unlockScroll(){
    if (!scrollState) return;
    var saved = scrollState;
    scrollState = null;
    if (saved.bodyStyle === null) document.body.removeAttribute('style');
    else document.body.setAttribute('style', saved.bodyStyle);
    if (saved.rootStyle === null) document.documentElement.removeAttribute('style');
    else document.documentElement.setAttribute('style', saved.rootStyle);
    window.scrollTo(saved.x, saved.y);
  }

  function finishClose(){
    window.clearTimeout(closeTimer);
    if (sheet.open) sheet.close();
    sheet.classList.remove('dm-closing');
    document.body.appendChild(toast);
    openButton.setAttribute('aria-expanded', 'false');
    unlockScroll();
    openButton.focus({ preventScroll: true });
  }

  function closeSheet(){
    if (!sheet.open || sheet.classList.contains('dm-closing')) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishClose();
      return;
    }
    sheet.classList.add('dm-closing');
    closeTimer = window.setTimeout(finishClose, 180);
  }

  function openSheet(){
    checkExpiry();
    if (sheet.open) return;
    render();
    lockScroll();
    sheet.showModal();
    sheet.appendChild(toast);
    openButton.setAttribute('aria-expanded', 'true');
    select.focus({ preventScroll: true });
  }

  async function copyText(text){
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    (sheet.open ? sheet : document.body).appendChild(textarea);
    try {
      textarea.select();
      if (!document.execCommand('copy')) throw new Error('Copy was rejected');
    } finally {
      textarea.remove();
    }
  }

  openButton.addEventListener('click', openSheet);
  closeButton.addEventListener('click', closeSheet);
  sheet.addEventListener('cancel', function(event){
    event.preventDefault();
    closeSheet();
  });
  sheet.addEventListener('close', function(){
    // Also restore the page if the browser closes the native dialog directly.
    if (!sheet.open && scrollState) finishClose();
  });
  sheet.addEventListener('pointerdown', function(event){
    var rect = sheet.getBoundingClientRect();
    backdropPressed = event.target === sheet &&
      (event.clientX < rect.left || event.clientX > rect.right ||
       event.clientY < rect.top || event.clientY > rect.bottom);
  });
  sheet.addEventListener('click', function(event){
    if (backdropPressed && event.target === sheet) closeSheet();
    backdropPressed = false;
  });
  dragHandle.addEventListener('pointerdown', function(event){
    if (!event.isPrimary || event.button !== 0 || event.target.closest('button')) return;
    dragStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    dragHandle.setPointerCapture(event.pointerId);
  });
  dragHandle.addEventListener('pointerup', function(event){
    if (!dragStart || dragStart.id !== event.pointerId) return;
    var dx = event.clientX - dragStart.x;
    var dy = event.clientY - dragStart.y;
    dragStart = null;
    if (dy >= 64 && dy > Math.abs(dx) * 1.3) closeSheet();
  });
  dragHandle.addEventListener('pointercancel', function(){ dragStart = null; });

  addButton.addEventListener('click', function(){
    if (copying) return;
    checkExpiry();
    parts.push(select.value);
    saveDraft();
    render();
  });
  clearButton.addEventListener('click', function(){
    if (copying || checkExpiry() || !parts.length) return;
    parts = [];
    expiresAt = 0;
    revision++;
    window.clearTimeout(expiryTimer);
    removeSavedDraft();
    render();
  });
  select.addEventListener('change', function(){
    var selected = select.value;
    checkExpiry();
    select.value = selected;
    saveDraft();
  });
  async function copyDraft(){
    if (copying || checkExpiry() || !parts.length) return;
    var text = parts.join('');
    var copiedRevision = revision;
    copying = true;
    render();
    try {
      await copyText(text);
      if (revision === copiedRevision && !checkExpiry()) saveDraft();
      showToast('コピーしました');
      closeSheet();
    } catch (_error) {
      showToast('コピーに失敗しました');
    } finally {
      copying = false;
      render();
    }
  }
  copyButton.addEventListener('click', copyDraft);
  quickCopyButton.addEventListener('click', copyDraft);
  document.addEventListener('visibilitychange', checkExpiry);
  window.addEventListener('focus', checkExpiry);
  window.addEventListener('pageshow', checkExpiry);

  restoreDraft();
  render();
})();
