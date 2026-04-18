# GAS archive cursor API spec (rolling sync)

この仕様は `scripts/sync-gas.mjs` の archive ローリング同期で使う最小契約です。
GAS 実装が repo 外にある前提で、既存 endpoint の後方互換を壊さず optional param を追加します。

## Request (GET)

必須:
- `sheet=archive`

任意（追加）:
- `afterDate8`: 数値。前回 cursor の `date8`。
- `afterKey`: 文字列。前回 cursor の key。
- `limit`: 数値。今回取得する最大件数。

## Sort order (server)

- `date8 ASC`
- 同日内は `key ASC`

## Cursor semantics

- 次ページ取得条件は `(date8,key)` の辞書順で `>`。
- offset ベース巡回は使わない。

## Response

```json
{
  "ok": true,
  "sheet": "archive",
  "rows": [],
  "total": 0,
  "matched": 0,
  "nextCursorDate8": 20240315,
  "nextCursorKey": "artist|title|kind|date8",
  "hasMore": true
}
```

- `rows`: 正規化可能な archive 行配列。
- `nextCursorDate8` / `nextCursorKey`: 次回開始点。
- `hasMore`: この cursor 以降に未取得が残るか。

## Compatibility

- `afterDate8` / `afterKey` 未指定でも従来どおり動作すること。
- 既存クライアントを壊さないこと。

## Client behavior (this repo)

- songs / gags は毎回全件取得のまま。
- archive は 1 実行あたり 1 バッチのみ取得。
- 終端時（`hasMore=false`）は cursor を先頭に戻して次サイクルへ。
- upsert の同一判定は URL を含めず `artist+title+kind+date8` を使用。
  - caveat: 同一論理キーが実データで重複すると衝突するため、client は warning を出す。

## Recovery flags

- `ARCHIVE_RESET_CURSOR=true`
  - cursor を先頭へ戻す。
- `ARCHIVE_FORCE_RESEED=true`
  - 1回で全件同期はしない。
  - `archive.json` を信頼せず、先頭からローリング再収集を開始する。
