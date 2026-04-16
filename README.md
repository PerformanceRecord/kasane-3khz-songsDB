# kasane-3khz-songsDB

> **GitHub Pages（フロントエンド）**: https://performancerecord.github.io/kasane-3khz-songsDB/

Cloudflare R2 で配信する静的 JSON（`songs` / `gags` / `meta` と `history/<id>.json`）を一次データとして使う構成です。

- 本番既定の参照先は R2 `public-data/` です。

- **本番ランタイム**: `songs/gags/meta/history` を R2 から読みます。
- **build/sync 時のみ**: GAS `archive` API を live 取得して複数履歴を生成します。

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
  3. 本番既定（R2 `public-data/`）
  4. local/dev のみ同一オリジン相対パス
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

本番ランタイムは GAS `archive` API を呼びません。`sync-r2` の build/sync 時のみ `ENABLE_ARCHIVE_SYNC=true` で archive を live 取得し、複数履歴を生成します。

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
  - 相対パスは `STATIC_DATA_BASE`（`?static_base` / `localStorage.staticDataBase` / 本番既定R2 / local-dev同一オリジン）を基準にURL解決する。
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
- `ENABLE_ARCHIVE_SYNC`（既定 `false`）: `true` のとき archive sheet を live 取得して履歴生成元にする
- `ARCHIVE_STRICT_SYNC`（既定 `false`）: archive live 取得失敗を同期エラーとして扱う（`sync-r2` では `true` を使用）
- `ARCHIVE_LIMITS` / `ARCHIVE_PAGE_LIMIT` / `ARCHIVE_MAX_PAGES` / `ARCHIVE_TOTAL_CAP`: archive 同期時のみ有効

## 8. 実行方法

```bash
node scripts/sync-gas.mjs
```

成功時は、ワークスペース上の `public-data/*.json` と `public-data/history/*.json` が生成・更新され、`sync complete` ログが出ます（`public-data/history/*.json` は GitHub tracked 前提ではありません）。

## 9. 運用メモ

- 通常運用は `songs/gags/meta + history/<id>.json` を静的配信し、一覧→履歴で読む。
- `public-data` はキャッシュとして扱い、取得失敗時は前回成功分を残す。
- `sync-r2.yml` は build 後ワークスペースに生成された `songs/gags/meta` と `public-data/history/*.json` をR2へ同期する。
- `public-data/history/` はローカル生成・R2配信用で、GitHub では追跡しない（`.gitignore` 管理）。
- `public-data/archive.json` は公開配信対象にしない。build入力専用で、GitHubの履歴保存先として運用しない。
- `sync-r2` は archive live 取得に失敗したら fail する（silent fallback しない）。
- 仕様変更時は `README` と `docs/new-repo-seed-spec.md` を合わせて更新する。
- 削除実行ゲート5項目のうち1項目でも未達がある場合は、削除フェーズ（Phase D）へ進まない。

### 9-1. 本番導線の確認手順（R2優先運用）
- 確認URL: `https://performancerecord.github.io/kasane-3khz-songsDB/?static_base=https://pub-34d8fa96953d472aa7cb424b9daf2d60.r2.dev/public-data/`
- 手順: ① 一覧が表示される ② 任意の1件を選択する ③ 履歴が表示されることを確認する。
- 成功条件: 一覧表示と履歴表示でエラー文言が出ないこと。
- 注意: 本番URLでの「一覧→1件選択→履歴表示」は未実測の間は、`PROGRESS.md` の削除実行ゲートを完了扱いにしない。

### 9-2. 最小監視（404/5xx）
- 日次で次のURLを直叩きし、HTTPステータスを記録する: `songs.json`, `gags.json`, `meta.json`, `history/428fa06c1437.json`。
- 週1回、GitHub Actions `sync-r2.yml` の最新実行結果を確認し、失敗時は同日中に再実行または原因切り分けを行う。
- 404/5xx が1件でもあれば障害扱いとして、9-3 の復旧手順に進む。

### 9-3. 復旧担当と最短復旧手順
- 復旧判断者（一次責任）: リポジトリ管理者（`main` へ直接反映できる担当者）。
- 障害時の確認順: ① R2直叩きHTTPコード ② GitHub Pages本番表示 ③ `sync-r2.yml` の最新ログ。
- R2障害時の一時退避: 本番URLで `?static_base=./public-data/` を付けて same-origin を一時利用する（必要なら `localStorage.staticDataBase` も同値に設定）。
- GitHub側へ一時復元する最短手順: 直近バックアップの `public-data/songs.json` / `gags.json` / `meta.json` を `main` に戻して公開し、障害解消後にR2優先運用へ戻す。

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
