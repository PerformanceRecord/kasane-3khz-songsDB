import fs from 'node:fs';

const path = 'scripts/apply-phase1-lightweight-patch.mjs';
let text = fs.readFileSync(path, 'utf8');
let changed = false;

const searchKeyBefore = '_search: \\`${artistKey}\\\\n${titleKey}\\`,';
const searchKeyAfter = '_search: \\`\\${artistKey}\\\\n\\${titleKey}\\`,';
if (text.includes(searchKeyBefore)) {
  text = text.replace(searchKeyBefore, searchKeyAfter);
  changed = true;
}

const backGuardBefore = 'if (!text.includes("abortCurrentHistoryRequest();\\n      updateHistoryRouteParams")) {';
const backGuardAfter = 'if (!text.includes("state.historyRenderSeq += 1;")) {';
if (text.includes(backGuardBefore)) {
  text = text.replace(backGuardBefore, backGuardAfter);
  changed = true;
}

if (changed) {
  fs.writeFileSync(path, text);
  console.log('phase 1 patcher repaired');
} else if (text.includes(searchKeyAfter) && text.includes(backGuardAfter)) {
  console.log('phase 1 patcher already repaired');
} else {
  throw new Error('phase 1 patcher repair targets not found');
}
