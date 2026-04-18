# kasane-3khz-songsDB

> GitHub Pages: https://performancerecord.github.io/kasane-3khz-songsDB/

このリポジトリは、楽曲/ネタ一覧と履歴JSONを**静的配信**するための運用リポジトリです。

## 1. いまの運用スキーム（実態）

- 一次データ源は **Cloudflare R2 の `public-data/`**。
- 本番ランタイム（`index.html`）は **`songs/gags/meta/history` をR2から読む**。
- GAS `archive` API は **build/sync 時だけ**使う（画面表示時は使わない）。
- GitHub は **コード・ドキュメント・ワークフロー管理**が中心。データ実体の配信先はR2。

## 2. データの読み方（画面側）

1. `songs.json` / `gags.json` を取得して一覧表示
2. ユーザーが1件選択
3. 行の `historyRef` を使って `history/<id>.json` を取得
4. 履歴を表示

### `historyRef` の扱い
- 相対パス（例: `history/song-123.json`）または絶対URLを許容
- 相対パスは `static_base` を基準に解決
- 運用では `static_base` を `.../public-data/` で終わるURLに統一

## 3. 同期バッチ（build/sync）

`scripts/sync-gas.mjs` が担当します。

- `songs` / `gags` を取得して `public-data/*.json` を更新
- `history/<id>.json` を生成
- `meta.json` を再生成
- 必要時のみ `ENABLE_ARCHIVE_SYNC=true` で archive を live 取得
- archive は cursor 方式のローリング更新（毎回1バッチ）で取得し、`public-data/archive-crawl-state.json` で巡回状態を保持

## 4. 必須環境変数（最小）

- `GAS_URL`（必須）
- `OUT_DIR`（省略時 `public-data`）

よく使う制御:
- `ENABLE_ARCHIVE_SYNC`（既定 `false`）
- `ARCHIVE_STRICT_SYNC`（既定 `false`）
- `ARCHIVE_BATCH_SIZE_MIN` / `ARCHIVE_BATCH_SIZE_MAX` / `ARCHIVE_BATCH_SIZE_FALLBACK`
- `ARCHIVE_RESET_CURSOR`（先頭から再開）
- `ARCHIVE_FORCE_RESEED`（1回で全件再取得はせず、先頭からローリング再収集）

## 5. 実行方法

```bash
node scripts/sync-gas.mjs
```

成功時は `public-data/` 配下のJSONが更新され、`sync complete` が出力されます。

## 6. 障害時の最短復旧（ロールバック）

1. R2の `songs.json` / `gags.json` / `meta.json` / `history/*.json` のHTTPコードを確認
2. GitHub Pages本番表示を確認
3. `sync-r2.yml` の最新実行ログを確認
4. R2障害時は一時的に `?static_base=./public-data/` で same-origin を利用
5. 必要なら直近バックアップの `songs/gags/meta` を `main` に戻して暫定復旧

## 7. 削除ゲート（重要）

`public-data/songs.json` のGitHub削除は、`PROGRESS.md` の削除実行ゲートが**全て完了**するまで実施しません。

## 8. 関連ドキュメント

- 進捗・判定ログ: `PROGRESS.md`
- 新規環境立ち上げの仕様: `docs/new-repo-seed-spec.md`
