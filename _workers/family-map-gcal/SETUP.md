# Google カレンダー連携（ほぼリアルタイム同期）セットアップ

やることは大きく3つ。**上から順に、飛ばさずに**やってください。
所要 30〜40分くらい。途中で分からなくなったら、その時点の画面を Claude に見せれば続きから案内できます。

---

## なぜこの作業が必要なのか（先に読んでください）

いま使っている「URL を貼り付けて取り込む」方式は、Google が公開しているカレンダーの**ファイルを定期的に取りに行く**やり方です。このファイルを Google が新しくする間隔が数時間あるため、**こちらが何をしても数時間ずれます**。

そこで「Google 側で予定が変わった**瞬間に**、Google からこちらへ知らせてもらう」方式に切り替えます。そのために **Google に「このアプリを信用します」と登録する作業**が必要で、それがこの手順です。

---

## ⚠ 最重要：「公開」を必ずやること

手順2-6の「**アプリを公開**」を飛ばすと、**7日後に勝手に連携が切れます。**

これは推測ではなく、**このPCの別ツール（DailyDigest・WorkLogger）で実際に起きた事故**です（2026-06-12 に判明、原因は同じ「テスト中のまま公開していなかった」）。7日ごとに連携し直すハメになるので、必ず実施してください。

---

# 手順1：Google 側の準備

## 1-1. プロジェクトを開く

1. https://console.cloud.google.com/ を開く（`examrx79.bd03@gmail.com` でログイン）
2. 画面上部のプロジェクト選択から **`family-map-c5110`** を選ぶ
   - これは family-map が既に使っている Firebase のプロジェクトです。新規作成は不要。

## 1-2. カレンダーAPI を有効にする

1. 左メニュー「**APIとサービス**」→「**ライブラリ**」
2. 検索欄に `Google Calendar API`
3. 出てきたものを開いて「**有効にする**」

## 1-3. 同意画面を作る

1. 左メニュー「**APIとサービス**」→「**OAuth 同意画面**」
2. User Type は「**外部**」を選んで「作成」
3. 入力するのは3つだけ（他は空でOK）
   - アプリ名：`family-map`
   - ユーザーサポートメール：`examrx79.bd03@gmail.com`
   - デベロッパーの連絡先情報：`examrx79.bd03@gmail.com`
4. 「保存して次へ」
5. **スコープ**の画面 →「スコープを追加または削除」→ 検索して以下にチェック
   - `.../auth/calendar.readonly`（Googleカレンダーの閲覧）
   - 「更新」→「保存して次へ」
6. テストユーザーの画面はそのまま「保存して次へ」→「ダッシュボードに戻る」

## 1-4. ★アプリを公開する（ここが最重要）

1. 「OAuth 同意画面」のトップに戻る
2. 「**アプリを公開**」ボタンを押す → 確認ダイアログで「確認」
3. 公開ステータスが「**本番環境**」になっていることを確認

> 「確認が必要です」的な警告が出ますが、**そのままでOK**です。家族数人で使うだけなら審査は不要で、連携時に「このアプリは確認されていません」という警告画面が出るだけです（後述の手順3で「詳細」→「移動」を押せば進めます）。
>
> **審査を受けないと使えない、ではありません。** 公開しないと7日で切れる、というのがここでの本題です。

## 1-5. 認証情報（IDとパスワードのようなもの）を作る

1. 左メニュー「**APIとサービス**」→「**認証情報**」
2. 上の「**＋認証情報を作成**」→「**OAuth クライアント ID**」
3. アプリケーションの種類：「**ウェブアプリケーション**」
4. 名前：`family-map-gcal`
5. 「**承認済みのリダイレクト URI**」→「URI を追加」して、次を**一字一句そのまま**貼る：

```
https://family-map-gcal.examrx79-bd03.workers.dev/oauth/callback
```

6. 「作成」
7. 出てくる **クライアントID** と **クライアントシークレット** を、メモ帳などに控える
   - あとで手順2-3で使います
   - **このシークレットは絶対に人に見せない／GitHubに貼らない**でください

---

# 手順2：Worker を動かす

`C:\AppDev\family-map\_workers\family-map-gcal\` フォルダで作業します。

## 2-1. Cloudflare にログイン

PowerShell を開いて：

```bash
cd C:\AppDev\family-map\_workers\family-map-gcal
npx wrangler login
```

ブラウザが開くので、Cloudflare のアカウントで許可します。

## 2-2. Firebase の鍵を用意する

family-map-notifier で使っているものと**同じ鍵**が使えます。まだ手元に無い場合：

1. https://console.firebase.google.com/ → プロジェクト `family-map-c5110`
2. 歯車 →「プロジェクトの設定」→「**サービス アカウント**」タブ
3. 「**新しい秘密鍵の生成**」→ ダウンロードされる JSON ファイルを開いて、**中身を全部コピー**

## 2-3. 3つの秘密情報を登録する

1つずつ実行します。実行するたびに「値を入力してください」と聞かれるので、貼り付けて Enter。

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
```
→ 手順1-5で控えた**クライアントID**を貼る

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```
→ 手順1-5で控えた**クライアントシークレット**を貼る

```bash
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
```
→ 手順2-2の **JSON の中身を丸ごと**貼る（1行になっていてOK）

## 2-4. 公開する

```bash
npx wrangler deploy
```

最後に `https://family-map-gcal.examrx79-bd03.workers.dev` のような URL が表示されます。

**この URL が手順1-5で登録したものと違っていたら、手順1-5に戻って URL を修正してください。**（違うと連携時にエラーになります）

## 2-5. 動いているか確認

ブラウザで次を開いて、`{"connections":[]}` と表示されればOK：

```
https://family-map-gcal.examrx79-bd03.workers.dev/status?familyId=VNWMGUF94G
```

---

# 手順3：iPhone で連携する

1. family-map を開く（ビルドが `2026-08-09.2` 以降であること。設定→デバッグ情報で確認）
2. 設定（⚙）→ 詳細設定 → 「カレンダー連携」
3. 「**🔗 Google カレンダーと連携（自動同期）**」をタップ
4. Google のログイン画面 → 使いたい Google アカウントを選ぶ
5. 「**このアプリは Google で確認されていません**」と出たら
   - 「**詳細**」→「**family-map（安全ではないページ）に移動**」
   - 手順1-4で説明したとおり、審査を受けていないだけで問題ありません
6. 「カレンダーの表示」を**許可**
7. 「✓ Google カレンダーを連携しました」と出れば完了
8. family-map に戻ってスケジュールタブを開く

以降、Google カレンダー側で予定を追加・変更すると、**数秒〜1分ほど**で family-map に反映されます。

---

## うまくいかないとき

**連携ボタンが出てこない**
→ ビルドが古いです。iPhone でオンライン起動して、設定→デバッグ情報のビルドを確認。

**「更新用トークンが返りませんでした」と出る**
→ 既に一度連携したアカウントで、Google が再発行を省略しています。
Google アカウント → セキュリティ → 「サードパーティ アプリの接続」→ family-map を削除してから、もう一度連携してください。

**連携したのに予定が出てこない**
→ まず現状を確認：
```
https://family-map-gcal.examrx79-bd03.workers.dev/status?familyId=VNWMGUF94G
```
- `pushActive: false` → 通知チャンネルが張れていません。`lastError` を見てください
- `lastError` に `invalid_grant` → 手順1-4の「公開」が漏れています（7日で切れる例のやつ）

→ 手動で同期を試す：
```
https://family-map-gcal.examrx79-bd03.workers.dev/sync-now?familyId=VNWMGUF94G
```

**しばらく使っていたら止まった**
→ `status` の `lastError` を確認。`invalid_grant` なら手順1-4の公開状態を再確認してください。

---

## 仕組みのメモ（Claude 向け）

- 秘密トークンは `families/{familyId}/gcalConnections/{connId}` に保存。**このコレクションは firestore.rules に意図的に載せていない**ため、ルールが列挙方式（catch-all 無し）である以上どのクライアントからも読めず、サービスアカウントを持つ Worker だけが触れる。KV 名前空間の用意が不要。
- 取り込んだ予定は既存の外部カレンダーと同じ形（`sourceId` / `externalEventId` / `externalSourceProvider:'gcal'` / `calendarId:null` / `visibility:'shared'`）で `events` に書くので、**描画側は無改造**で表示される。
- クライアント側は `provider === 'gcal'` のソースを `syncCalendarSource` と `startCalendarAutoSync` から除外している。除外しないと「ICS が空 → 全件削除」が走って Worker の書き込みを消す。
- 監視チャンネルは Google 側で最長1週間。cron（15分毎）が期限36時間前から張り直す。`syncToken` が失効（HTTP 410）したら自動で全件再取得。
- `FAMILY_IDS` は wrangler.toml の vars。家族を増やしたら追記して再デプロイ。
