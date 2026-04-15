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

## Risks/Blockers
- 旧 archive 前提の運用手順が局所的に残ると誤運用のリスク。
- history JSON 生成漏れがあると個別曲の履歴表示が欠落する。

## Verification Checklist
- [x] 1) 一覧データ源が `songs/gags/meta` に固定されている
- [x] 2) 履歴表示が `historyRef` 単一 fetch で動作する
- [x] 3) 1曲ごとの `public-data/history/<id>.json` が存在する
- [x] 4) 通常フローで GAS `archive` API を呼ばない
- [x] 5) 旧 archive exact/paging 経路が退役扱いで明記されている
- [x] 6) README と実装の前提が一致している
- [x] 7) Decision Log に確定判断が日付付きで残っている
- [x] 8) 最終クローズ時の手順（Phase 6）が完了している

## Next Step
- 次回方針変更時は `Decision Log` / `Roadmap` を先に更新する。

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


## R2段階移行（最小変更案）

### Phase 1（準備）
- 内容: 現行（GitHub保存）は維持しつつ、同じ history JSON をR2にも並行保存する。
- 目的: 本番影響なしでR2配信の可否を確認する。
- リスク: 二重保存による運用ミス。
- ロールバック: R2保存処理だけ停止し、現行運用に戻す。

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
