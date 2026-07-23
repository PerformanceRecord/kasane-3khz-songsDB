import fs from 'node:fs';

const path = 'scripts/apply-phase1-lightweight-patch.mjs';
let text = fs.readFileSync(path, 'utf8');
const before = '_search: \\`${artistKey}\\\\n${titleKey}\\`,';
const after = '_search: \\`\\${artistKey}\\\\n\\${titleKey}\\`,';

if (text.includes(after)) {
  console.log('phase 1 patcher already repaired');
} else if (text.includes(before)) {
  text = text.replace(before, after);
  fs.writeFileSync(path, text);
  console.log('phase 1 patcher repaired');
} else {
  throw new Error('phase 1 patcher repair target not found');
}
