# アイコン配置ガイド

このディレクトリは、ファビコンとスマートフォン保存時のアプリアイコン（PWA）を保存する場所です。

## ディレクトリ構成

- `assets/icons/favicon/`
  - ブラウザタブ用の favicon を配置
- `assets/icons/app/`
  - iOS / Android のホーム画面追加向けアイコンを配置

## 配置するファイル

### `assets/icons/favicon/`

- `favicon.ico` (16x16, 32x32, 48x48 を含むマルチサイズ)
- `favicon.svg` (ベクター形式・対応ブラウザ向け)

### `assets/icons/app/`

- `apple-touch-icon.png` (180x180)
- `icon-192.png` (192x192)
- `icon-512.png` (512x512)
- `icon-512-maskable.png` (512x512, maskable safe area を考慮)

## 備考

- `index.html` と `site.webmanifest` は上記構成を参照するよう設定済みです。
- Android maskable icon は、主要要素を中央 80% 以内に収めることを推奨します。
