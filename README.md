# kasane-3khz-songs-db

> **GitHub Pages（フロントエンド）**: https://<YOUR_GITHUB_USERNAME>.github.io/kasane-3khz-songs-dbTEST/
>
> 上記はこのリポジトリ名に合わせた Pages の想定 URL です。実際のユーザー名に置き換えて利用してください。

Cloudflare R2 で配信する静的 JSON（`songs` / `gags` / `meta`）を一次データとして使い、`archive` は必要時のみ GAS から動的取得する構成です。

## 1. 総点検結果（不要箇所・統合可能箇所）

### 1-1. 結論
- 現時点で**削除必須の不要ファイル**は確認されませんでした。
- ただし、仕様説明が `README` と `docs/repository-specification.md` に分散していたため、本 README を仕様書として再整理しました。
- `archive` 同期の制御仕様は実装済みで妥当（ページング・limit縮小・health check）です。

### 1-2. 統合・整理した方針
- 仕様の中心を `README` に寄せ、各資料は補助資料として役割を明確化。
- セクション順を「全体像 → 構成 → ファイル仕様 → 実行方法 → 運用」に並び替え、初学者でも追いやすい順序に変更。

## 2. リポジトリの役割（全体像）

- **データ同期**: `scripts/sync-gas.mjs` が GAS API からデータを取得して `public-data/*.json` を更新。
- **静的配信**: `public-data` を Cloudflare R2 などで配信し、フロントは静的 JSON を優先利用。
- **フロント表示**: `index.html` が `songs` / `gags` を高速検索表示し、`archive` は必要時のみ取得。

## 3. ディレクトリ構成

- `index.html`
  - フロントエンド本体（単一 HTML）。
- `scripts/sync-gas.mjs`
  - GAS 取得・正規化・保存・`meta.json` 生成。
- `public-data/*.json`
  - 配信対象のスナップショット。
- `google-apps-script-reference/`
  - GAS 参照コード（運用原本の複製を保持）。
- `docs/*.md`
  - 運用資料（R2 設定や評価メモなど）。
- `assets/icons/`, `site.webmanifest`
  - PWA/アイコン関連。

## 4. 仕様書（コード別）

### 4-1. `index.html`（フロントエンド）
- 単一ページで `songs` / `gags` / `archive` を検索・表示。
- 読込優先順位:
  1. `?static_base=<URL>`
  2. `localStorage.staticDataBase`
  3. 同一オリジン相対パス
- `songs` / `gags` は静的 JSON を優先。`archive` は JSONP による動的取得を許容。
- `meta.tabs` と `meta.counts` を使い、静的データ整合性を検証。不整合時はフォールバック。

### 4-2. `scripts/sync-gas.mjs`（同期バッチ）
- `songs` / `gags` は毎回取得して保存。
- 取得行を正規化し、`date8` と `rowId` を補完。
- `ENABLE_ARCHIVE_SYNC=true` の場合のみ `archive` を同期。
  - `limit=1` で health check。
  - ページング取得 + `Argument too large` 時の limit 縮小再試行。
  - `offset` は実取得件数で進める。
- 最後に `meta.json` を再生成し、件数と対象タブを記録。

### 4-3. `google-apps-script-reference/code.gs`（GAS API 参照実装）
- スプレッドシートを API 化し、`songs` / `gags` / `archive` を返却。
- 返却行は `artist/title/kind/dText/dUrl/date8/rowId`。
- `exact=1` 時は `artist/title` 完全一致の検索動作。

### 4-4. `google-apps-script-reference/merge-songs-gags-archive.gs`（GAS 補助）
- `songs/gags/archive` の統合処理を担う補助スクリプト。
- 投稿日・タイムスタンプ等の付与ロジックを保持。
- 本番反映時は Apps Script 側との差分管理に注意。

### 4-5. `public-data/*.json`（配信データ仕様）
- `songs.json` / `gags.json` / `archive.json`:
  - `ok`, `sheet`, `fetchedAt`, `rows`, `total`, `matched`
- `meta.json`:
  - `ok`, `source`, `generatedAt`, `startedAt`, `tabs`, `counts`

### 4-6. `site.webmanifest` / `assets/icons/*`
- PWA 表示名・テーマ色・アイコン定義。
- 端末ショートカット追加時の見た目に影響。

## 5. 同期フロー（`scripts/sync-gas.mjs`）

1. `songs` / `gags` を取得。
2. 行を正規化し `date8` / `rowId` を補完。
3. `public-data/songs.json`, `public-data/gags.json` を更新。
4. `ENABLE_ARCHIVE_SYNC=true` 時のみ `archive` を段階取得。
5. `meta.json` を生成。

### archive 取得制御（重要）
- `ARCHIVE_PAGE_LIMIT` を基準値として利用。
- `ARCHIVE_LIMITS` の候補は `ARCHIVE_PAGE_LIMIT` 以下のみ採用。
- `Argument too large` 発生時に limit を下げて再試行。
- 上限制御:
  - `ARCHIVE_MAX_PAGES`
  - `ARCHIVE_TOTAL_CAP`

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
- `ENABLE_ARCHIVE_SYNC`（`true` で archive 同期有効）
- `ARCHIVE_STRICT_SYNC`（`true` なら archive 失敗で全体失敗）
- `ARCHIVE_PAGE_LIMIT`（既定 `5`）
- `ARCHIVE_LIMITS`（既定 `20,10,5,3,1`）
- `ARCHIVE_MAX_PAGES`（既定 `4000`）
- `ARCHIVE_TOTAL_CAP`（既定 `20000`）

## 8. 実行方法

```bash
node scripts/sync-gas.mjs
```

成功時は `public-data/*.json` が更新され、`sync complete` ログが出ます。

## 9. 運用メモ

- `archive` は負荷が高くなりやすいため、通常は静的配信対象から分離して扱う。
- `public-data` はキャッシュとして扱い、取得失敗時は前回成功分を残す。
- 仕様変更時は `README` と `docs/repository-specification.md` を合わせて更新する。

## 10. 本番URL固定時の移行メモ（`https://performancerecord.github.io/kasane-3kHz-songsDB/`）

本番URLが GitHub Pages の**プロジェクトページ**（`/<repo>/`）で確定しているため、以下を移行チェックリストとして利用してください。

### 10-1. 現在の検証機で有効なもの（そのまま有効）

- `scripts/sync-gas.mjs` の同期仕様（`songs/gags` 静的化、`archive` 条件同期）はそのまま流用可能。
- GAS / Cloudflare R2 の基本設計（`GAS_URL`, `R2_*` シークレット利用）はそのまま流用可能。
- `static_base` クエリまたは `localStorage.staticDataBase` による静的JSON参照先の切り替え仕様はそのまま流用可能。

### 10-2. 本番移行後に書き換えが必要な箇所

| 対象 | 現在有効な設定 | 本番移行後に書き換える内容 |
|---|---|---|
| `README` の Pages URL 表記 | `https://<YOUR_GITHUB_USERNAME>.github.io/kasane-3khz-songs-dbTEST/` | `https://performancerecord.github.io/kasane-3kHz-songsDB/` に更新 |
| `index.html` のアイコン/manifest 参照 | `/assets/...`, `/site.webmanifest`（ルート絶対） | `./assets/...`, `./site.webmanifest` など、`/<repo>/` 配下で解決できる参照へ変更 |
| `site.webmanifest` の `start_url` / `icons.src` | `start_url: "/"`, `src: "/assets/icons/..."` | `start_url: "/kasane-3kHz-songsDB/"` または相対指定へ変更。icon 参照も `/<repo>/` 対応に変更 |
| GitHub Actions Secrets | 現リポジトリ側に設定済み | 新リポジトリ側にも `GAS_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET` を再登録 |
| Cloudflare R2 CORS | 現在のHTMLドメインを許可 | `https://performancerecord.github.io` を Allowed origins に追加（または差し替え） |

### 10-3. 移行の推奨順序（最短）

1. 新リポジトリ `kasane-3kHz-songsDB` を用意。
2. Pages を有効化して `https://performancerecord.github.io/kasane-3kHz-songsDB/` を確認。
3. 上記「書き換えが必要な箇所」を反映。
4. 新リポジトリに Secrets を再登録。
5. `sync-gas.yml` / `sync-r2.yml` を手動実行して動作確認。
6. 問題なければ旧検証機の Actions を停止（検証機は廃止可）。
