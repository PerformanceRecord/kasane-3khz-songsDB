# kasane-3khz-songsDB

> **GitHub Pages（フロントエンド）**: https://performancerecord.github.io/kasane-3khz-songsDB/

Cloudflare R2 で配信する静的 JSON（`songs` / `gags` / `meta` と `history/<id>.json`）を一次データとして使う構成です。

- **通常フロー**: GAS `archive` API は使いません。
- **同期バッチ**: 通常は `songs/gags/meta/history` を生成・配信します。archive は手動再構築などのメンテ用途でのみ使います。

## 1. 総点検結果（不要箇所・統合可能箇所）

### 1-1. 結論
- 仕様を `docs/new-repo-seed-spec.md` に統合したため、旧仕様書は削除済みです。
- 日常運用の参照は `README`、新規環境立ち上げ時のタネデータは `docs/new-repo-seed-spec.md` を利用します。
- 通常フローは `songs/gags/meta + history/<id>.json` に統一し、旧 `archive` 直接取得は退役扱いです。

### 1-2. 統合・整理した方針
- 仕様の中心を `README` に寄せ、各資料は補助資料として役割を明確化。
- セクション順を「全体像 → 構成 → ファイル仕様 → 実行方法 → 運用」に並び替え、初学者でも追いやすい順序に変更。

## 2. リポジトリの役割（全体像）

- **データ同期**: `scripts/sync-gas.mjs` が GAS API からデータを取得して `public-data`（`*.json` と `history/*.json`）を更新。
- **静的配信**: `public-data` を Cloudflare R2 などで配信し、フロントは静的 JSON を利用。
- **フロント表示**: `index.html` はまず `songs` / `gags` の一覧を表示し、必要なときだけ `history/<id>.json` を読む。

## 3. ディレクトリ構成

- `index.html`
  - フロントエンド本体（単一 HTML）。
- `scripts/sync-gas.mjs`
  - GAS 取得・正規化・保存・`meta.json` 生成。
- `public-data/*.json`
  - 配信対象のスナップショット（`songs` / `gags` / `meta`）。
- `public-data/history/<id>.json`
  - 曲・ネタ単位の履歴データ。
- `google-apps-script-reference/`
  - GAS 参照コード（運用原本の複製を保持）。
- `docs/new-repo-seed-spec.md`
  - 新規リポジトリ立ち上げ時の統合仕様書（1枚版）。
- `assets/icons/`, `site.webmanifest`
  - PWA/アイコン関連。

## 4. 仕様書（コード別）

### 4-1. `index.html`（フロントエンド）
- 単一ページで `songs` / `gags` 一覧を検索・表示し、履歴は `history/<id>.json` で表示。
- 読込優先順位:
  1. `?static_base=<URL>`
  2. `localStorage.staticDataBase`
  3. 同一オリジン相対パス
- `songs` / `gags` は静的 JSON を利用し、選択時に `historyRef` から履歴 JSON を読む。
- `meta.tabs` と `meta.counts` を使い、静的データ整合性を検証。不整合時はフォールバック。

### 4-2. `scripts/sync-gas.mjs`（同期バッチ）
- `songs` / `gags` を取得して保存（通常フロー）。
- archive sheet は `ENABLE_ARCHIVE_SYNC=true` のときだけ参照（任意の補強データ）。
- 取得行を正規化し、`date8` / `rowId` / `historyCount` / `lastSungAt` / `historyRef` を補完。
- `history/<id>.json` を必ず生成し、一覧→履歴の参照経路を固定。
- 最後に `meta.json` を再生成し、件数と対象タブを記録。

### 4-3. `google-apps-script-reference/code.gs`（GAS API 参照実装）
- スプレッドシートを API 化し、`songs` / `gags` / `archive` を返却できる。
- 返却行は `artist/title/kind/dText/dUrl/date8/rowId`。
- `exact=1` と `offset/limit` ページングは **退役（通常フロー未使用）**。デバッグ用途のみ。

### 4-4. `google-apps-script-reference/merge-songs-gags-archive.gs`（GAS 補助）
- 旧 `archive` 統合の補助スクリプト（退役）。
- 通常フローでは使わず、Apps Script 側の検証・デバッグ時のみ参照。

### 4-5. `public-data`（配信データ仕様）
- `songs.json` / `gags.json`:
  - `ok`, `sheet`, `fetchedAt`, `rows`, `total`, `matched`
  - 各 `row` に `historyCount`, `lastSungAt`, `historyRef` を含む
- `history/<id>.json`:
  - `ok`, `version`, `rowId`, `generatedAt`, `total`, `lastSungAt`, `rows`
- `meta.json`:
  - `ok`, `source`, `generatedAt`, `startedAt`, `tabs`, `counts`

### 4-6. `site.webmanifest` / `assets/icons/*`
- PWA 表示名・テーマ色・アイコン定義。
- 端末ショートカット追加時の見た目に影響。

## 5. データフロー（`songs/gags/meta + history/<id>.json`）

通常フローでは GAS `archive` API を呼びません。同期バッチで archive が必要なときのみ `ENABLE_ARCHIVE_SYNC=true` を使います（通常運用では不要）。

1. 同期バッチが `songs` / `gags` を取得。
2. 一覧行に `historyCount` / `lastSungAt` / `historyRef` を付与。
3. `public-data/songs.json`, `public-data/gags.json`, `public-data/meta.json` を更新。
4. 各行の `historyRef` が指す `public-data/history/<id>.json` を生成。
5. 画面は「一覧 → `historyRef` で履歴」の順で読み込む。

### `historyRef` の意味と利用経路
- 意味: その行の履歴 JSON の場所（例: `history/song-123.json`）。
- 許容形式（Phase 2 方針）:
  - 相対パス: `history/song-123.json`
  - 絶対URL: `https://<bucket-domain>/history/song-123.json`
- 解決ルール:
  - 絶対URLはそのまま取得する。
  - 相対パスは `STATIC_DATA_BASE`（`?static_base` / `localStorage.staticDataBase` / 同一オリジン既定）を基準にURL解決する。
  - 運用では `static_base` を `.../public-data/` で終わるURLに統一する（パス不整合による404を防ぐ）。
- 利用経路:
  - 一覧表示: `songs.json` / `gags.json` を読む
  - ユーザーが1件選択
  - `historyRef` を取り出す
  - `history/<id>.json` を取得して履歴表示

### 旧方式（退役）
- `exact=1` 検索、`offset-limit` ページング、GAS `archive` API 直接呼び出しは **退役**。
- これらはデバッグ専用で、通常フローでは使いません。

## 6. 行データ仕様（共通）

- 元データ想定（A/B/C/D）
  - A: `artist`
  - B: `title`
  - C: `kind`
  - D: `dText`
- 補完項目
  - `dUrl`: 任意 URL
  - `date8`: `YYYYMMDD` 数値。`row.date8` 優先、なければ `dText` 先頭8桁から抽出。
  - `rowId`: 既存値優先。なければ `artist|title|kind|dUrl`（trim + lower）で生成。

## 7. 環境変数

### 7-1. 通常利用
- `GAS_URL`: GAS API URL（**必須**）
- `OUT_DIR`: 出力先（既定 `public-data`）

### 7-2. 同期制御
- `SYNC_TIMEOUT_MS`（既定 `8000`）
- `SYNC_MAX_RETRY`（既定 `3`）
- `ENABLE_ARCHIVE_SYNC`（既定 `false`）: `true` のときだけ archive sheet を取得
- `ARCHIVE_STRICT_SYNC`（既定 `false`）: archive 取得失敗を同期エラーとして扱う
- `ARCHIVE_LIMITS` / `ARCHIVE_PAGE_LIMIT` / `ARCHIVE_MAX_PAGES` / `ARCHIVE_TOTAL_CAP`: archive 同期時のみ有効

## 8. 実行方法

```bash
node scripts/sync-gas.mjs
```

成功時は `public-data/*.json` と `public-data/history/*.json` が更新され、`sync complete` ログが出ます。

## 9. 運用メモ

- 通常運用は `songs/gags/meta + history/<id>.json` を静的配信し、一覧→履歴で読む。
- `public-data` はキャッシュとして扱い、取得失敗時は前回成功分を残す。
- `sync-r2.yml` は `songs/gags/meta` と `public-data/history/*.json` をR2へ同期する。
- `archive.json` は通常のR2アップロード対象に含めない（必要時のみ手動運用）。
- 仕様変更時は `README` と `docs/new-repo-seed-spec.md` を合わせて更新する。
- 削除実行ゲート5項目のうち1項目でも未達がある場合は、削除フェーズ（Phase D）へ進まない。

## 10. 現行実装メモ（2026-04-16 時点）

### 10-1. 参照URLとアセット解決

- `index.html` の `manifest` は `./site.webmanifest`（相対参照）を使用。
- OGP画像・favicon・apple touch icon は `https://performancerecord.github.io/kasane-3khz-songsDB/...` の絶対URLで固定。
- `site.webmanifest` は `start_url: "./"` / `scope: "./"` / `icons.src: "./assets/..."` で project page 配下の相対解決に対応済み。

### 10-2. 将来の移行メモ（別リポジトリへ複製する場合のみ）

- 現在リポジトリ内では追加の書き換えは不要。
- 別オーナー配下へ複製する場合のみ、次を新URLに合わせて更新する:
  1. `README` の GitHub Pages URL
  2. `index.html` の OGP / icon / canonical の絶対URL
  3. Cloudflare R2 CORS の Allowed origins
  4. GitHub Secrets（`GAS_URL`, `R2_*`）の再登録
