# iOS アプリのビルドと配信（Mac なし）

Mac がなくても、GitHub Actions のクラウド Mac でビルドし、TestFlight（App Store Connect）へアップロードできるようにしてあります。

- アプリ名（ホーム画面・App Store）：編み図ライブラリ
- バンドルID：`com.sammy.knittinglibrary`（**公開後は変更できません**）
- 対応端末：iPhone・iPad（iOS 15 以降）

## 初回だけ行う準備

### 1. GitHub にリポジトリを作成してプッシュ
非公開（Private）リポジトリを推奨します。

### 2. App Store Connect API キーを作成
1. [App Store Connect](https://appstoreconnect.apple.com/) →「ユーザとアクセス」→「統合」→「App Store Connect API」
2. 「チームキー」を生成。アクセス権は **Admin**（証明書を自動で作成するために必要）
3. 表示される **キーID** と **発行者ID（Issuer ID）** を控える
4. `AuthKey_XXXXXXXXXX.p8` をダウンロード（**1回しかダウンロードできません**。安全な場所に保管）

### 3. チームID を確認
[Apple Developer](https://developer.apple.com/account) →「メンバーシップの詳細」→ チームID（英数字10桁）

### 4. App ID を登録
Apple Developer →「Certificates, Identifiers & Profiles」→「Identifiers」→「＋」→「App IDs」→「App」
- Bundle ID：Explicit で `com.sammy.knittinglibrary`
- Capabilities：追加不要

### 5. App Store Connect でアプリを作成
「マイApp」→「＋」→「新規App」
- プラットフォーム：iOS
- 名前：編み図ライブラリ（他のアプリと重複している場合は変更が必要）
- 主言語：日本語
- バンドルID：`com.sammy.knittinglibrary`
- SKU：任意（例 `knittinglibrary`）

### 6. GitHub に Secrets を登録
リポジトリの「Settings」→「Secrets and variables」→「Actions」→「New repository secret」

| 名前 | 値 |
|---|---|
| `APPLE_TEAM_ID` | チームID |
| `ASC_KEY_ID` | キーID |
| `ASC_ISSUER_ID` | 発行者ID |
| `ASC_KEY_P8` | `.p8` ファイルをメモ帳で開いた中身すべて（`-----BEGIN PRIVATE KEY-----` から `-----END PRIVATE KEY-----` まで） |

## ビルドしてアップロード
1. GitHub の「Actions」タブ →「iOS TestFlight」→「Run workflow」
2. 20分前後で完了すると App Store Connect にビルドが届きます（処理にさらに数分〜数十分）
3. App Store Connect の「TestFlight」で自分をテスターに追加し、iPhone の TestFlight アプリからインストール

ビルド番号は Actions の実行回数が自動で使われます。バージョン（1.0 など）を上げるときは
`ios/App/App.xcodeproj/project.pbxproj` の `MARKETING_VERSION` を変更します。

## 実機で確認してほしいこと（このリポジトリでは未確認）
- アプリが起動し、作品登録・PDF表示・カウンターが動く
- 機内モードでも保存済みの作品を開ける
- **共有メニュー**：Safari や「ファイル」アプリで PDF を開き、共有ボタン →「編み図ライブラリ」→ 受け取り画面が開く
  （一覧に出ない場合は、アプリ一覧の右端「その他」から表示をオンにする）
- PDF 上での2本指の拡大縮小、マーカー・ペン（指と Apple Pencil）
- 設定 →「完全バックアップを作成」→「ファイルを保存」で共有シートが開き、「"ファイル"に保存」できる
- 設定 →「バックアップから復元」で保存した ZIP を選べる
- 購入先URL・Ravelry 日本語検索のリンクが Safari で開く

## 審査提出までに必要なもの
- スクリーンショット（iPhone 6.9インチ、iPad 13インチ）
- 説明文・キーワード・サポートURL
- プライバシーポリシーの URL
- App のプライバシー：「データを収集しない」（広告・解析・アカウントなし、データは端末内のみ）

アイコンと起動画面は `npm run build` 後に `node scripts/generate-ios-assets.mjs` で `public/icon.svg` から再生成できます。
