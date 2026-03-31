# kasane-3khz-songsDB 再現仕様書（CODEX投入向け）

> 目的: この文書を CODEX に渡すだけで、同等の構成（Spreadsheet/GAS/Actions/R2/HTML 連携）を再構築できるレベルまで具体化する。

---

## 1. このシステムで実現していること

このリポジトリは、次の5段階を自動化・分離した構成です。

1. スプレッドシートに楽曲データを記帳する。
2. GAS Web API が `songs / gags / archive` を JSON または JSONP で返す。
3. GitHub Actions が定期的に GAS から取得し、`public-data/*.json` を生成する。
4. 生成ファイルを Cloudflare R2 にアップロードして静的配信する。
5. フロントエンド（`index.html`）が R2 の JSON を優先読込し、必要時のみ GAS を動的参照する。

この設計により「閲覧系は静的配信で安定」「履歴系は必要時だけ動的取得」を両立します。

---

## 2. 再現対象の構成（論理アーキテクチャ）

```text
[Google Spreadsheet]
   ↓ (Apps Script が読む)
[Google Apps Script Web App]
   ↓ (HTTP GET)
[GitHub Actions: sync-gas / sync-r2]
   ├─ public-data/*.json をリポジトリ更新
   └─ Cloudflare R2 へアップロード
                    ↓
          [R2 Public URL / Custom Domain]
                    ↓
             [index.html (Frontend)]
```

- 楽曲元データは Spreadsheet が真実。
- フロントの主データソースは R2 上の静的 JSON。
- `archive` は容量・負荷都合で「静的 + 必要時動的」のハイブリッド運用。

---

## 3. ディレクトリ構成（役割付き）

- `index.html`
  - 単一ファイルのフロントエンド本体（検索/UI/通信/キャッシュ制御）。
- `scripts/sync-gas.mjs`
  - GAS API 取得、データ正規化、`public-data/*.json` 出力、`meta.json` 生成。
- `public-data/`
  - `songs.json`, `gags.json`, `archive.json`, `meta.json` の静的スナップショット。
- `.github/workflows/sync-gas.yml`
  - 15分ごとに GAS 取得→JSON生成→差分コミット。
- `.github/workflows/sync-r2.yml`
  - 30分ごとに GAS 同期→R2 アップロード。
- `google-apps-script-reference/`
  - CODEXから直接操作できない GAS 実体の参照保存。
- `sheet_scripts/`
  - スプレッドシート内の保全・整備用スクリプト（運用補助）。
- `docs/repro-appendix-gas-scripts.md`
  - 貼り付け用完全スクリプト集（本書と対で利用）。

---

## 4. コンポーネント別の作り

### 4.1 Spreadsheet（データ記帳レイヤー）

- シートは少なくとも `songs / gags / archive` の3系統を想定。
- 主要列は A〜D:
  - A: artist
  - B: title
  - C: kind
  - D: dText（配信日文字列 + URL情報を含む場合あり）
- GAS 側で URL 抽出（RichText / HYPERLINK式 / 正規表現）と `date8`, `rowId` 補完を行う。

### 4.2 GAS Web API（取得レイヤー）

- エンドポイント例:
  - `GET /exec?sheet=songs`
  - `GET /exec?sheet=gags`
  - `GET /exec?sheet=archive&artist=...&title=...&exact=1&limit=...&offset=...`
- `callback` 指定時は JSONP。
- `exact=1` で `artist/title` 完全一致検索。
- `archive` は chunk 読み + ページング + 重複排除前提で利用。

### 4.3 GitHub Actions（同期・配信レイヤー）

- `sync-gas.yml`
  - Node.js 20 で `node scripts/sync-gas.mjs` 実行。
  - `public-data/*.json` 更新差分を commit/push。
- `sync-r2.yml`
  - 同期後に `aws s3 cp` で R2 へ個別アップロード。
  - 対象: `songs.json`, `gags.json`, `meta.json`, `archive.json`。
  - 失敗時はリトライ。

### 4.4 Cloudflare R2（静的配信レイヤー）

- バケットに `public-data/*.json` を配置。
- フロントが参照できる公開 URL（`r2.dev` or カスタムドメイン）を用意。
- ブラウザから別ドメイン参照する場合は CORS 設定が必須。

### 4.5 Frontend（表示レイヤー）

- `index.html` は `songs / gags / meta` を静的 JSON から先に取得。
- `meta.tabs` / `meta.counts` で整合性チェックし、不整合は不採用。
- `archive` は必要時のみ API 動的取得（exact + paging + backoff）。
- `static_base`（クエリ）または `localStorage.staticDataBase` で参照先 R2 を切替可能。

---

## 5. データ仕様（最小必須）

### 5.1 行スキーマ（標準化後）

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

### 5.2 ファイル形式

- `songs.json` / `gags.json` / `archive.json`
  - `{ ok, sheet, fetchedAt, rows, total, matched }`
- `meta.json`
  - `{ ok, source, generatedAt, startedAt, tabs, counts }`

---

## 6. 再現手順（初回セットアップ）

### Step 1. Spreadsheet/GAS を準備

1. Spreadsheet に必要シート（songs/gags/archive）を作成。
2. GAS プロジェクトを作成し、`docs/repro-appendix-gas-scripts.md` の `code.gs` を貼り付け。
3. 必要に応じて統合・保全系スクリプトも貼り付け。
4. Webアプリとしてデプロイし、`/exec` URL を取得。

### Step 2. GitHub Secrets を設定

以下をリポジトリ Secrets に登録。

- `GAS_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ENDPOINT`
- `R2_BUCKET`

### Step 3. R2 公開経路と CORS 設定

- バケット Public URL またはカスタムドメインを用意。
- CORS にフロント配信ドメインを許可（GET/HEAD）。

### Step 4. Actions 動作確認

- `sync-gas.yml` を手動実行し `public-data/*.json` 更新を確認。
- `sync-r2.yml` を手動実行し R2 オブジェクト更新を確認。

### Step 5. フロント確認

`index.html` を次のように開く。

```text
https://<your-pages-or-host>/index.html?static_base=https://<your-r2-public>/public-data/
```

- songs/gags の表示確認。
- 履歴ボタンで archive 取得確認。
- Console に CORS エラーがないことを確認。

---

## 7. 「個人で再設定が必要」な値と取得場所（URL付き）

> ここが再現時のつまずきポイントです。値ごとに「どこで見つけるか」を固定化します。

### 7.1 GAS の Deploy ID / Web App URL

- 取得場所（公式）:
  - Apps Script Deployments: https://developers.google.com/apps-script/concepts/deployments
  - Apps Script Web Apps: https://developers.google.com/apps-script/guides/web
- 実操作:
  1. Apps Script プロジェクトを開く（https://script.google.com/）。
  2. **Deploy > Manage deployments** を開く。
  3. Active deployment を選択して **Deployment ID** を確認。
  4. Web app の `.../exec` URL をコピー（これを `GAS_URL` に使う）。

### 7.2 Cloudflare R2 の Access Key / Secret / Endpoint

- 取得場所（公式）:
  - S3 API getting started: https://developers.cloudflare.com/r2/get-started/s3/
  - API トークン: https://developers.cloudflare.com/r2/api/s3/tokens
- 実操作:
  1. Cloudflare Dashboard（https://dash.cloudflare.com/）へ。
  2. **R2 > Overview > Manage API Tokens** から作成。
  3. `Access Key ID` / `Secret Access Key` を保存。
  4. `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` 形式の Endpoint を確認。

### 7.3 Cloudflare R2 の CORS 宣言

- 取得場所（公式）:
  - CORS: https://developers.cloudflare.com/r2/buckets/cors/
- 実操作:
  1. R2 バケット > **Settings > CORS Policy**。
  2. JSON タブにポリシーを入力。

サンプル（要置換）:

```json
{
  "rules": [
    {
      "allowed": {
        "origins": [
          "https://<YOUR_GITHUB_USERNAME>.github.io"
        ],
        "methods": ["GET", "HEAD"],
        "headers": ["*"]
      }
    }
  ]
}
```

> `origins` は必ずあなたの実際のフロント配信元ドメインに置換してください。

### 7.4 GitHub Actions Secrets の登録場所

- 取得場所（公式）:
  - Using secrets in GitHub Actions: https://docs.github.com/github/automating-your-workflow-with-github-actions/creating-and-using-encrypted-secrets
- 実操作:
  1. 対象リポジトリを開く。
  2. **Settings > Secrets and variables > Actions**。
  3. **New repository secret** で必要値を追加。

---

## 8. CODEX投入時の推奨プロンプト（再現依頼テンプレ）

以下を CODEX に渡すと再現タスクを具体化しやすいです。

```text
このリポジトリの docs/repository-specification.md と docs/repro-appendix-gas-scripts.md に基づいて、
同等の構成（Spreadsheet -> GAS -> GitHub Actions -> Cloudflare R2 -> index.html）を新規環境へ再現してください。

条件:
- GAS は Web app として deploy し、GAS_URL を GitHub Secrets に設定すること。
- Actions は sync-gas.yml / sync-r2.yml を有効化すること。
- R2 CORS をフロント配信ドメインに合わせて設定すること。
- index.html は static_base で R2 public-data を参照して動作確認すること。
```

---

## 9. トラブル時の確認順

1. `GAS_URL` が `/exec` を指しているか。
2. `sync-gas` が成功し `public-data/meta.json` が更新されているか。
3. `sync-r2` が成功し R2 オブジェクト時刻が更新されているか。
4. フロント `static_base` が `.../public-data/` で終わっているか。
5. CORS でフロントドメインが許可されているか。

---

## 10. 補足

- CODEX から直接操作できない Spreadsheet/GAS の実コードは、必ず付録 `docs/repro-appendix-gas-scripts.md` を参照して貼り付ける。
- ID/URL/ドメインは環境依存なのでプレースホルダを必ず置換する。
