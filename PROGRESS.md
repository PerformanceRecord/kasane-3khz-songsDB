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
- `README.md` も通常フローで GAS `archive` 非利用を明記済み。
- 旧 archive 動的取得系は退役扱いとして整理済み。

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

## Roadmap
1. Phase 1: 現状と差分の棚卸し（完了）
2. Phase 2: 最終方針（1曲1JSON / archive非依存）の明文化（完了）
3. Phase 3: 実装の整合化（`historyRef` 経路に統一）
4. Phase 4: ドキュメント整合（README/運用手順の更新）
5. Phase 5: 検証（受け入れ条件チェック）
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

## Next Step
- 次回方針変更時は `Decision Log` / `Roadmap` を先に更新する。
- `sync-gas.yml` の secret 検証ステップを維持し、`index.html` 書換えステップは再導入しない。
- `sync-r2.yml` 実行時は `GITHUB_STEP_SUMMARY` の preflight/post-check を確認し、history 件数が 0 でないことを運用記録に残す。

## 直近実行アクション（2026-04-15 時点）
1. GitHub Actions の `sync-r2.yml` を手動実行し、以下3点を確認する。  
   - `Upload songs/gags/meta to R2` が成功  
   - `Upload history files to R2` が成功  
   - `GITHUB_STEP_SUMMARY` に preflight/post-check の件数が記録されている
2. 上記の実行結果（実施日・実行URL・件数）を `Decision Log` に1行追記する。
3. これを最低3回連続で満たしたら、Phase 2 の完了判定を実施する。

### Phase 2 完了判定（合格条件）
- 連続3回の `sync-r2.yml` 実行で、history の preflight/post-check 件数がすべて一致。
- `README.md` と `index.html` の `historyRef` 解決ルール（相対/絶対URL許容）が一致。
- Decision Log に「Phase 2 完了」の日付付き記録がある。

## 中間評価（2026-04-15）

### 1) どこまでできているか（事実チェック）
- `sync-r2.yml` に `public-data/history/` の再帰同期（`aws s3 sync ... --delete`）が実装済み。
- `songs.json` / `gags.json` の全行で `historyRef` が存在し、参照先ファイルも実在（欠損0）。
- `index.html` は履歴表示時のみ `historyRef` を fetch する遅延読込方式で、巨大 archive を一括取得しない。

### 2) ゴール到達性の途中評価
- ゴール1（履歴情報のR2取り込み）: **進捗は良好（Phase 1実装済み）**。ただし「実運用で毎回成功している証跡」は未記録。
- ゴール2（膨大なarchiveをスムーズにHTML表示）: **方向性は妥当**。`historyRef` 分割＋遅延読込により、画面初期負荷を抑える設計になっている。
- 総合: **改善は正しい方向で進行中**。未完了点は「運用証跡」と「Phase 2（参照先の柔軟化）」。

### 3) 直近アクション（チェックと改善）
1. `sync-r2.yml` 実行ログで以下を確認し、実施日付きで Decision Log に追記する。  
   - `Upload songs/gags/meta to R2` 成功  
   - `Upload history files to R2` 成功
2. Phase 2開始前チェックとして、`historyRef` の許容形式（相対/絶対URL）を README と `index.html` で同一ルールに明文化する。
3. archive 大量化に備え、受け入れ条件へ「初期表示で history 一括取得をしない」を明示追加する（回帰防止）。

### 4) 判断
- 現時点では **問題なく前進している**。  
- ただし最終ゴール達成判定には、R2同期の継続成功記録（最低数回）と、Phase 2着手記録が必要。

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


## R2段階移行（最小変更案）

### Phase 1（準備）
- 内容: 現行（GitHub保存）は維持しつつ、同じ history JSON をR2にも並行保存する。
- 目的: 本番影響なしでR2配信の可否を確認する。
- リスク: 二重保存による運用ミス。
- ロールバック: R2保存処理だけ停止し、現行運用に戻す。
- 実装メモ（2026-04-15）: `sync-r2.yml` に `public-data/history/` の再帰同期ステップを追加し、一覧JSONと同じジョブで並行保存する。

### Phase 2（参照先の柔軟化）
- 内容: `historyRef` を「相対パス（GitHub）」と「絶対URL（R2）」の両方で読める前提にそろえる。
- 目的: データ置き場の切替を段階的に可能にする。
- リスク: URL整形ミスで404が出る。
- ロールバック: `historyRef` を相対パス出力に固定する。

### Phase 3（新規分のみR2優先）
- 内容: 新規生成の history はR2を正とし、GitHubはフォールバックとして一定期間残す。
- 目的: 利用実績を見ながら安全に移行する。
- リスク: GitHub/R2の内容差分。
- ロールバック: 生成先をGitHub優先へ戻す。

### Phase 4（完全移行）
- 内容: history本体はR2のみ保存し、GitHub側は凍結（または最小索引のみ保持）する。
- 目的: リポジトリ肥大化を止め、配信をストレージ向け設計にする。
- リスク: R2障害時の参照不能。
- ロールバック: 直近バックアップからGitHub配信を一時復旧する。
