# kasane-3khz-songsDB

> GitHub Pages: https://performancerecord.github.io/kasane-3khz-songsDB/

このリポジトリは、楽曲/ネタ一覧と履歴JSONを**静的配信**するための運用リポジトリです。

## 1. いまの運用スキーム（実態）

- 一次データ源は **Cloudflare R2 の `public-data/`**。
- 本番ランタイム（`index.html`）は **`songs/gags/meta/history` をR2から読む**。
- GAS `archive` API は **build/sync 時だけ**使う（画面表示時は使わない）。
- GitHub は **コード・ドキュメント・ワークフロー管理**が中心。データ実体の配信先はR2。
- 本番ルート `index.html` は承認済み v2 UI を使用し、実装アセットは `v2/assets/` を参照する。`/v2/` は確認用として維持する。

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

- `songs` はページングで全件取得し、`gags` は単発取得して `public-data/*.json` を更新
- `history/<id>.json` を生成
- `meta.json` を再生成
- 必要時のみ `ENABLE_ARCHIVE_SYNC=true` で archive を live 取得
- archive は cursor 方式のローリング更新（毎回1バッチ）で取得し、`public-data/archive-crawl-state.json` で巡回状態を保持

### 手動でのアップロードデータ整理

GitHub Actions の **「マニュアルでアップロードデータの整理を行う」** は、年に数回の完全再同期を想定した手動専用処理です。実行時は `confirm_refresh` を有効にします。

- `songs` / `gags` / `archive` を既存JSONに追加せず、200件ずつ先頭から全ページ再取得
- 取得中に `total` / `matched` が変わった場合や、最終件数が一致しない場合はR2更新前に停止
- 全履歴JSONと `historyRef` の対応を検証
- 現在のR2 `public-data/` を `backups/manual-full-refresh/<run-id>/public-data/` へ退避
- 新しい `songs/gags/meta/history` を反映後、スプレッドシート由来データに存在しない `history/*.json` を削除
- 完全再取得した `archive.json` と巡回状態を `main` に保存し、次回の通常巡回で古い行が復活することを防止

ページング中の並び替えを避けるため、実行中は対象スプレッドシートを編集しないでください。通常の定期同期は従来どおりローリング方式を継続します。

### GAS保守スクリプト

実運用の統合GASは `google-apps-script-reference/merge-songs-gags-archive.gs` でバージョン管理します。メニュー機能は日常仕分け・完全重複の総点検・近似情報チェック・統計の4つです。日常用仕分けは新規行の有無にかかわらず毎回全件の重複を検査します。GitHubからApps Scriptへの自動デプロイは行わないため、更新後はApps Scriptプロジェクトへ手動反映します。詳細仕様は `google-apps-script-reference/README.md` を参照してください。

## 4. 必須環境変数（最小）

- `GAS_URL`（必須）
- `OUT_DIR`（省略時 `public-data`）

よく使う制御:
- `ENABLE_ARCHIVE_SYNC`（既定 `false`）
- `ARCHIVE_STRICT_SYNC`（既定 `false`）
- `ARCHIVE_BATCH_SIZE_MIN` / `ARCHIVE_BATCH_SIZE_MAX` / `ARCHIVE_BATCH_SIZE_FALLBACK`
- `ARCHIVE_RESET_CURSOR`（先頭から再開）
- `SONGS_MAX_PAGES`（songs ページング全件取得の安全上限。既定 `20`）
  - 上限に到達しても続きがある場合は、欠損データを正常扱いせず sync を失敗させます。
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
6. 本番UI切替に問題がある場合は、ルート `index.html` を切替直前のblob SHA `beb30f47b549cd152dd7f8ee7a32d87001573f4a` へ戻す（旧 `assets/` とR2データは変更していないため追加復旧は不要）

手動整理後に復旧する場合は、対象Actionの Summary に記録されたバックアップ先を確認します。まず手動整理が作成したスナップショットコミットを `git revert` し、その後、次のようにバックアップをR2の配信先へ戻します。

```bash
aws s3 sync \
  "s3://<bucket>/backups/manual-full-refresh/<run-id>/public-data" \
  "s3://<bucket>/public-data" \
  --endpoint-url "<R2 endpoint>" \
  --region auto \
  --delete
```

復旧対象の実行IDとバックアップ先を確認してから実行し、復旧完了後に `songs.json` と代表的な `history/*.json` を確認します。バックアップは自動削除しません。

## 7. 削除ゲート（重要）

`public-data/songs.json` のGitHub削除は、`PROGRESS.md` の削除実行ゲートが**全て完了**するまで実施しません。

## 8. 関連ドキュメント

- 進捗・判定ログ: `PROGRESS.md`
- 新規環境立ち上げの仕様: `docs/new-repo-seed-spec.md`
