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

## Roadmap
1. Phase 1: 現状と差分の棚卸し（完了）
2. Phase 2: 最終方針（1曲1JSON / archive非依存）の明文化（完了）
3. Phase 3: 実装の整合化（`historyRef` 経路に統一）
4. Phase 4: ドキュメント整合（README/運用手順の更新）
5. Phase 5: 検証（受け入れ条件チェック）
6. Phase 6: クローズ準備（残タスク0化・最終記録）

## Task Checklist
- [x] 進捗管理ファイル（`PROGRESS.md`）作成
- [x] Final Goal を最終要件に更新
- [x] Roadmap を Phase 1〜6 に統一
- [x] 確定判断を Decision Log に追記
- [x] Verification Checklist を受け入れ条件 8 項目へ更新
- [ ] Phase 6 のクローズ完了

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
- [ ] 8) 最終クローズ時の手順（Phase 6）が完了している

## Next Step
- Phase 6 として、残る未チェック項目（Verification Checklist 8）を完了として確定し、完了記録を追記する。
