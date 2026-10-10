# Knitting Pattern Library（編み図ライブラリ）

購入した編み図 PDF、日本語に訳した PDF、編みたい作品の URL を、ひとつの作品としてまとめて管理する編み物愛好家向けアプリです。

- アカウント登録なし・個人情報の収集なし・外部サーバーへの送信なし
- データはすべて端末内（IndexedDB）に保存し、オフラインで閲覧・編集できます
- PDF ビューア、ファイルごとの閲覧位置の保存、段数カウンター、マーカー・メモの書き込み
- バックアップ（PDF を含む ZIP）と復元

設計・実装状況・既知の制約は [docs/DESIGN.md](docs/DESIGN.md) を参照してください。

```bash
npm install
npm run dev
npm test
npm run build && npm run test:e2e
```
