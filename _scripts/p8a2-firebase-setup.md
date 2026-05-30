# P8'-A-2 Firebase Console / Authorized domains セットアップ手順

family-map を匿名認証 + iOS PWA の構造的問題（SHARED.md § 12）から根治するため、
本番 Google 認証マイグレ（P8'-A-2）を投入する前に Firebase Console と
OAuth 設定で以下の手順を実施する必要があります。

**実施タイミング**：index.html のコード変更を `git commit` した直後、
GitHub Pages に `git push` する **前** に必ず終わらせてください。

順序が逆だと、ぐっち夫妻が公開された新コードを開いた瞬間に
"unauthorized-domain" / "configuration-not-found" エラーで詰みます。

---

## 1. Firebase Authentication で Google を有効化

1. https://console.firebase.google.com/ にログイン（`admin@pictoria.co.jp`）
2. プロジェクト **family-map-c5110** を選択
3. 左サイドバー **「Authentication」** をクリック
4. 上部タブ **「Sign-in method」** を開く
5. **「Add new provider」** または既存リストから **「Google」** を選択
6. 右のスイッチを **「Enable」** に
7. **「Project support email」** に `admin@pictoria.co.jp` を選択
8. **「Save」**

完了後、Sign-in providers のリストに以下が並んでいることを確認：
- ✅ **Anonymous**（既存。**消さない**）
- ✅ **Google**（新規追加）

→ 匿名と Google の両方を有効にしておくことで、移行期間中も既存の匿名ユーザーが
   弾かれない（ただし新コードは Google 必須でブロックする）。

---

## 2. Authorized domains の確認

1. **Authentication** → **Settings** → **Authorized domains**
2. 以下のドメインがすべてリストにあることを確認：
   - `localhost`
   - `family-map-c5110.firebaseapp.com`
   - `examrx79bd03-star.github.io`（GitHub Pages）

`examrx79bd03-star.github.io` が無ければ **「Add domain」** で追加。
これが無いと `auth/unauthorized-domain` で詰みます。

---

## 3. OAuth 同意画面（GCP 側）の設定確認

Firebase で Google を有効化すると裏で GCP プロジェクト `family-map-c5110` の
OAuth 2.0 クライアントが自動作成されます。同意画面（OAuth consent screen）の
設定をこちらで確認・調整します。

1. https://console.cloud.google.com/ で `family-map-c5110` プロジェクトを選択
2. **「APIs & Services」** → **「OAuth consent screen」**
3. User Type は **External** のままで OK（個人 Google アカウントを使うため）
4. **App information**：
   - App name：`family-map` または `家族の思い出`（任意）
   - User support email：`admin@pictoria.co.jp`
   - Developer contact information：`admin@pictoria.co.jp`
5. **Authorized domains**：`firebaseapp.com` だけで OK（Firebase 側で承認済みドメインを管理）
6. **Scopes**：デフォルト（email / profile / openid）のみで OK。追加スコープ不要
7. **Test users**（publishing status が "Testing" の場合）：
   - ぐっち：`admin@pictoria.co.jp`
   - 妻：（妻が使う Google アカウント。後日追記）
   - その他テストで使う Google アカウント

**publishing status について**：
- `Testing` のままで OK（公開予定なし、夫婦＋娘の私用）
- ただし testing モードでは **test users に追加した Google アカウントしかログインできない**
- 妻の Google アカウントを忘れずに test users へ追加すること
- 上限 100 アカウントまで（家族用途では充分）

---

## 4. Firestore セキュリティルール更新

現状のセキュリティルール（`request.auth != null` だけ）は anonymous でも Google でも
通るため、**コード変更だけなら厳密にはルール変更不要**です。ただし将来 Google 専用
にしたいタイミングが来たら以下のように `sign_in_provider` でフィルタできるよう
記録しておきます。

### 4-A. 移行期間中（推奨。anonymous も Google も両方受け入れる）

現状のルールを **そのまま維持**：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /families/{familyId} {
      match /pins/{pinId}         { allow read, write: if request.auth != null; }
      match /events/{eventId}     { allow read, write: if request.auth != null; }
      match /familyConfig/{docId} { allow read, write: if request.auth != null; }
      match /members/{memberId}   { allow read, write: if request.auth != null; }
    }
  }
}
```

→ Google sign-in を有効化した瞬間でも既存匿名ユーザーは弾かれない。
   index.html 側で Google ログインを強制するため、ルールでブロックしなくても
   実質 anonymous で書き込みは発生しなくなる。

### 4-B. 将来（Google 専用にする時、参考メモ）

夫婦が Google に完全移行したと確認できたら、以下のように差し替えて anonymous を弾く：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /families/{familyId} {
      function isGoogleUser() {
        return request.auth != null
            && request.auth.token.firebase.sign_in_provider == 'google.com';
      }
      match /pins/{pinId}         { allow read, write: if isGoogleUser(); }
      match /events/{eventId}     { allow read, write: if isGoogleUser(); }
      match /familyConfig/{docId} { allow read, write: if isGoogleUser(); }
      match /members/{memberId}   { allow read, write: if isGoogleUser(); }
    }
  }
}
```

→ P8'-A-2 投入直後にこれにすると、まだログインしていない妻が弾かれて
   家族コード接続が落ちるので、本投入の段階では **やらない**。
   妻 Google ログイン完了後の別タイミングで差し替えること。

---

## 5. authDomain の確認（コード側）

`family-map/index.html` の Firebase 設定で `authDomain: "family-map-c5110.firebaseapp.com"`
となっていることを確認（既存設定。変更不要）。

カスタムドメイン（`examrx79bd03-star.github.io`）を `authDomain` に使うと
クロスドメイン Cookie の制約で OAuth redirect が壊れることがあるため、
標準の `*.firebaseapp.com` のままにしておくこと。

---

## 6. 投入順序（チェックリスト）

1. [ ] 上記 §1〜§4-A をすべて完了
2. [ ] `_scripts/migrate-uids.mjs` のパラメータが新 uid（Btk15JJ…）に書き換わっていることを確認
3. [ ] `index.html` の P8'-A-2 実装を commit（push はまだ）
4. [ ] GitHub Pages にデプロイされる前に、ローカルで Safari `http-server` 等で動作確認可能ならする
5. [ ] ぐっちが本番 push 承認 → `git push origin main`
6. [ ] GitHub Pages 自動デプロイ（1〜2 分）
7. [ ] iPhone Safari で開く → Google ログインモーダル表示確認 → ログイン →
       migration overlay → トースト「過去データを引き継ぎました」 → 通常起動
8. [ ] 設定モーダル → デバッグ情報を開いて以下を確認：
   - `authProvider: google.com`
   - `legacyUid 一致: MISMATCH (旧 uid)` ← 期待通り
   - `uidMigratedAt:` に直近のタイムスタンプ
9. [ ] スケジュールタブ・メモタブ・地図タブで旧予定・旧ピンの「作成者」が
       自分（プロフィール上の表示名）で出ていることを確認
10. [ ] 妻に「次に開いたら Google ログイン画面が出ます。普段使ってる Google
        アカウントでログインしてください」と連絡

---

## 7. ロールバック手順（万一）

万一 Google 認証が動かない / マイグレで Firestore のデータがおかしくなった場合：

1. `git revert <commit-hash>` で index.html を元に戻して `git push`
   → GitHub Pages がロールバック版を配信
2. Firebase Authentication → Sign-in method → Google を **Disable**
   → 既存匿名ユーザーが引き続き通常動作
3. Firestore のデータが破損していたら `_scripts/migrate-uids.mjs` の逆方向
   （NEW_UID / OLD_UIDS を入れ替え）で巻き戻し可能

---

## 関連ドキュメント

- `family-map/SPEC_SCHEDULE.md` § G の P8'-A-2 — 詳細設計
- `family-map/CLAUDE.md` の更新履歴 2026-05-30 — このセッションでの実装記録
- `C:\AppDev\SHARED.md` § 12 — Firebase 匿名認証 + iOS PWA の構造的問題（背景）
- `_scripts/migrate-uids.mjs` — Service Account 経由のバッチマイグレ復旧スクリプト
  （client-side マイグレと併用可能、書き換え漏れの掃除用）
