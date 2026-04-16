# PROGRESS

## Project
- songsDB のデータ同期・表示ルールを最終形に固定する。
- 方針変更を `PROGRESS.md` で一元管理する。

## Final Goal
- 履歴表示は **1曲1JSON（`historyRef`）** を唯一の経路とする。
- **本番ランタイム**は GAS `archive` API 非依存にする。
- **build/sync 時のみ** GAS `archive` API を live 取得し、同一楽曲の複数履歴を生成する。
- 一覧は `songs/gags/meta`、履歴は `history/<id>.json` を **R2のみ** で配信し、GitHubはコード/文書中心にする。

## Non-Goals
- 新機能追加や UI 改修。
- GAS 側の全面刷新。

## Constraints
- 単一ブランチ運用（`main`）。
- 既存データ互換性を維持。
- 方針変更は実装より先に記録する。

## Current Findings
- `index.html` は `historyRef` 単一 fetch で履歴描画している。
- 現在の「1件履歴」は `ensureHistoryCoverageForCoreRows()` の fallback 由来で、表示バグではなく供給データ不足が原因。
- `meta.history.multiEntryFiles=0` の主因は archive 取得失敗ではなく、`rowId`（`dUrl` 含む）で履歴を束ねていたこと。
- 同一楽曲の履歴ページを作るには、行ID（`rowId`）と分離した `historyKey` が必要。
- 今回の運用では `artist | title` を履歴グルーピングの必要最小限キーとする。
- 今回の変更で、GitHub保存前提ではなく「build時 live archive 取得 → history生成 → R2 upload」へ切り替える。
- CI失敗の原因は「historyのGitHub非追跡化」自体ではなく、repo 現物の `public-data/history/*.json` を必須にする stale validation だった。
- build 後ワークスペースの history 生成確認（`meta.history.sourceMode=live-archive` / `meta.history.files>0`）は継続する。

## Decision Log
- 2026-04-14: `PROGRESS.md` を進捗管理ファイルとして導入。
- 2026-04-14: 方針変更時は `Decision Log` / `Roadmap` を実装前に更新する運用を確定。
- 2026-04-14: 履歴表示は `historyRef` 単一 fetch を正式採用（1曲1JSON）。
- 2026-04-14: 旧 `archive` 動的取得（exact/paging）を通常フローから退役。
- 2026-04-15: Phase 6 クローズ完了。受け入れ条件 8 を充足。
- 2026-04-15: GitHub Actions `sync-gas.yml` で `DEFAULT_GAS_API_URL` 置換ステップが失敗。原因を「HTML書換え前提の脆弱性」とし、`GAS_URL` 存在チェックへ置換して再発防止。
- 2026-04-15: R2段階移行 Phase 1 に着手。`sync-r2.yml` で `public-data/history/*.json` もR2へ並行保存する方針を採用。
- 2026-04-15: R2段階移行 Phase 2 を開始。`historyRef` は「相対パス/絶対URL」を許容し、`index.html` と `README.md` の解決ルールを統一。
- 2026-04-15: `sync-r2.yml` に運用証跡強化を追加。history 事前件数チェック・R2アップロード後件数チェックを導入し、`GITHUB_STEP_SUMMARY` へ自動記録する運用に更新。
- 2026-04-15: `renderHistory()` の取得方針を再確認。通常フローは `historyRef` 単一 fetch を維持し、`archive` 二重取得経路を持ち込まない方針を明文化。
- 2026-04-15: `public-data/songs.json` のGitHub管理を終了する完遂ロードマップ（判定条件付き）を定義。
- 2026-04-15: `sync-r2.yml` 実行記録（Run: 24440765131）を確認。`Upload songs/gags/meta to R2` / `Upload history files to R2` は成功、`GITHUB_STEP_SUMMARY` の件数は preflight=1355 / post-check=1355。URL: https://github.com/PerformanceRecord/kasane-3khz-songsDB/actions/runs/24440765131/job/71405022542
- 2026-04-15: `sync-r2.yml` 実行記録（Run: 24442339098）を確認。`Upload songs/gags/meta to R2` / `Upload history files to R2` は成功、`GITHUB_STEP_SUMMARY` の件数は preflight=1355 / post-check=1355。URL: https://github.com/PerformanceRecord/kasane-3khz-songsDB/actions/runs/24442339098/job/71410114838
- 2026-04-15: `sync-r2.yml` 実行記録（Run: 24443606455）を確認。`Upload songs/gags/meta to R2` / `Upload history files to R2` は成功、`GITHUB_STEP_SUMMARY` の件数は preflight=1355 / post-check=1355。URL: https://github.com/PerformanceRecord/kasane-3khz-songsDB/actions/runs/24443606455
- 2026-04-16: archive 依存撤去を実施。`sync-r2.yml` から通常 archive アップロードを削除、`scripts/sync-gas.mjs` は archive 不在でも history 生成を継続、`README.md` を実装へ同期。
- 2026-04-16: R2公開URLの直接検証を実施（PowerShell実測記録）。`songs.json` は HTTP 200 / `rows=493` / `historyRef` 保持 493/493、`history/428fa06c1437.json` は HTTP 200。検証URL: `https://pub-34d8fa96953d472aa7cb424b9daf2d60.r2.dev/public-data/`
- 2026-04-16: history の複数件表示を達成するため、archive は build 時のみ live 取得し、生成物は R2 にのみ配置する。GitHub は履歴データ保存先にしない。
- 2026-04-16: `validate-history-artifacts.yml` の stale validation（repo上 `public-data/history/*.json` 必須）を撤去。`sync-r2.yml` と同条件（`GAS_URL` + `ENABLE_ARCHIVE_SYNC=true` + `ARCHIVE_STRICT_SYNC=true`）で build 後成果物を検証し、fork PR は secret 不可のため skip へ変更。
- 2026-04-16: 履歴グルーピングを `rowId` から分離する方針を確定。`rowId` は行識別として維持し、`buildHistoryKey(artist,title)` で同一楽曲履歴を束ねる。`kind` / `dUrl` は履歴ページ束ね条件に使わない。目的は「同一楽曲の履歴ページを1つにまとめる」こと。
- 2026-04-16: フロントエンドの保守性改善として、`index.html` のインラインCSS/JSを `assets/css/app.css` / `assets/js/app.js` へ分離。動作仕様は維持し、フォルダ階層で責務を明確化。

## Roadmap
1. Phase 1: 現状と差分の棚卸し（完了）
2. Phase 2: 最終方針（1曲1JSON / archive非依存）の明文化（完了）
3. Phase 3: 実装の整合化（`historyRef` 経路に統一・archive通常依存の撤去）（完了）
4. Phase 4: ドキュメント整合（README/運用手順の更新）（完了）
5. Phase 5: 検証（受け入れ条件チェック）（完了）
6. Phase 6: クローズ準備（残タスク0化・最終記録）（完了）

## Task Checklist
- [x] 進捗管理ファイル（`PROGRESS.md`）作成
- [x] Final Goal を最終要件に更新
- [x] Roadmap を Phase 1〜6 に統一
- [x] 確定判断を Decision Log に追記
- [x] Verification Checklist を受け入れ条件 8 項目へ更新
- [x] Phase 6 のクローズ完了
- [x] Phase 1: history JSON のR2並行保存を workflow に追加
- [x] Phase 1: R2並行保存のREADME運用手順を追記
- [x] 完了済み整理: フロント static fetch 化 / manifest 相対化 / historyRef ベース表示
- [x] `sync-r2.yml` の通常 archive アップロード撤去
- [x] `scripts/sync-gas.mjs` の archive 必須分岐撤去（archiveなしでも history 生成）
- [x] README の実装同期（history JSON構造・GAS_URL必須）

## Risks/Blockers
- GAS archive API 障害時は history 生成が停止するリスク（strict sync で fail）。
- archive live fetch が silent fallback すると履歴品質が 1件構成に劣化するリスク。
- GitHub 上の stale `public-data/archive.json` に依存すると設計方針が崩れるリスク。
- archive のページング量増加で sync 時間が伸びるリスク。

## Verification Checklist
- [ ] 本番ランタイムは archive API 非依存
- [ ] build/sync 時のみ archive API を利用する
- [ ] `history/*.json` は R2 に存在し、GitHub 運用対象外
- [ ] 同一楽曲の複数履歴が少なくとも1件は生成される
- [ ] `meta.json` で `history.sourceMode=live-archive` を確認できる
- [ ] archive fetch 失敗時に silent fallback せず fail する
- [ ] README / workflow / script の前提が一致している

## Phase 完了判定（archive依存撤去後）
- Phase 3 完了条件:
  - `index.html` が `historyRef` 単一 fetch を維持している。
  - `scripts/sync-gas.mjs` が archive 取得なしでも `history/<id>.json` を生成できる。
- Phase 4 完了条件:
  - `README.md` / `docs/new-repo-seed-spec.md` / 運用メモが通常フロー（`songs/gags/meta/history`）で一致。
  - archive は「通常運用では無効、必要時のみ `ENABLE_ARCHIVE_SYNC=true`」で統一。
- Phase 5 完了条件:
  - Verification Checklist 1〜9 を充足。
  - `site.webmanifest` の相対パス仕様と `index.html` の manifest 参照に矛盾がない。


## History ディレクトリ GitHub管理終了計画（独立段）

### 目的
- GitHub上の `public-data/history/` を運用対象から外し、R2配信を正とする。
- 本番導線は壊さず、先に本番既定参照をR2へ固定してから追跡解除する。

### 実施方針（最小差分）
1. `index.html` の既定参照を本番R2へ変更（優先順位: query > localStorage > 本番既定R2 > local/dev fallback）。
2. `sync-gas.yml` は schedule を維持しつつ、`public-data/history` を commit 対象から除外。
3. `.gitignore` で `public-data/history/` を明示的に除外。
4. `public-data/history/` を Git追跡解除（`git rm --cached` 相当）。

### 実行ゲート
- [x] 本番導線が R2 既定で動作
- [x] `sync-gas.yml` が history を GitHub に再コミットしない
- [x] `public-data/history/` の Git追跡解除完了
- [x] rollback 手順確認済み

## Next Step
- Phase X: `historyKey` 導入（`buildHistoryKey(artist,title)`）
- Phase X2: `rowId` 依存の履歴グルーピング解消（history参照/coverage を `historyKey` ベースへ統一）
- Phase Y: R2 上で複数履歴生成を確認（`meta.history.multiEntryFiles` を含む）
- Phase Z: GitHub 側 archive/history データ依存を完全撤去
- その後に songs.json 側の GitHub管理終了計画へ接続

## Recheck (main反映後)
- 対象5ファイル: `PROGRESS.md` / `README.md` / `index.html` / `scripts/sync-gas.mjs` / `public-data/songs.json`
- 実施日: 2026-04-14

### 受け入れ条件 再チェック（1〜8）
- 1) 一覧データ源が `songs/gags/meta` に固定されている: **OK**
- 2) 履歴表示が `historyRef` 単一 fetch で動作する: **OK**（`public-data/songs.json` の全493行で `historyRef` あり）
- 3) 1曲ごとの `public-data/history/<id>.json` が存在する: **OK**（全 `historyRef` 参照先の `public-data/history/*.json` 実在を確認）
- 4) 通常フローで GAS `archive` API を呼ばない: **OK**
- 5) 旧 archive exact/paging 経路が退役扱いで明記されている: **OK**
- 6) README と実装の前提が一致している: **OK**（README の `songs/gags/meta + history/<id>.json` 前提と `songs.json` の `historyRef` / `history/*.json` 実体が一致）
- 7) Decision Log に確定判断が日付付きで残っている: **OK**
- 8) 最終クローズ時の手順（Phase 6）が完了している: **OK**（2026-04-15 クローズ完了）

### NGの最小タスク分割（次アクション）
- なし（全受け入れ条件を充足）。
- 追記: 2026-04-15 の Actions 失敗（`DEFAULT_GAS_API_URL` 置換）を記録し、workflow を secret 検証方式へ修正済み。


## R2移行 完遂ロードマップ（songs.json のGitHub管理終了まで）

### 最終ゴール
- 一覧/履歴データの正を R2 に一本化する。
- `public-data/songs.json` は GitHub から削除し、R2のみで配信する。

### Phase A: 安全確認（1〜2日）
- 作業
  - `sync-r2.yml` の直近3回を確認し、`songs/gags/meta/history` のアップロード成功を記録。
  - `static_base` が R2 `.../public-data/` で終わるURLになっていることを確認。
- Done
  - 3回連続成功の証跡（実施日・Run URL・件数）が `Decision Log` にある。
- ロールバック
  - R2配信が不安定なら現行GitHub配信を維持し、削除工程へ進まない。

### Phase B: 読み取り先の固定（R2優先化）
- 作業
  - README運用手順を「通常はR2を一次データ源」に固定。
  - 監視観点（404率・JSON取得失敗）を運用メモに追加。
- Done
  - ドキュメントと実動作がR2優先で一致。
- ロールバック
  - `static_base` をGitHub配信へ戻し、R2障害中も表示を継続。

### Phase C: GitHub側 songs.json 凍結
- 作業
  - `public-data/songs.json` を更新対象から外す（生成/コミット運用を停止）。
  - 直近バックアップ（R2とローカル）を保存。
- Done
  - 7日間、R2のみ参照で問題なし（主要画面で404/欠損なし）。
- ロールバック
  - バックアップから `songs.json` をGitHubへ一時復元。

### Phase D: GitHub側 songs.json 削除（完遂）
- 作業
  - `public-data/songs.json` をGitHubから削除。
  - README/PROGRESSに「削除日・復旧手順・担当」を記録。
- Done（完遂条件）
  - 削除後も本番表示が正常。
  - `sync-r2.yml` が連続2回成功。
  - 障害時復旧手順（R2→GitHub一時復元）が1手順で実行可能。
- ロールバック
  - 直近バックアップで即日復旧。

### 削除実行ゲート（満たすまで削除禁止）
- [x] 連続3回のR2同期成功ログがある。
- [x] `songs.json` をR2 URLで直接取得して内容検証済み。
- [ ] 本番URLで一覧→詳細履歴の動作確認済み。
- [x] 404/5xx監視手段がある（簡易でも可）。
- [x] 復旧担当と手順が文書化済み。

### 次アクション（この後の実行順）
1. 本番URLで一覧→詳細履歴の動作確認を実施する（Pages本番URL + `?static_base=https://pub-34d8fa96953d472aa7cb424b9daf2d60.r2.dev/public-data/`）。
2. Phase C の凍結期間（7日）を開始する。
3. 凍結期間中の監視（404/5xx・JSON取得失敗）を継続する。
4. ゲート全充足後に Phase D を実施する。
