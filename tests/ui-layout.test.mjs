import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, appCss, historyCss, appJs, historyJs] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/css/app.css', import.meta.url), 'utf8'),
  readFile(new URL('../assets/css/inline-history.css', import.meta.url), 'utf8'),
  readFile(new URL('../assets/js/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/js/inline-history.js', import.meta.url), 'utf8')
]);

test('responsive UI landmarks are present exactly once', () => {
  for (const id of [
    'active-filter-summary',
    'desktop-history-panel',
    'desktop-history-title',
    'desktop-history-list',
    'mobile-filter-backdrop',
    'mobile-filter-sheet',
    'mobile-filter-options'
  ]) {
    assert.equal(
      (html.match(new RegExp(`id="${id}"`, 'g')) || []).length,
      1,
      `${id} should be unique`
    );
  }
});

test('viewport remains responsive without disabling browser zoom', () => {
  const viewport = html.match(/<meta name="viewport" content="([^"]+)">/)?.[1] || '';
  assert.match(viewport, /width=device-width/);
  assert.match(viewport, /viewport-fit=cover/);
  assert.doesNotMatch(viewport, /user-scalable=no/);
});

test('mobile layout prevents horizontal scrolling and keeps one result scroller', () => {
  assert.match(appCss, /overflow-x:clip/);
  assert.match(appCss, /overscroll-behavior-x:none/);
  assert.match(appCss, /@media \(max-width:768px\)/);
  assert.match(appCss, /\.result-scroll\{[\s\S]*?overflow-y:auto;[\s\S]*?overflow-x:clip;/);
  assert.match(appCss, /\.mobile-actions \.btn\{[\s\S]*?min-height:42px;/);
  assert.match(appCss, /\.mobile-filter-sheet\{/);
});

test('desktop layout uses a wide two-pane table and history workspace', () => {
  assert.match(appCss, /@media \(min-width:769px\) and \(hover:hover\) and \(pointer:fine\)/);
  assert.match(appCss, /max-width:1280px/);
  assert.match(appCss, /grid-template-columns:minmax\(0,1fr\) minmax\(260px,34%\)/);
  assert.match(appCss, /\.desktop-history-panel\{/);
  assert.match(appJs, /function renderDesktopTable\(rows\)/);
  assert.match(appJs, /function openDesktopHistory\(/);
  assert.match(appJs, /function handleAppKeydown\(event\)/);
});

test('mobile cards open inline history without a small history button', () => {
  assert.match(historyJs, /oldButton\.remove\(\)/);
  assert.match(historyJs, /item\.addEventListener\('click'/);
  assert.match(historyJs, /trigger\.setAttribute\('role', 'button'\)/);
  assert.match(historyCss, /\.inline-history-trigger\{/);
  assert.match(historyCss, /min-height:48px/);
});
