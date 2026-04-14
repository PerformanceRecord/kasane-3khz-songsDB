# PROGRESS

## Project
- songsDB リポジトリのデータ同期フローを整理し、運用時の手戻りを減らす。
- 作業状況と意思決定を 1 ファイルで追跡できるようにする。

## Final Goal
- `public-data/archive.json` を含むデータ更新フローを、再現可能で分かりやすい手順に統一する。
- ドキュメント・workflow・script の前提を一致させる。

## Non-Goals
- この Phase 1 では機能追加や大規模リファクタはしない。
- UI/見た目の改善は対象外。
- GAS 側ロジックの全面書き換えは対象外。

## Constraints
- 単一ブランチ運用（実質 `main` のみ）。
- 既存データ互換性を維持する。
- 変更理由を追跡できるよう、先に記録してから実装する。

## Current Findings
- workflow と script で `ENABLE_ARCHIVE_SYNC` の扱いが不整合。
- 履歴更新が「GAS archive exact」依存になっている。
- README が「動的 archive 前提」の説明になっている。

## Decision Log
- 2026-04-14: Phase 1 の進捗管理として `PROGRESS.md` を導入。
- 2026-04-14: 運用ルールを追加。
  - 方針変更が発生した場合は、**コード修正前に** `Decision Log` と `Roadmap` を先に更新する。

## Roadmap
1. Phase 1: 現状調査の明文化（完了）
2. Phase 2: workflow / script / README の前提差分を設計として整理
3. Phase 3: 合意済み設計に沿って最小差分で修正
4. Phase 4: 検証手順の固定化とドキュメント最終更新

## Task Checklist
- [x] 進捗管理ファイル（`PROGRESS.md`）を新規作成
- [x] 必須セクションをすべて記入
- [x] Phase 1 の主要調査結果 3 点を記録
- [x] 方針変更時の先行更新ルールを明記
- [ ] 差分設計の具体化（Phase 2）
- [ ] 実装修正（Phase 3）
- [ ] 最終検証と完了宣言（Phase 4）

## Risks/Blockers
- archive 同期の期待仕様がドキュメントと実装でズレている可能性。
- `ENABLE_ARCHIVE_SYNC` の真偽値解釈が環境ごとに異なる可能性。
- GAS 側の「exact 依存」を緩めると履歴再現性が崩れるリスク。

## Verification Checklist
- [ ] workflow・script・README の前提が一致しているか
- [ ] archive 同期 ON/OFF の挙動が手順どおりか
- [ ] 履歴データが意図せず欠落・重複しないか
- [ ] 更新ルール（Decision Log/Roadmap 先行更新）が守られているか

## Next Step
- Phase 2 として、`ENABLE_ARCHIVE_SYNC` と archive 生成方針の差分を表形式で整理し、修正対象ファイルを確定する。
