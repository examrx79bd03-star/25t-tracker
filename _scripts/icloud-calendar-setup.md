# iCloud カレンダー連携 セットアップ手順

family-map のスケジュールタブに iPhone 標準カレンダーアプリの予定を表示するための初回セットアップ。
**所要時間：15〜20分**（Cloudflare Worker 作成 + Firestore ルール更新 + iCloud 公開設定）

---

## ステップ 1：Cloudflare Worker を作成（PC ブラウザ推奨）

> iCloud の公開カレンダー URL は CORS ヘッダーを返さないため、ブラウザから直接 fetch できません。Worker が代わりに取得してくれます。

1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) にログイン（アカウント：`examrx79.bd03@gmail.com`）
2. 左メニュー **「Workers & Pages」** → **「Create」** → **「Workers」** → **「Create Worker」** を選択
3. 名前を **`family-map-cal`** に変更（ハイフン区切り、英小文字）→ **「Deploy」**
4. デプロイ完了画面の **「Edit code」** をクリック
5. 左側のコードエディタで `worker.js` の中身を **全部消す**
6. `C:\AppDev\family-map\_scripts\family-map-cal-worker.js` を開いて **中身を全部コピー** → Cloudflare のエディタに貼り付け
7. 右上 **「Deploy」** → **「Save and deploy」** で確定

### Worker URL を控える
画面右上に発行された URL が表示されます。例：
```
https://family-map-cal.examrx79-bd03.workers.dev
```
このアドレスを後ほど **ステップ 4** で使います。**メモアプリにコピペしておいてください。**

---

## ステップ 2：Firestore セキュリティルールを更新（PC ブラウザ）

1. [Firebase Console](https://console.firebase.google.com/) を開く
2. プロジェクト **`family-map-c5110`** を選択
3. 左メニュー **「Firestore Database」** → **「ルール」** タブ
4. 既存ルールの `match /members/{memberId}` の直後に **`calendarSources` 1 行**を追加：

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /families/{familyId} {
      match /pins/{pinId}              { allow read, write: if request.auth != null; }
      match /events/{eventId}          { allow read, write: if request.auth != null; }
      match /familyConfig/{docId}      { allow read, write: if request.auth != null; }
      match /members/{memberId}        { allow read, write: if request.auth != null; }
      match /calendarSources/{srcId}   { allow read, write: if request.auth != null; }  // ← 追加
    }
  }
}
```

5. 右上 **「公開」** → 確認ダイアログで **「公開」** をクリック

> このルールを公開せずに使うと、iPhone でカレンダー追加時に `permission-denied` エラーになります。

---

## ステップ 3：index.html に Worker URL を書き込む（PC、テキストエディタ）

1. `C:\AppDev\family-map\family-map\index.html` を **メモ帳 or VSCode 等** で開く
2. `Ctrl+F` で **`ICAL_WORKER_URL`** を検索（1 箇所だけ）
3. プレースホルダ行を発見：
   ```js
   const ICAL_WORKER_URL = ''; // <- 例: 'https://family-map-cal.examrx79-bd03.workers.dev'
   ```
4. ステップ 1 でメモした Worker URL を **シングルクォート内に貼り付け** て保存：
   ```js
   const ICAL_WORKER_URL = 'https://family-map-cal.examrx79-bd03.workers.dev';
   ```
5. PowerShell or Git Bash で commit & push：
   ```
   cd C:\AppDev\family-map
   git add family-map/index.html
   git commit -m "chore(family-map): wire ICAL_WORKER_URL"
   git push origin main
   ```
6. GitHub Pages の自動デプロイが 1 〜 2 分で完了

---

## ステップ 4：iPhone カレンダーアプリで公開 URL を取得

1. iPhone の **カレンダー** アプリを開く
2. 画面下中央の **「カレンダー」** ボタン（横線が3本のアイコン）をタップ
3. 表示したいカレンダー名の右側にある **(i)** ボタンをタップ
4. 下にスクロールして **「公開カレンダー」** トグルを **ON**
5. すぐ下に表示される URL（`webcal://p**-caldav.icloud.com/published/2/...`）の **「共有」** をタップ
6. **「コピー」** をタップ → メモアプリ等にペースト

> 「公開カレンダー」を ON にすると、URL を知っている人なら誰でもそのカレンダーの予定を**読み取り**できます（編集はできません）。誤って SNS 等に投稿しないように注意。

---

## ステップ 5：family-map に iCloud カレンダーを追加

1. iPhone Safari で family-map を開く（PWA でも OK）
2. **キャッシュ無効化**：iPhone「設定」→「Safari」→「履歴と Web サイトデータを消去」（PWA はホーム画面に追加したまま、削除しないこと）
3. family-map を起動 → 右上の **歯車（設定）** をタップ
4. **「カレンダー連携」** セクションまでスクロール → **「＋ iCloud カレンダーを追加」** をタップ
5. 表示されたモーダルに以下を入力：
   - **URL**：ステップ 4 でコピーした `webcal://...`（または `https://...`）
   - **表示名**：例「家族の予定」「ぐっち」「妻」など、何でもOK
   - **色**：12 色から選択（家族で被らない色推奨）
6. **「追加」** をタップ → 自動で初回同期が走り、最終同期時刻が表示される
7. **スケジュールタブ** に切り替えて、iCloud の予定が選択した色で表示されることを確認

---

## 仕組み・運用メモ

- **同期間隔**：30 分ごとに自動同期（PWA / Safari がフォアグラウンド表示中のみ）。手動同期は設定モーダルの **「今すぐ同期」** ボタン。
- **読み取り専用**：iCloud 由来の予定は family-map から編集・削除できません。詳細を開いても「外部カレンダー由来」と表示され、編集ボタンは非表示になります。
- **削除されたら**：iCloud 側で削除された予定は、次回同期で family-map からも消えます（MVP では削除同期 ON 固定）。
- **複数カレンダー**：MVP では 1 ソースだけ対応です。複数追加したい場合は P8'-B 本実装をお待ちください。
- **繰り返し予定**：MVP では「最初の 1 件だけ」表示されます（毎週繰り返し等の展開は P8'-B 本実装で）。

---

## トラブルシュート

| 症状 | 確認・対処 |
|---|---|
| 追加ボタンを押しても何も起きない | index.html の `ICAL_WORKER_URL` が空のまま、または Cloudflare Worker URL が間違っている可能性。ステップ 3 を再確認 |
| 「ICS が取得できませんでした」エラー | iCloud 側で「公開カレンダー」が OFF になっている / URL が古い。ステップ 4 をやり直して新しい URL で**削除→再追加** |
| `permission-denied` エラー | Firestore ルールに `calendarSources` の match が無い。ステップ 2 を再確認 |
| Cloudflare Worker が 403 を返す | Worker コード冒頭の `ALLOWED_ORIGIN` が `https://examrx79bd03-star.github.io` 以外になっている可能性。Cloudflare ダッシュボードで Worker コードを開いて確認 |
| 同期したのに新しい予定が出ない | iCloud 公開カレンダーは Apple 側でキャッシュされるため、即時反映されない場合がある（5〜15分待つ）。「今すぐ同期」を 2〜3 回試す |
| 同じ予定が 2 つ表示される | 外部由来 event は `externalEventId`（ICS の UID）で upsert される設計のため通常起きない。発生したら family-map 側で「削除」→ 再同期で解消（外部側の予定は無事） |
