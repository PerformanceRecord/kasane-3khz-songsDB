# kasane-3khz-songsDB

> **GitHub Pages（フロントエンド）**: https://<YOUR_GITHUB_USERNAME>.github.io/kasane-3khz-songsDB/
>
> 上記はこのリポジトリ名に合わせた Pages の想定 URL です。実際のユーザー名に置き換えて利用してください。

Cloudflare R2 で配信する静的 JSON（`songs` / `gags` / `meta` と `history/<id>.json`）を一次データとして使う構成です。

- **通常フロー**: GAS `archive` API は使いません。
- **同期バッチ**: 必要なときだけ `ENABLE_ARCHIVE_SYNC=true` で archive sheet を参照します（既定は無効）。

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
- archive sheet は `ENABLE_ARCHIVE_SYNC=true` のときだけ参照（必要時のみ）。
- 取得行を正規化し、`date8` / `rowId` / `historyCount` / `lastSungAt` / `historyRef` を補完。
- `history/<id>.json` を生成し、一覧→履歴の参照経路を固定。
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
  - `ok`, `id`, `sheet`, `fetchedAt`, `rows`, `total`
- `meta.json`:
  - `ok`, `source`, `generatedAt`, `startedAt`, `tabs`, `counts`

### 4-6. `site.webmanifest` / `assets/icons/*`
- PWA 表示名・テーマ色・アイコン定義。
- 端末ショートカット追加時の見た目に影響。

## 5. データフロー（`songs/gags/meta + history/<id>.json`）

通常フローでは GAS `archive` API を呼びません。同期バッチで archive が必要なときのみ `ENABLE_ARCHIVE_SYNC=true` を使います。

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
- `GAS_URL`: GAS API URL（未設定時はスクリプト既定値）
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
- `sync-r2.yml` では `songs/gags/meta/archive` に加えて `public-data/history/*.json` もR2へ同期する（Phase 1: 並行保存）。
- 仕様変更時は `README` と `docs/new-repo-seed-spec.md` を合わせて更新する。

## 10. 本番URL固定時の移行メモ（`https://performancerecord.github.io/kasane-3khz-songsDB/`）

本番URLが GitHub Pages の**プロジェクトページ**（`/<repo>/`）で確定しているため、以下を移行チェックリストとして利用してください。

### 10-1. 現在の検証機で有効なもの（そのまま有効）

- `scripts/sync-gas.mjs` の同期仕様（`songs/gags/meta + history/<id>.json`）はそのまま流用可能。
- GAS / Cloudflare R2 の基本設計（`GAS_URL`, `R2_*` シークレット利用）はそのまま流用可能。
- `static_base` クエリまたは `localStorage.staticDataBase` による静的JSON参照先の切り替え仕様はそのまま流用可能。

### 10-2. 本番移行後に書き換えが必要な箇所

| 対象 | 現在有効な設定 | 本番移行後に書き換える内容 |
|---|---|---|
| `README` の Pages URL 表記 | `https://<YOUR_GITHUB_USERNAME>.github.io/kasane-3khz-songsDB/` | `https://performancerecord.github.io/kasane-3khz-songsDB/` に更新 |
| `index.html` のアイコン/manifest 参照 | `/assets/...`, `/site.webmanifest`（ルート絶対） | `./assets/...`, `./site.webmanifest` など、`/<repo>/` 配下で解決できる参照へ変更 |
| `site.webmanifest` の `start_url` / `icons.src` | `start_url: "/"`, `src: "/assets/icons/..."` | `start_url: "/kasane-3khz-songsDB/"` または相対指定へ変更。icon 参照も `/<repo>/` 対応に変更 |
| GitHub Actions Secrets | 現リポジトリ側に設定済み | 新リポジトリ側にも `GAS_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET` を再登録 |
| Cloudflare R2 CORS | 現在のHTMLドメインを許可 | `https://performancerecord.github.io` を Allowed origins に追加（または差し替え） |

### 10-3. 移行の推奨順序（最短）

1. 新リポジトリ `kasane-3khz-songsDB` を用意。
2. Pages を有効化して `https://performancerecord.github.io/kasane-3khz-songsDB/` を確認。
3. 上記「書き換えが必要な箇所」を反映。
4. 新リポジトリに Secrets を再登録。
5. `sync-gas.yml` / `sync-r2.yml` を手動実行して動作確認。
6. 問題なければ旧検証機の Actions を停止（検証機は廃止可）。
