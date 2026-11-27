import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const chromePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].find(candidate => candidate && existsSync(candidate));
const root = new URL('../', import.meta.url);
const storageKey = 'saikyoDB.danmakuDraft.v1';
const lifetime = 30 * 60 * 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class BrowserConnection {
  constructor(socket) {
    this.socket = socket;
    this.pending = new Map();
    this.nextId = 0;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  call(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + ' timed out'));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}

test('danmaku composer browser behavior', { skip: !chromePath, timeout: 60000 }, async t => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'saikyo-danmaku-test-'));
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (!['index.html', 'v2/index.html', 'v2/assets/js/danmaku-copy.js',
        'v2/assets/css/app-v2-inline-history.css'].includes(file)) {
        response.writeHead(404).end();
        return;
      }
      let content = await readFile(new URL(file, root), 'utf8');
      if (file.endsWith('.html')) {
        // Isolate the editor from external song and YouTube requests.
        content = content.replace(/<script[^>]*src="[^"]*(?:player-queue-v2|app-v2-inline-history)\.js[^"]*"[^>]*><\/script>/g, '');
      }
      const type = file.endsWith('.css') ? 'text/css' :
        file.endsWith('.js') ? 'application/javascript' : 'text/html';
      response.writeHead(200, { 'content-type': type + '; charset=utf-8' }).end(content);
    } catch (error) {
      response.writeHead(500).end(error.message);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = spawn(chromePath, [
    '--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let connection;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
        break;
      } catch {
        await sleep(50);
      }
    }
    assert.ok(port, 'Chrome remote debugging should start');
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    connection = new BrowserConnection(socket);
    const evaluate = expression => connection.evaluate(expression);
    async function load(page = '/index.html') {
      await connection.call('Page.navigate', { url: origin + page });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate('document.readyState === "complete" && !!document.getElementById("dm-open")')) return;
        await sleep(20);
      }
      assert.fail('editor page should load');
    }
    const click = id => evaluate('document.getElementById(' + JSON.stringify(id) + ').click()');
    const draft = () => evaluate('JSON.parse(localStorage.getItem(' + JSON.stringify(storageKey) + '))');
    const preview = () => evaluate('document.getElementById("dm-preview").textContent');
    async function close() {
      await click('dm-close');
      await sleep(220);
    }
    async function mockClipboard(fail = false) {
      await evaluate(`Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
        writeText: async text => { ${fail ? "throw new Error('denied')" : "window.copiedText = text"} }
      }})`);
    }
    await connection.call('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    await load();
    await evaluate('localStorage.clear(); localStorage.setItem("unrelated-setting", "keep")');
    await load();

    await t.test('opens from launcher with disabled empty actions and no layout shift', async () => {
      const before = await evaluate('document.querySelector(".toolbar").getBoundingClientRect().toJSON()');
      await click('dm-open');
      assert.equal(await evaluate('document.getElementById("dm-sheet").open'), true);
      assert.equal(await evaluate('document.getElementById("dm-title").textContent'), '弾幕カスタマイズ');
      assert.deepEqual(await evaluate('["dm-clear","dm-copy","dm-quick-copy"].map(id => document.getElementById(id).disabled)'), [true, true, true]);
      const after = await evaluate('document.querySelector(".toolbar").getBoundingClientRect().toJSON()');
      assert.equal(after.width, before.width);
      assert.equal(after.x, before.x);
      assert.equal(await evaluate('document.body.style.position'), 'fixed');
    });

    await t.test('concatenates repeated and mixed parts without separators or a part limit', async () => {
      await click('dm-add');
      await click('dm-add');
      await evaluate('document.getElementById("dm-select").selectedIndex = 1; document.getElementById("dm-select").dispatchEvent(new Event("change"))');
      await click('dm-add');
      assert.equal(await preview(), '✨💙💜✨✨💙💜✨🎵🩵🤍🎵');
      assert.equal((await draft()).selected, '🎵🩵🤍🎵');
      assert.equal((await draft()).parts.length, 3);
      assert.equal(await evaluate('document.getElementById("dm-open").textContent'), await preview());
      await click('dm-add');
      assert.equal(await preview(), '✨💙💜✨✨💙💜✨🎵🩵🤍🎵🎵🩵🤍🎵');
      assert.equal(await evaluate('document.getElementById("dm-add").disabled'), false);
      assert.equal(await evaluate('document.getElementById("dm-select").selectedIndex'), 1);
    });

    await t.test('closing, reopening and reloading preserve content without extending expiry', async () => {
      const before = await draft();
      await close();
      assert.equal(await evaluate('document.body.style.position'), '');
      await click('dm-open');
      assert.equal((await draft()).expiresAt, before.expiresAt);
      await close();
      await load();
      assert.deepEqual(await draft(), before);
      assert.equal(await preview(), before.parts.join(''));
      assert.equal(await evaluate('document.getElementById("dm-open").textContent'), before.parts.join(''));
      await click('dm-open');
      assert.equal(await evaluate('document.getElementById("dm-select").value'), before.selected);
    });

    await t.test('failed copy preserves draft and open sheet, successful copy closes and extends expiry', async () => {
      const before = await draft();
      await mockClipboard(true);
      await click('dm-copy');
      await sleep(20);
      assert.equal(await evaluate('document.getElementById("dm-sheet").open'), true);
      assert.deepEqual(await draft(), before);
      assert.equal(await evaluate('document.getElementById("toast").textContent'), 'コピーに失敗しました');
      await mockClipboard();
      await click('dm-copy');
      await sleep(20);
      assert.equal(await evaluate('window.copiedText'), before.parts.join(''));
      assert.equal(await evaluate('document.getElementById("dm-sheet").open'), false);
      assert.ok((await draft()).expiresAt > before.expiresAt);
      await click('dm-open');
      assert.equal(await preview(), before.parts.join(''));
    });

    await t.test('launcher copy works while closed and extends expiry without opening the sheet', async () => {
      await close();
      await mockClipboard();
      const before = await draft();
      await click('dm-quick-copy');
      await sleep(20);
      assert.equal(await evaluate('window.copiedText'), before.parts.join(''));
      assert.equal(await evaluate('document.getElementById("dm-sheet").open'), false);
      assert.ok((await draft()).expiresAt > before.expiresAt);
      await mockClipboard(true);
      const saved = await draft();
      await click('dm-quick-copy');
      await sleep(20);
      assert.deepEqual(await draft(), saved);
      assert.equal(await evaluate('document.getElementById("toast").textContent'), 'コピーに失敗しました');
      await click('dm-open');
    });

    await t.test('editing renews a 30-minute lifetime and clear removes only its own key', async () => {
      const start = await evaluate('Date.now()');
      await click('dm-add');
      const saved = await draft();
      assert.ok(saved.expiresAt >= start + lifetime && saved.expiresAt <= Date.now() + lifetime + 1000);
      await click('dm-clear');
      assert.equal(await draft(), null);
      assert.equal(await preview(), '');
      assert.equal(await evaluate('document.getElementById("dm-open").textContent'), '弾幕');
      assert.equal(await evaluate('document.getElementById("dm-quick-copy").disabled'), true);
      assert.equal(await evaluate('localStorage.getItem("unrelated-setting")'), 'keep');
    });

    await t.test('selection and addition extend expiry without losing the selected option', async () => {
      await click('dm-add');
      const before = await draft();
      await evaluate('window.originalNow = Date.now; Date.now = () => window.originalNow() + 60000');
      await evaluate('document.getElementById("dm-select").selectedIndex = 3; document.getElementById("dm-select").dispatchEvent(new Event("change"))');
      assert.ok((await draft()).expiresAt >= before.expiresAt + 60000);
      assert.equal((await draft()).selected, '⚛️🌐♬*.+');
      const beforeAdd = await draft();
      await evaluate('Date.now = () => window.originalNow() + 120000');
      await click('dm-add');
      assert.ok((await draft()).expiresAt >= beforeAdd.expiresAt + 60000);
      assert.deepEqual((await draft()).parts, [...before.parts, '⚛️🌐♬*.+']);
      await evaluate('Date.now = window.originalNow');
      await click('dm-clear');
    });

    await t.test('expired and corrupt saved data are removed during load', async () => {
      await evaluate(`localStorage.setItem('${storageKey}', JSON.stringify({parts:['✨💙💜✨'],selected:'✨💙💜✨',expiresAt:Date.now()-1}))`);
      await load();
      assert.equal(await preview(), '');
      assert.equal(await draft(), null);
      await evaluate(`localStorage.setItem('${storageKey}', '{broken')`);
      await load();
      assert.equal(await draft(), null);
    });

    await t.test('visible-page expiry clears content automatically', async () => {
      await evaluate(`localStorage.setItem('${storageKey}', JSON.stringify({parts:['✨💙💜✨'],selected:'✨💙💜✨',expiresAt:Date.now()+600}))`);
      await load();
      assert.equal(await preview(), '✨💙💜✨');
      await click('dm-open');
      await sleep(650);
      assert.equal(await preview(), '');
      assert.equal(await draft(), null);
      assert.equal(await evaluate('document.getElementById("dm-copy").disabled'), true);
      assert.equal(await evaluate('document.getElementById("dm-open").textContent'), '弾幕');
      await close();
    });

    await t.test('opening after a suspended-page expiry resets the draft', async () => {
      await click('dm-open');
      await click('dm-add');
      await close();
      await evaluate('window.realNow = Date.now; Date.now = () => window.realNow() + 1800001');
      await click('dm-open');
      assert.equal(await preview(), '');
      assert.equal(await draft(), null);
      await evaluate('Date.now = window.realNow');
    });

    await t.test('unavailable localStorage still permits editing and copying', async () => {
      await close();
      await evaluate('Storage.prototype.getItem = Storage.prototype.setItem = Storage.prototype.removeItem = () => { throw new Error("blocked"); }');
      await click('dm-open');
      await click('dm-add');
      await mockClipboard();
      await click('dm-copy');
      await sleep(20);
      assert.equal(await evaluate('window.copiedText'), '✨💙💜✨');
      assert.equal(await evaluate('document.getElementById("dm-sheet").open'), false);
      await click('dm-open');
      assert.equal(await preview(), '✨💙💜✨');
      await close();
      await load();
    });

    await t.test('fallback copies inside the modal and handles a rejected fallback', async () => {
      await click('dm-open');
      await click('dm-add');
      await evaluate('Object.defineProperty(navigator, "clipboard", {configurable:true,value:undefined}); document.execCommand = () => false');
      await click('dm-copy');
      await sleep(20);
      assert.equal(await evaluate('document.getElementById("dm-sheet").open'), true);
      assert.equal(await evaluate('document.querySelectorAll("#dm-sheet textarea").length'), 0);
      await evaluate('document.execCommand = () => { window.copiedText = document.querySelector("#dm-sheet textarea").value; return true; }');
      await click('dm-copy');
      await sleep(20);
      assert.equal(await evaluate('window.copiedText'), await preview());
      assert.equal(await evaluate('document.getElementById("dm-sheet").open'), false);
    });

    await t.test('pending copy prevents duplicate copies and concurrent edits', async () => {
      await click('dm-open');
      await evaluate('Object.defineProperty(navigator, "clipboard", {configurable:true,value:{writeText:() => new Promise(resolve => { window.finishCopy = resolve; window.copyCalls = (window.copyCalls || 0) + 1; })}})');
      await click('dm-copy');
      const text = await preview();
      await click('dm-add');
      await click('dm-clear');
      await click('dm-copy');
      assert.equal(await preview(), text);
      assert.equal(await evaluate('window.copyCalls'), 1);
      await evaluate('window.finishCopy()');
      await sleep(20);
      assert.equal(await evaluate('document.getElementById("dm-sheet").open'), false);
    });

    await t.test('real browser clipboard matches the preview', async () => {
      await load();
      await connection.call('Emulation.setFocusEmulationEnabled', {enabled:true});
      await connection.call('Browser.grantPermissions', {
        origin, permissions:['clipboardReadWrite','clipboardSanitizedWrite']
      });
      await click('dm-open');
      const text = await preview();
      await click('dm-copy');
      await sleep(50);
      assert.equal(await evaluate('navigator.clipboard.readText()'), text);
      assert.equal(await evaluate('document.getElementById("dm-sheet").open'), false);
    });

    await t.test('backdrop and Escape dismiss, focus returns to launcher', async () => {
      await click('dm-open');
      await connection.call('Input.dispatchMouseEvent', { type:'mousePressed', x:5, y:5, button:'left', clickCount:1 });
      await connection.call('Input.dispatchMouseEvent', { type:'mouseReleased', x:5, y:5, button:'left', clickCount:1 });
      assert.equal(await evaluate('document.getElementById("dm-sheet").open'), false);
      await click('dm-open');
      await connection.call('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
      await connection.call('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
      assert.equal(await evaluate('document.getElementById("dm-sheet").open'), false);
      assert.equal(await evaluate('document.activeElement.id'), 'dm-open');
    });

    await t.test('launcher card stays inside the viewport while the song page scrolls', async () => {
      for (const width of [320, 390, 1024, 1440]) {
        await connection.call('Emulation.setDeviceMetricsOverride', {width,height:850,deviceScaleFactor:1,mobile:width<700});
        await evaluate('document.querySelector(".results").style.minHeight="2000px";window.scrollTo(0,document.documentElement.scrollHeight)');
        const dock = await evaluate(`(() => {
          const element=document.querySelector('.danmaku-dock');
          const rect=element.getBoundingClientRect();
          const launcher=document.getElementById('dm-open').getBoundingClientRect();
          const copy=document.getElementById('dm-quick-copy').getBoundingClientRect();
          return {fixed:getComputedStyle(element).position==='fixed',
            inViewport:rect.top>=0 && rect.bottom<=innerHeight+1 && rect.left>=0 && rect.right<=innerWidth+1,
            sameRow:Math.abs(launcher.y-copy.y)<2};
        })()`);
        assert.deepEqual(dock,{fixed:true,inViewport:true,sameRow:true},String(width));
        await evaluate('document.querySelector(".results").style.minHeight="";window.scrollTo(0,0)');
      }
    });

    await t.test('mobile and desktop previews stay on one line with ellipsis and no visible scrolling', async () => {
      for (const width of [320, 390, 1440]) {
        await connection.call('Emulation.setDeviceMetricsOverride', {width, height:850, deviceScaleFactor:1, mobile:width<700});
        await click('dm-open');
        await click('dm-clear');
        for (let option = 0; option < 5; option++) {
          await click('dm-clear');
          await evaluate('document.getElementById("dm-select").selectedIndex = ' + option);
          await evaluate('for (let i=0;i<30;i++) document.getElementById("dm-add").click()');
          assert.equal((await draft()).parts.length, 30);
          const layout = await evaluate(`(() => {
          const select = document.getElementById('dm-select').getBoundingClientRect();
          const add = document.getElementById('dm-add').getBoundingClientRect();
          const copy = document.getElementById('dm-copy').getBoundingClientRect();
          const clear = document.getElementById('dm-clear').getBoundingClientRect();
          const preview = document.getElementById('dm-preview');
          const text = document.getElementById('dm-preview-text');
          const style = getComputedStyle(preview);
          const sheet = document.getElementById('dm-sheet');
          return {sameRow:Math.abs(select.y-add.y)<2, actionRow:Math.abs(copy.y-clear.y)<2 && copy.width>clear.width,
            pageFits:document.documentElement.scrollWidth<=innerWidth,
            sheetFits:sheet.scrollWidth<=sheet.clientWidth, previewFits:preview.scrollWidth<=preview.clientWidth,
            singleLine:getComputedStyle(text).whiteSpace === 'nowrap',
            ellipsis:getComputedStyle(text).textOverflow === 'ellipsis',
            noScrollbars:style.overflow === 'hidden' && getComputedStyle(text).overflow === 'hidden',
            fontSize:getComputedStyle(text).fontSize};
        })()`);
          assert.deepEqual(layout, {sameRow:true,actionRow:true,pageFits:true,sheetFits:true,previewFits:true,singleLine:true,ellipsis:true,noScrollbars:true,fontSize:'20px'}, String(width) + '/' + option);
          await mockClipboard();
          await click('dm-copy');
          assert.equal(await evaluate('window.copiedText'), await preview());
          await click('dm-open');
        }
        await click('dm-clear');
        await evaluate('for (let i=0;i<3;i++) {document.getElementById("dm-select").selectedIndex=i; document.getElementById("dm-add").click()}');
        if (process.env.DANMAKU_SCREENSHOT_DIR) {
          await evaluate('document.getElementById("toast").classList.remove("show")');
          await mkdir(process.env.DANMAKU_SCREENSHOT_DIR, {recursive:true});
          const screenshot = await connection.call('Page.captureScreenshot', {format:'png'});
          await writeFile(path.join(process.env.DANMAKU_SCREENSHOT_DIR, 'danmaku-' + width + '.png'), Buffer.from(screenshot.data, 'base64'));
        }
        await close();
      }
    });

    await t.test('downward swipe on the header dismisses the sheet', async () => {
      await connection.call('Emulation.setDeviceMetricsOverride', {width:390,height:850,deviceScaleFactor:1,mobile:true});
      await connection.call('Emulation.setTouchEmulationEnabled', {enabled:true});
      await click('dm-open');
      const position = await evaluate('document.getElementById("dm-drag").getBoundingClientRect().toJSON()');
      const x = Math.round(position.x + 80);
      const y = Math.round(position.y + 20);
      await connection.call('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
      await connection.call('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x,y:y+80}]});
      await connection.call('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
      assert.equal(await evaluate('document.getElementById("dm-sheet").open'), false);
    });

    await t.test('confirmation page uses the same working editor', async () => {
      await load('/v2/index.html');
      await click('dm-open');
      await click('dm-clear');
      await evaluate('document.getElementById("dm-select").selectedIndex = 0');
      await click('dm-add');
      assert.equal(await preview(), '✨💙💜✨');
    });

    await t.test('slide animation closes cleanly and background scroll position is restored', async () => {
      await close();
      await connection.call('Emulation.setEmulatedMedia', {features:[]});
      await evaluate('document.querySelector(".results").style.minHeight="2000px"; window.scrollTo(0,300)');
      const initialY = await evaluate('window.scrollY');
      await click('dm-open');
      await sleep(250);
      assert.equal(await evaluate('document.getElementById("dm-sheet").getBoundingClientRect().bottom <= innerHeight + 1'), true);
      await click('dm-close');
      assert.equal(await evaluate('document.getElementById("dm-sheet").classList.contains("dm-closing")'), true);
      await sleep(230);
      assert.equal(await evaluate('document.getElementById("dm-sheet").open'), false);
      assert.equal(await evaluate('window.scrollY'), initialY);
      assert.equal(await evaluate('document.documentElement.style.overflow'), '');
    });
  } finally {
    connection?.socket.close();
    const exited = new Promise(resolve => browser.once('exit', resolve));
    browser.kill();
    await exited;
    await new Promise(resolve => server.close(resolve));
    assert.ok(profile.startsWith(path.join(os.tmpdir(), 'saikyo-danmaku-test-')));
    await rm(profile, {recursive:true,force:true,maxRetries:5});
  }
});
