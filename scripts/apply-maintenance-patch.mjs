import fs from 'node:fs';

const apiPath = 'google-apps-script-reference/code.gs';
const dedupePath = 'google-apps-script-reference/merge-songs-gags-archive.gs';

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`${label}: target not found`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: target is not unique`);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

function patchApi() {
  let text = fs.readFileSync(apiPath, 'utf8');
  if (text.includes('archive: 2,')) return false;
  text = replaceOnce(text, '    archive: 4,', '    archive: 2,', 'archive start row');
  fs.writeFileSync(apiPath, text);
  return true;
}

function patchDedupe() {
  let text = fs.readFileSync(dedupePath, 'utf8');
  let changed = false;

  if (!text.includes("const BACKUP_PREFIX = '_backup_';")) {
    text = replaceOnce(
      text,
      'const SOURCE_URL_COL = 4;\n',
      "const SOURCE_URL_COL = 4;\nconst BACKUP_PREFIX = '_backup_';\nconst BACKUP_KEEP_GENERATIONS = 5;\n",
      'backup constants'
    );
    changed = true;
  }

  if (!text.includes('createDedupeBackups_(ss, main, archive);')) {
    text = replaceOnce(
      text,
      '    placement.mainEntries.sort(compareSheetOrder_);\n    placement.archiveEntries.sort(compareSheetOrder_);\n\n    rewriteSongSheet_(main, START_ROW, placement.mainEntries, true);',
      '    placement.mainEntries.sort(compareSheetOrder_);\n    placement.archiveEntries.sort(compareSheetOrder_);\n\n    createDedupeBackups_(ss, main, archive);\n\n    rewriteSongSheet_(main, START_ROW, placement.mainEntries, true);',
      'backup call'
    );
    changed = true;
  }

  if (!text.includes('function createDedupeBackups_(')) {
    const marker = 'function rewriteSongSheet_(sheet, startRow, entries, includeMainExtras) {';
    const helper = `function createDedupeBackups_(ss, mainSheet, archiveSheet) {
  const timezone = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Tokyo';
  const timestamp = Utilities.formatDate(new Date(), timezone, 'yyyyMMdd_HHmmss');

  const targets = [mainSheet, archiveSheet];
  for (const source of targets) {
    const backupName = makeUniqueBackupSheetName_(ss, source.getName(), timestamp);
    source.copyTo(ss).setName(backupName).hideSheet();
    pruneOldBackupSheets_(ss, source.getName());
  }
}

function makeUniqueBackupSheetName_(ss, sourceName, timestamp) {
  const base = \`\${BACKUP_PREFIX}\${sourceName}_\${timestamp}\`.slice(0, 95);
  if (!ss.getSheetByName(base)) return base;

  for (let suffix = 2; suffix <= 99; suffix++) {
    const candidate = \`\${base.slice(0, 97 - String(suffix).length)}_\${suffix}\`;
    if (!ss.getSheetByName(candidate)) return candidate;
  }
  throw new Error(\`バックアップシート名を確保できませんでした: \${sourceName}\`);
}

function pruneOldBackupSheets_(ss, sourceName) {
  const prefix = \`\${BACKUP_PREFIX}\${sourceName}_\`;
  const backups = ss.getSheets()
    .filter(sheet => sheet.getName().startsWith(prefix))
    .sort((a, b) => b.getName().localeCompare(a.getName()));

  for (const sheet of backups.slice(BACKUP_KEEP_GENERATIONS)) {
    ss.deleteSheet(sheet);
  }
}

`;
    text = replaceOnce(text, marker, helper + marker, 'backup helpers');
    changed = true;
  }

  if (changed) fs.writeFileSync(dedupePath, text);
  return changed;
}

const changed = [patchApi(), patchDedupe()].some(Boolean);
console.log(changed ? 'maintenance patch applied' : 'maintenance patch already applied');
