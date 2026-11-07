# Firestore セキュリティルール（現行の正）

Firebase コンソール → Firestore Database →「ルール」タブに貼る全文。アプリと 2 つの Worker（通知・Google 連携）はこのルールを前提に作ってある。

- このファイルが**いま貼るべき全文**。2026-08-11 の「メンバーだけ」化の経緯・事前チェック・それ以前のルールは、ローカル専用の `_scripts/firestore-rules-membership.md`（家族の個人名を含むので公開リポジトリには置いていない）。
- ルールに家族コードは出てこない（`{familyId}` で全家族に同じ判定）。公開して困る内容は含まない。

## 2026-11-07 の変更：外部カレンダーの「自分だけ」を doc ごと守る

**何が問題だったか**：iCloud / Google の外部カレンダーを「自分だけ🔒」にしても、守られていたのは**予定**だけで、カレンダーの設定 doc（`calendarSources`）は家族の誰でも読み書きできた。この doc には

- iCloud / Google の**購読 URL**（＝そのカレンダー全体を、アプリの外からでも読める合鍵）
- Google 連携の**メールアドレス**

が入っている。つまり「自分だけ」にした仕事のカレンダーでも、家族の他の人が URL を取り出せば中身を全部見られた。他の人が設定を書き換える（共有に戻す・消す）こともできた。

**どう変えたか**：`calendarSources` に、予定（`events`）・カレンダー（`calendars`）と**同じ判定**を入れる。

- 家族共有のもの → 家族全員が読み書きできる（今までどおり）
- 自分だけのもの → **持ち主（`ownerUid`）しか読めない・書けない**

あわせてアプリと Worker も直した（アプリ 2026-11-07.2）。

- アプリ：カレンダー一覧を「家族共有」と「自分の自分だけ」の 2 本で読む（ルールはフィルタではないので、まとめて読むとルール公開後に丸ごと断られる）。追加の画面で最初から「自分だけ」を選べる。端末に残っていた他の人の自分だけカレンダーの写し（URL 入り）は消す。
- 通知 Worker：朝の「今日の予定」と予定の通知を、受け取る人ごとに絞る（以前は他の人の自分だけの予定のタイトルも全員に届いていた）。
- Google 連携 Worker：連携し直しで「自分だけ」と持ち主が消えないように。他の人の自分だけカレンダーの連携を切れない・一覧に出さない。

### 貼り替えの手順（順番が大事）

1. **新しい版のアプリを、自分の端末で 1 回開く**（設定 → デバッグ情報 の「ビルド」が `2026-11-07.2` 以降なら新しい版）。
   開いた時点で、古い外部カレンダーに「公開範囲」の欄が自動で書き足される。**これより先にルールを貼ると、古いカレンダーが一覧から消える**（その場合は下の「元に戻す」を貼り、アプリを開いてから貼り直せば直る）。
2. **コンソールで確認**：Firestore Database → データ → `families` →（家族コード）→ `calendarSources` を開き、
   - どの doc にも `visibility` がある（`shared` か `private`）
   - `private` の doc は `ownerUid` が空でない

   `private` なのに `ownerUid` が空の doc があったら、それは以前の不具合で「誰にも読めない」状態になっている。Google 連携のカレンダーなら、アプリの設定から**もう一度「Google カレンダーと連携」**すれば持ち主が入って直る。iCloud のものなら Claude に相談。
3. 「ルール」タブで、表示中のルールを**下の全文でまるごと置き換え**て「公開」。
4. **確認**：アプリを開き直して、iCloud / Google のカレンダーが今までどおりスケジュールに出る。家族の他の端末でも同じ（古い版のままの端末は、開き直すと新しい版になって直る）。

## 貼り付け全文（2026-11-07 版）

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /families/{familyId} {

      // この家族のメンバーか（members に自分の doc があるか）
      function isMember() {
        return request.auth != null
          && exists(/databases/$(database)/documents/families/$(familyId)/members/$(request.auth.uid));
      }

      // いま新規参加を受け付けているか（doc が無ければ受付停止＝既定で閉じている）
      function joinOpen() {
        return exists(/databases/$(database)/documents/families/$(familyId)/familyConfig/joinPolicy)
          && get(/databases/$(database)/documents/families/$(familyId)/familyConfig/joinPolicy)
               .data.get('open', false) == true;
      }

      // 地図ピン
      match /pins/{pinId} {
        allow read, write: if isMember();
      }

      // ラベルなどの家族設定＋新着フィード（familyConfig/activityFeed）
      match /familyConfig/{docId} {
        allow read, write: if isMember();
      }

      // メンバープロフィール
      match /members/{memberId} {
        allow read: if isMember();
        allow update, delete: if isMember();
        // 新規参加：自分の doc だけ、かつ「受付中」のときだけ作れる
        allow create: if request.auth != null
          && request.auth.uid == memberId
          && joinOpen();
      }

      // 外部カレンダー連携（iCloud / Google）。2026-11-07：予定・カレンダーと同じ
      //   「共有＝家族全員 / 自分だけ＝持ち主のみ」を doc ごと効かせる。
      //   doc には購読 URL（そのカレンダー全体を読める合鍵）と Google のアドレスが入るため。
      match /calendarSources/{sourceId} {
        allow read: if isMember()
          && (resource == null
              || resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid);
        allow create: if isMember()
          && (request.resource.data.get('visibility', 'shared') == 'shared'
              || request.resource.data.get('ownerUid', '') == request.auth.uid);
        allow update: if isMember()
          && (resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid)
          && (request.resource.data.get('visibility', 'shared') == 'shared'
              || request.resource.data.get('ownerUid', '') == request.auth.uid);
        allow delete: if isMember()
          && (resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid);
      }

      // ★新着（活動フィード）。2026-08-11 追加。
      //   予定と同じ「共有＝全員 / 非公開＝本人のみ」を、サーバー側で効かせる。
      //   これを貼るまで新着の非公開分は動かない（アプリ側は共有分だけで動く）。
      match /activity/{entryId} {
        allow read: if isMember()
          && (resource == null
              || resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid);
        allow create: if isMember()
          && (request.resource.data.get('visibility', 'shared') == 'shared'
              || request.resource.data.get('ownerUid', '') == request.auth.uid);
        allow update, delete: if isMember()
          && (resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid);
      }

      // カレンダー本体（共有＝家族全員 / 非公開＝本人のみ）
      match /calendars/{calId} {
        allow read: if isMember()
          && (resource == null
              || resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid);
        allow create: if isMember()
          && (request.resource.data.get('visibility', 'shared') == 'shared'
              || request.resource.data.get('ownerUid', '') == request.auth.uid);
        allow update: if isMember()
          && (resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid)
          && (request.resource.data.get('visibility', 'shared') == 'shared'
              || request.resource.data.get('ownerUid', '') == request.auth.uid);
        allow delete: if isMember()
          && (resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid);
      }

      // 予定／メモ（共有＝家族全員 / 非公開＝本人のみ）
      match /events/{eventId} {
        allow read: if isMember()
          && (resource == null
              || resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid);
        allow create: if isMember()
          && (request.resource.data.get('visibility', 'shared') == 'shared'
              || request.resource.data.get('ownerUid', '') == request.auth.uid);
        allow update: if isMember()
          && (resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid)
          && (request.resource.data.get('visibility', 'shared') == 'shared'
              || request.resource.data.get('ownerUid', '') == request.auth.uid);
        allow delete: if isMember()
          && (resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid);
      }

      // ★gcalConnections は意図的にここへ書かない（＝全クライアント拒否のまま）。
      //   Google の refresh token 置き場で、サービスアカウントを持つ Worker だけが触る。

    }
  }
}
```

## 元に戻す（2026-08-11 版の全文）

今回の変更だけを戻したいときはこれを貼って「公開」。アプリ（2026-11-07.2）はどちらのルールでも動く。

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /families/{familyId} {

      // この家族のメンバーか（members に自分の doc があるか）
      function isMember() {
        return request.auth != null
          && exists(/databases/$(database)/documents/families/$(familyId)/members/$(request.auth.uid));
      }

      // いま新規参加を受け付けているか（doc が無ければ受付停止＝既定で閉じている）
      function joinOpen() {
        return exists(/databases/$(database)/documents/families/$(familyId)/familyConfig/joinPolicy)
          && get(/databases/$(database)/documents/families/$(familyId)/familyConfig/joinPolicy)
               .data.get('open', false) == true;
      }

      // 地図ピン
      match /pins/{pinId} {
        allow read, write: if isMember();
      }

      // ラベルなどの家族設定＋新着フィード（familyConfig/activityFeed）
      match /familyConfig/{docId} {
        allow read, write: if isMember();
      }

      // メンバープロフィール
      match /members/{memberId} {
        allow read: if isMember();
        allow update, delete: if isMember();
        // 新規参加：自分の doc だけ、かつ「受付中」のときだけ作れる
        allow create: if request.auth != null
          && request.auth.uid == memberId
          && joinOpen();
      }

      // 外部カレンダー連携（iCloud / Google の ICS）
      match /calendarSources/{sourceId} {
        allow read, write: if isMember();
      }

      // ★新着（活動フィード）。2026-08-11 追加。
      //   予定と同じ「共有＝全員 / 非公開＝本人のみ」を、サーバー側で効かせる。
      //   これを貼るまで新着の非公開分は動かない（アプリ側は共有分だけで動く）。
      match /activity/{entryId} {
        allow read: if isMember()
          && (resource == null
              || resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid);
        allow create: if isMember()
          && (request.resource.data.get('visibility', 'shared') == 'shared'
              || request.resource.data.get('ownerUid', '') == request.auth.uid);
        allow update, delete: if isMember()
          && (resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid);
      }

      // カレンダー本体（共有＝家族全員 / 非公開＝本人のみ）
      match /calendars/{calId} {
        allow read: if isMember()
          && (resource == null
              || resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid);
        allow create: if isMember()
          && (request.resource.data.get('visibility', 'shared') == 'shared'
              || request.resource.data.get('ownerUid', '') == request.auth.uid);
        allow update: if isMember()
          && (resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid)
          && (request.resource.data.get('visibility', 'shared') == 'shared'
              || request.resource.data.get('ownerUid', '') == request.auth.uid);
        allow delete: if isMember()
          && (resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid);
      }

      // 予定／メモ（共有＝家族全員 / 非公開＝本人のみ）
      match /events/{eventId} {
        allow read: if isMember()
          && (resource == null
              || resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid);
        allow create: if isMember()
          && (request.resource.data.get('visibility', 'shared') == 'shared'
              || request.resource.data.get('ownerUid', '') == request.auth.uid);
        allow update: if isMember()
          && (resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid)
          && (request.resource.data.get('visibility', 'shared') == 'shared'
              || request.resource.data.get('ownerUid', '') == request.auth.uid);
        allow delete: if isMember()
          && (resource.data.get('visibility', 'shared') == 'shared'
              || resource.data.get('ownerUid', '') == request.auth.uid);
      }

      // ★gcalConnections は意図的にここへ書かない（＝全クライアント拒否のまま）。
      //   Google の refresh token 置き場で、サービスアカウントを持つ Worker だけが触る。

    }
  }
}
```

## 技術メモ（Claude 向け）

- ルールは**フィルタではない**：`calendarSources` 全体への 1 本のリスナーは、読めない doc が 1 つでも混ざりうるだけで丸ごと拒否される。アプリは `subscribeCalendarSources()` で `visibility == 'shared'` と `visibility == 'private' && ownerUid == 自分` の 2 本に分け、2 本の答えから一覧を毎回作り直す（差分で足すと、旧版が端末に保存した他人の自分だけカレンダーがいつまでも消えないため）。
- `visibility` の欄が無い doc（2026-08-11 より前に追加して以後編集していないもの、Google 連携 Worker が作ったもの）は**どちらの問い合わせにも引っかからない**。ルール上は「無い＝共有」だが、アプリが読めなくなる。`backfillCalendarSourceVisibility()` が `visibility: 'shared'` を書き足す——今のルールなら全員分（コレクション全体を読める）、新ルールでは自分が持ち主のものだけ。だから手順 1 → 3 の順。
- Worker はサービスアカウントで**ルールを素通りする**ので、同じ判定を自前で持っている：通知 `canSeeEvent()`、Google 連携 `sourceFieldsVisibleTo()`。ルールを変えたら、この 2 つも見直す（2026-11-07 にルールの外が取り残されていたのが今回の発端）。
- 2026-11-07 の時点で `calendarSources` の判定は `calendars` ブロックと文字単位で同じ（match のパスだけ違う）。
