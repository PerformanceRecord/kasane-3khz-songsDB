# 新規リポジトリ用 タネデータ統合仕様書（1枚版）

このドキュメントは、既存の再現仕様・GAS付録・R2セットアップ手順を**新規リポジトリ作成時の初期タネデータ**として使えるように、1ファイルに統合したものです。

---

## 1. 目的

以下を最短で再構築できることを目的とします。

1. スプレッドシートで `songs / gags / archive` を管理
2. GAS Web API で JSON / JSONP 取得
3. GitHub Actions で `public-data/*.json` を定期生成
4. Cloudflare R2 へ同期し静的配信
5. フロント（`index.html`）で静的優先 + 必要時動的取得

---

## 2. 論理アーキテクチャ

```text
[Google Spreadsheet]
   ↓
[Google Apps Script Web App (/exec)]
   ↓
[GitHub Actions]
   ├─ sync-gas: public-data/*.json 生成
   └─ sync-r2 : R2へアップロード
                 ↓
          [Cloudflare R2 Public URL]
                 ↓
             [index.html]
```

運用方針:
- 真実データは Spreadsheet。
- 閲覧系（songs/gags/meta）は静的JSON優先。
- archive は「静的 + 必要時動的取得」のハイブリッド。

---

## 3. 新規リポジトリの最小構成

```text
.
├─ index.html
├─ scripts/
│  └─ sync-gas.mjs
├─ public-data/
│  ├─ songs.json
│  ├─ gags.json
│  ├─ archive.json
│  └─ meta.json
├─ .github/workflows/
│  ├─ sync-gas.yml
│  └─ sync-r2.yml
├─ google-apps-script-reference/
│  ├─ code.gs
│  └─ merge-songs-gags-archive.gs
└─ docs/
   └─ new-repo-seed-spec.md
```

---

## 4. データ仕様（タネデータ共通）

### 4.1 行スキーマ（正規化後）

```json
{
  "artist": "アーティスト名",
  "title": "曲名",
  "kind": "区分",
  "dText": "配信情報テキスト",
  "dUrl": "URL",
  "date8": 20260213,
  "rowId": "artist|title|kind|dUrl"
}
```

### 4.2 出力ファイル形式

- `songs.json` / `gags.json` / `archive.json`
  - `{ ok, sheet, fetchedAt, rows, total, matched }`
- `meta.json`
  - `{ ok, source, generatedAt, startedAt, tabs, counts }`

---

## 5. Spreadsheet / GAS 仕様

### 5.1 Spreadsheet 前提

- シート: `songs`, `gags`, `archive`
- 主要列（A〜D）:
  - A: artist
  - B: title
  - C: kind
  - D: dText（配信日文字列・URL情報含む）

### 5.2 GAS API 前提

- 例:
  - `GET /exec?sheet=songs`
  - `GET /exec?sheet=gags`
  - `GET /exec?sheet=archive&artist=...&title=...&exact=1&limit=...&offset=...`
- `callback` 指定時は JSONP
- `exact=1` で完全一致
- `archive` はページング取得想定

### 5.3 GAS 実装時に置換する値

- `SHEET_ID`
- Webアプリの `deploy URL` / `deploy ID`
- CORS の許可オリジン

---

## 6. GitHub Actions 仕様

### 6.1 `sync-gas.yml`

- Node.js 20
- `node scripts/sync-gas.mjs`
- `public-data/*.json` 差分をコミット
- 推奨実行頻度（例）: 1日2回（JST 01:00 / 13:00）

### 6.2 `sync-r2.yml`

- 同期後に `aws s3 cp` でR2へアップロード
- 対象: `songs.json`, `gags.json`, `meta.json`, `archive.json`
- 失敗時はリトライ（最大3回を推奨）
- `SYNC_TIMEOUT_MS=15000`, `SYNC_MAX_RETRY=5` を推奨（ネットワーク揺らぎ対策）

---

## 7. Secrets / 環境変数

GitHub Secrets に次を登録:

- `GAS_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ENDPOINT`（例: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`）
- `R2_BUCKET`

---

## 8. Cloudflare R2 設定

### 8.1 必須

1. バケット作成
2. API Token（Object Read & Write）発行
3. Endpoint 確認
4. 必要なら Public URL 有効化

### 8.2 CORS（HTML配信ドメインとR2が別ドメインの場合）

- Allowed origins: `https://<your-frontend-domain>`
- Allowed methods: `GET`, `HEAD`
- Allowed headers: `*`（または必要最小限）

---

## 9. フロント動作仕様（index.html）

- `songs / gags / meta` は静的JSONを先に取得
- `meta.tabs` / `meta.counts` の整合性を確認し、不整合なら採用しない
- `archive` は必要時のみ動的取得（exact + paging + backoff）
- 静的データ参照先の優先順位:
  1. `?static_base=https://<R2公開URL>/public-data/`
  2. `localStorage.staticDataBase`
  3. 同一オリジン相対パス
- 参照先切替:
  - クエリ: `?static_base=https://<R2公開URL>/public-data/`
  - または `localStorage.staticDataBase`

---

## 10. archive 同期ポリシー（原則）

- 原則、`archive` は静的同期しない（`ENABLE_ARCHIVE_SYNC=false` を標準とする）。
- 画面上の履歴検索は GAS へ直接問い合わせて取得する。
- 理由:
  1. `archive` は件数増加で同期負荷・失敗率が高くなりやすい
  2. `songs/gags` の高速表示と運用安定を優先する
- 例外（任意）:
  - バッチ時間・GAS負荷・R2転送量を許容できる場合のみ `ENABLE_ARCHIVE_SYNC=true` を検討
  - 例外時も `limit` 縮小再試行・上限打ち切り（`ARCHIVE_MAX_PAGES`, `ARCHIVE_TOTAL_CAP`）を必須化

---

## 11. 初回セットアップ手順（新規リポジトリ）

1. Spreadsheet に `songs/gags/archive` を用意
2. GAS 実装を貼り付け・デプロイして `/exec` URL を取得
3. GitHub Secrets 設定
4. `sync-gas.yml` を手動実行して `public-data/*.json` 生成確認
5. `sync-r2.yml` を手動実行してR2更新確認
6. `index.html?static_base=...` で表示確認

---

## 12. 安定運用の推奨（任意）

GAS無改修でも、利用側（例: Streamlit）で以下を追加すると安定化しやすいです。

1. サーバー側取得 + timeout/retry（指数バックオフ）
2. TTLキャッシュ + stale-while-revalidate
3. スキーマ正規化の一元化（欠損耐性）
4. 「最終成功時刻」「キャッシュ表示中」UI

---

## 13. GASスクリプト最低要件（この条件を満たせば再作成可能）

### 13.1 エンドポイントと受け付けパラメータ

- `GET /exec?sheet=songs|gags|archive`
- 検索系（主に archive）:
  - `artist`, `title`, `exact=1`
  - `limit`, `offset`（ページング）
- `callback` 指定時は JSONP で返す

### 13.2 返却フォーマット（最低限）

- 共通:
  - `ok: boolean`
  - `sheet: string`
  - `rows: array`
  - `total: number`
  - `matched: number`
- エラー時:
  - `ok: false`
  - `error: string`

### 13.3 行スキーマ正規化（最低限）

- 返却行は以下のキーを揃える:
  - `artist`, `title`, `kind`, `dText`, `dUrl`, `date8`, `rowId`
- 補完規則:
  - `date8`: `row.date8` を優先し、なければ `dText` 先頭8桁（`YYYYMMDD`）から抽出
  - `rowId`: 既存値優先。なければ `artist|title|kind|dUrl` で生成

### 13.4 検索・ページング要件（最低限）

- `exact=1` では `artist/title` 完全一致を優先
- `limit/offset` で分割取得できること
- `archive` で0件応答時は空配列を返し、HTTP 200 + `ok=true` を基本とする
- 大量応答で失敗しないよう、実装側で応答サイズを抑える（`limit` 活用）

### 13.5 セキュリティ/運用要件（最低限）

- CORS 許可オリジンは本番フロントURLのみを許可
- デプロイ後は `/exec` URL を固定し、Secrets (`GAS_URL`) へ登録
- 変更時はテスト:
  1. `songs/gags` 取得
  2. `archive` exact検索
  3. `limit/offset` ページング
  4. JSONP 応答

---

## 14. 受け入れ確認チェック（最小）

1. `songs.json` / `gags.json` / `meta.json` が生成される
2. `meta.tabs` に `songs,gags` が入り、`counts` 件数と一致する
3. フロントで `songs/gags` が静的データから表示される
4. `archive` 検索時のみ GAS へ通信し、結果が表示される
5. `?static_base=...` 指定時に参照先が切り替わる

---

## 15. 公式参照リンク

- Apps Script デプロイ: https://developers.google.com/apps-script/concepts/deployments
- Apps Script Web Apps: https://developers.google.com/apps-script/guides/web
- Cloudflare R2 S3 API: https://developers.cloudflare.com/r2/get-started/s3/
- Cloudflare R2 API Tokens: https://developers.cloudflare.com/r2/api/s3/tokens
- Cloudflare R2 CORS: https://developers.cloudflare.com/r2/buckets/cors/
