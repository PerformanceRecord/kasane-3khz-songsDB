# PROGRESS

## Project
- songsDB のデータ同期・表示ルールを最終形に固定する。
- 方針変更を `PROGRESS.md` で一元管理する。

## Final Goal
- 履歴表示は **1曲1JSON（`historyRef`）** を唯一の経路とする。
- 通常フローでは **GAS `archive` API を呼ばない**。
- 一覧は `songs/gags/meta`、履歴は `history/<id>.json` の組み合わせで完結させる。

## Non-Goals
- 新機能追加や UI 改修。
- GAS 側の全面刷新。

## Constraints
- 単一ブランチ運用（`main`）。
- 既存データ互換性を維持。
- 方針変更は実装より先に記録する。

## Current Findings
- `index.html` は `historyRef` 単一 fetch で履歴描画している。
- `site.webmanifest` は project page 対応の相対パス化済み。
- `sync-r2.yml` は通常運用から archive アップロードを外し、`songs/gags/meta/history` 配信に統一済み。
- `scripts/sync-gas.mjs` は archive 不在でも history JSON を生成し、全 row の `historyRef` を維持する構成に更新済み。
- `README.md` は history JSON 構造・`GAS_URL` 必須・archive の位置づけを実装に同期済み。

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
- 旧 archive 前提の運用手順が局所的に残ると誤運用のリスク。
- history JSON 生成漏れがあると個別曲の履歴表示が欠落する。
- `index.html` の直接書換えを前提にした CI ステップは壊れやすく、同期ジョブ停止のリスク。

## Verification Checklist
- [x] 1) 一覧データ源が `songs/gags/meta` に固定されている
- [x] 2) 履歴表示が `historyRef` 単一 fetch で動作する
- [x] 3) 1曲ごとの `public-data/history/<id>.json` が存在する
- [x] 4) 通常フローで GAS `archive` API を呼ばない
- [x] 5) 旧 archive exact/paging 経路が退役扱いで明記されている
- [x] 6) README と実装の前提が一致している
- [x] 7) Decision Log に確定判断が日付付きで残っている
- [x] 8) 最終クローズ時の手順（Phase 6）が完了している
- [x] 9) 初期表示で history 一括取得をしない（詳細は選択時の `historyRef` fetch のみ）

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

## Next Step
- archive依存撤去は完了済み。直近の未充足ゲートは「本番URLで一覧→詳細履歴の動作確認」のみ。
- Pages本番URLに `?static_base=https://pub-34d8fa96953d472aa7cb424b9daf2d60.r2.dev/public-data/` を付け、一覧表示→1件選択→履歴表示を実測確認する。
- 確認後に削除実行ゲートを更新し、Phase C（GitHub側 `songs.json` 凍結期間開始）へ進む。

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
