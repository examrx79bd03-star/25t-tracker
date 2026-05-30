# family-map スケジュール／メモ機能 仕様書

**作成日**: 2026-05-25（旧版を全面改訂、新方針）
**ステータス**: **🟢 全 Phase 完了 + P6' UX 修正 + P6.1'/P6.2'/P6.3'/P6.4'/P6.5' リファイン + P7' プロフィール基盤 + P7.1' バー表示ロールバック + P7.2' 5 件追加修正 + P7.3' picker z-index 修正 + memo toggle 完全非表示（local のみ）** — P1'-P5' は push 済（commit `cb3e0e1`）、P6.3' は push 済（commit `35adf22`）、それ以降は local のみ・未 push
**位置付け**: family-map に TimeTree 風スケジューラー＋共有メモ機能を **並列機能** として追加する大型改修の総合設計書。各 Phase の commit 群はこの仕様に従って実装する。

---

## A. 目的・スコープ

### A-1. なぜ「家族の総合ツール」化するか
- 当初 family-map は「行った／行きたい／思い出」を地図に記録する単機能アプリだった
- 家族での使用が定着するにつれ、「予定」「買い物リスト」「家族メモ」も同じツールで扱いたい需要が出てきた
- LINE / TimeTree / Apple リマインダーなどを家族間で並行運用するのは煩雑なので、**1 つの URL（PWA）に集約**したい
- 今回の改修は family-map を「家族の地図ツール」から「**家族の総合ツール**」へ位置付けし直すもの

### A-2. 「並列機能」設計の根拠（前 P1 廃棄の理由）
- 前 P1（commit `c412449`、現 tag `p1-discarded-2026-05-25`）では「一覧 view 内の view-tabs に `スケジュール` サブタブを追加する」設計だった
- ユーザーレビュー：地図メイン UI と並列レベルの機能なのに、一覧の中の更にサブタブにすると、目的の機能までのタップ階層が深くなり、入口が見えづらい
- 方針変更：**画面最上位に水平 3 タブ `[familymap] [スケジュール] [メモ]` を置き、3 つを並列のワールドとして扱う**
- 「このURL を叩くと開けるツール ＝ 家族の総合ツール」を強調

### A-3. 参考資料
- TimeTree 解説資料（参考のみ、データモデル知見）：`C:\Users\commo\Downloads\compass_artifact_wf-ef604dd0-f634-4d5a-9ce0-6b25b549a4b4_text_markdown.md`
- TimeTree UI スクリーンショット 7 枚（ユーザー提供、メインエージェントが § E に書き起こし済み）
- 配色・タイポ：本 family-map 既存のもの（25T 由来の北欧系高明度低彩度）を踏襲。**TimeTree の緑基調はそのまま使わない**

---

## B. ナビゲーション構造（新方針）

### B-1. 全体構造
```
画面最上位（safe-area 直下、sticky）
+-------------------------------------+
|  [familymap]  [スケジュール]  [メモ]  |  ← 上部 3 タブ（top-tabs）
+-------------------------------------+
|  〇 FAMILY MAP             ⚙  ----  |  ← 既存ヘッダー（全タブ共通）
+-------------------------------------+
|                                     |
|  選択中のタブのコンテンツが表示       |
|                                     |
|  - familymap: 既存全 UI             |
|  - スケジュール: マンスリーカレンダー |
|  - メモ: カード一覧                  |
|                                     |
+-------------------------------------+
```

### B-2. ルール
- 3 タブはトグル切替（同時に開けるのは 1 つ）
- 選択状態を localStorage に永続化（キー `family-map.activeTopTab`、値 `'familymap' | 'schedule' | 'memo'`）
- デフォルト＝`'familymap'`
- 上部 3 タブ自体は等幅、タップしやすいサイズ（タブ高さ約 44px、フォント 13px）
- アクティブタブはアクセントカラー（既存の `--accent` テラコッタ）下線＋テキスト濃色
- safe-area-inset-top に対応（`padding-top` で iPhone のノッチ／Dynamic Island 領域を避ける）

### B-3. 既存ヘッダーの位置付け
- ヘッダー（タイトル `FAMILY MAP`、クラウドステータス●、歯車設定ボタン、日付表示）は **全タブ共通**として 3 タブの下に配置
- 設定モーダルから「家族コード」「データ管理」を触ることは どのタブからも必要なので、ヘッダーが見えていてよい
- 既存「FAMILY MAP」ブランディングはタブが追加されても残す

### B-4. listView（一覧オーバーレイ）の挙動
- listView は既存設計通り `position: fixed; inset: 0;` でフルスクリーン被せる overlay
- familymap タブの右下 FAB「一覧」を押した時のみ開く
- schedule / memo タブの最中は FAB が見えないので listView も開かない（呼び出し導線がない）
- listView 内には上部 3 タブを表示しない（モーダル的挙動なので閉じてから別タブに切替する仕様）

### B-5. その他モーダル
- Edit Modal / Family Setup Modal / Settings Modal / Bulk Status Modal はトップレベル DOM のまま
- これらは family-map（地図機能）由来であり、schedule/memo タブのレイアウトに干渉しない（z-index で重ねるだけ）

---

## C. データモデル（TimeTree 流の単一エンティティ）

### C-1. 設計判断
- 旧 P1 では `events/`（予定）と `memos/`（メモ）を別コレクションで持つ案だったが廃棄
- 新方針：**TimeTree 流の単一エンティティモデル**。1 つの `events/` コレクションに予定もメモも入れ、`isMemo` フラグで切り替える
- メリット：
  - 「予定」⇔「メモ」の昇降格が単純な `isMemo` トグルだけで実現できる（データ移動不要）
  - 検索・履歴・コメント機能を一本化できる
  - フィルタ条件だけタブで切替

### C-2. Firestore コレクション

#### `families/{familyId}/pins/{pinId}`（既存、無変更）
- 地図ピン用、現行スキーマ維持

#### `families/{familyId}/events/{eventId}`（新規）
```js
{
  title:       string,                  // 必須、最大 60 文字
  startAt:     number | null,           // epoch ms、null ならメモ扱い
  endAt:       number | null,           // epoch ms、startAt より後
  allDay:      boolean,                 // 終日フラグ
  isMemo:      boolean,                 // true ならメモタブに表示、false ならスケジュールタブに表示
  labelId:     string | null,           // familyConfig/labels の id を参照、null なら無ラベル
  body:        string,                  // 本文／メモ詳細、最大 2000 文字
  checklist:   [                        // チェックリスト型（任意）
    { id: string, text: string, checked: boolean }
  ],
  recurrence:  {                        // 繰り返し（任意、P3）
    type:  'none' | 'weekly' | 'monthly',
    until: number | null                // epoch ms、null なら無期限
  },
  comments:    [                        // コメント／活動履歴（P3）
    { userId: string, text: string, photoUrl?: string, createdAt: number }
  ],
  createdBy:   string,                  // Firebase Auth uid
  createdAt:   number,                  // epoch ms、不変
  updatedAt:   number                   // epoch ms、編集時更新（LWW マージ用）
}
```

#### `families/{familyId}/familyConfig/labels`（新規、単一ドキュメント）
```js
{
  labels: [
    { id: string, name: string, color: string },  // 6 個プリセット
    ...
  ],
  updatedAt: number
}
```

### C-3. 判定ルール（タブごとの表示フィルタ）
- **スケジュールタブに表示**：`isMemo !== true` かつ `startAt` が数値（null でない）
- **メモタブに表示**：`isMemo === true` または `startAt === null`
- 「メモに保存する」トグル ON ＝ `isMemo = true`（既存データの場合 `startAt` を保持したまま）
- 「メモに保存する」トグル OFF ＋ `startAt` 設定 ＝ スケジュールタブへ
- トグル切替で `isMemo` のみ更新、本文・タイトル・コメント等は維持

### C-4. ID 生成
- 既存 `uuid()` 関数を使い回す（`crypto.randomUUID()` 優先）

### C-5. 既存 pins との関係
- pins と events は独立コレクション
- 将来「ピンを予定化（場所付き予定）」「予定を地図にも表示」のクロス機能を検討する場合は events に `pinId` フィールドを追加することを想定（**Stage 2 以降の検討事項**）

---

## D. Firestore セキュリティルール

### D-1. P2 着手前にユーザーが Firebase Console で実施する手順

1. https://console.firebase.google.com/ にログイン（`examrx79.bd03@gmail.com` アカウント）
2. プロジェクト `family-map-c5110` を選択
3. 左サイドバー「Firestore Database」→ 上部「ルール」タブ
4. 既存ルールに以下を追加（`pins` と同じパターン）：

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /families/{familyId} {
      // 既存
      match /pins/{pinId} {
        allow read, write: if request.auth != null;
      }
      // 新規（events と familyConfig）
      match /events/{eventId} {
        allow read, write: if request.auth != null;
      }
      match /familyConfig/{docId} {
        allow read, write: if request.auth != null;
      }
    }
  }
}
```

5. 「公開」ボタンをクリック → 反映を待つ（数秒）
6. クライアント側（PWA）を再読み込みすると新コレクションへの read/write が通る

### D-2. なぜ匿名認証で OK か
- family-map は家族コード制で外部公開せず、URL hash から家族コードを取得する設計
- Firebase 匿名認証は「セッションが認証済みか」だけを担保し、家族コードはアプリ層でフィルタする
- 既存 pins と同じセキュリティ水準。家族コードを知っている／URL を持っている人が家族 = 信頼される、という運用前提

### D-3. リスク
- 家族コードがリークすると外部から書き換え可能。これは pins でも同じ既存リスク
- 監査ログは Firebase Console から確認可能。私用前提なのでこれ以上の認可は導入しない方針

---

## E. UI 構造（TimeTree キャプチャ 7 枚から抽出した詳細仕様）

ユーザー提供の TimeTree キャプチャ 7 枚から抽出した UI 仕様。**配色は family-map 既存の北欧系トンマナに置き換える。**

### E-1. メモタブ（一覧画面）
- カード形式の **2 列グリッド**（縦長カード）、列間 8px / 行間 12px
- 各カードの構成：
  - 左上に投稿者アイコン（円形 24px、初頭文字 or 写真）
  - タイトル（ラベル色で太字、最大 2 行で `text-overflow: ellipsis`）
  - 本文プレビュー（数行、`var(--text-dim)`）
  - チェックリスト型なら「N/M 完了済み」進捗バー、下部にチェックボックスの先頭 3 件プレビュー
  - 下部に小さく投稿者名 or タイムスタンプ
  - 未読 or 新着があれば右上に小さな赤丸ドット（3px）
- 画面右下に「＋」FAB（新規メモ追加、既存 fab スタイル流用）
- 縦スクロール、無限スクロール不要（家族 N 人で数十件想定）
- カードタップで E-2 詳細画面へ

### E-2. メモタブ（詳細画面）
- 上部：「←」戻る / メモタイトル（or 空、本文に書く）/ 「⋯」メニュー（編集・削除）
- 中央：投稿者アイコン → タイトル（ラベル色、中央寄せ、大）→ 本文（左寄せ、改行保持、長文対応）
- 下部固定アクションバー：♡ いいね / ✓ 既読 / 画像 / コメント入力欄 / 絵文字
- スクロールでさらに下にコメント履歴・活動履歴
- **Stage 1 では「下部固定アクションバー」は省略可、編集導線は「⋯」メニューのみで OK**

### E-3. メモタブ（チェックリスト型詳細）
- E-2 の枠の中で、本文の代わりに：
  - メタ情報行：通知（任意）/ ラベル / チェック進捗「N/M 完了済み」
  - チェックボックス + アイテム名のリスト
  - 各行タップで `checked` を toggle、改行（or「＋追加」ボタン）で次の項目を追加

### E-4. スケジュールタブ（マンスリー画面）
- 上部：「2026年 5月 ▾」（月切替）/ 右に「今日へ戻る」/ メニューアイコン
- カレンダーフィルター行（Stage 1 では省略可、Stage 3 で複数カレンダー機能検討時に追加）
- 曜日ヘッダー（**日曜始まり**、既存 family-map のカレンダー実装と統一）
- マンスリーグリッド：
  - 7 列 × 6 行（または 5 行）の日付セル
  - 当日の予定がラベル色付きバーで表示（複数日予定は連続バー、単日は短いタグ）
  - 1 日に複数予定がある場合は最大 3 件 + 「+N」表示
  - 「今日」は丸枠 or 強調表示（`var(--accent)` 色）
- 右下「＋」FAB（新規予定追加）
- 日付タップで E-5 日詳細リストへ

### E-5. スケジュールタブ（日詳細リスト）
- 上部：「3月20日 金曜日」（祝日名表示は Stage 2 以降）/ 右に「⊕」追加
- その日の予定リスト：
  - 左に「終日」or 時刻（開始-終了）
  - タイトル + ラベル縦バー（カラー、4px 幅）
  - 右に投稿者アイコン
  - 本文があれば 1 行プレビュー

### E-6. 予定詳細画面
- 上部：「←」戻る / 「⋯」メニュー
- 投稿者アイコン + タイトル（ラベル色、中央寄せ、大）
- 日付範囲：「2026年 3月20日(金) ＞ 2026年 3月22日(日)」
- 本文 / ラベル
- 区切り線
- 活動履歴（Stage 3 で追加。誰がいつ何をしたかをタイムライン表示）
- 下部固定アクションバー：♡ / ✓ / コメント（Stage 3 で追加）

### E-7. 予定作成・編集モーダル（最重要、Stage 1 の核）
- 上部：「✕」キャンセル / 「保存」
- タイトル入力欄（大、必須）
- 「終日」トグル
- 「開始」/「終了」日時選択（終日 OFF なら時刻ピッカーも）
- **「メモに保存する」トグル ★** ← `isMemo` フラグの操作。これが本機能の核心
  - ON にすると：UI 上で「日時」セクションをグレーアウト（ただしデータは消えない）、保存後はメモタブに表示
  - OFF に戻すと：日時セクション再活性化、スケジュールタブに表示
- 「ラベル」選択行（6 色プリセットから選ぶ、横並び）
- 「本文」入力（複数行テキストエリア、max 2000 文字）
- 追加ボタン群（タイル状、Stage 1 では一部のみ実装）：
  - 「繰り返し」（Stage 3）
  - 「チェックリスト」（Stage 1 でメモタブ用に実装）
  - 「場所」（Stage 2 以降、pins との連携検討）
  - 「URL」「添付ファイル」「日数カウント」（Stage 2 以降に保留）

### E-8. メモ作成・編集モーダル
- E-7 と **同じモーダル**を使用（コンポーネント共通化）
- 「メモに保存する」トグルが ON の状態で開く（メモタブからの新規作成）
- チェックリストモード切替（タイル「チェックリスト」をタップでチェックボックス入力に切替、`checklist` 配列を編集）

### E-9. 配色・トンマナ
- TimeTree の緑基調はそのまま採用せず、**family-map 既存の北欧系トンマナ**を踏襲
- ラベル色のパレット 6 色（family-map トンマナと調和）：

| id      | name      | color (hex) | 用途想定         |
|---------|-----------|-------------|------------------|
| label-1 | ラベル1   | `#b67659`   | テラコッタ（既存 --accent）|
| label-2 | ラベル2   | `#7a9166`   | セージ（既存 --visited）|
| label-3 | ラベル3   | `#d4a14a`   | マスタード（既存 --want）|
| label-4 | ラベル4   | `#c97b7b`   | スモークローズ（既存 --memory）|
| label-5 | ラベル5   | `#8a7fa0`   | ラベンダーグレー |
| label-6 | ラベル6   | `#6b8a9e`   | スモークブルー   |

- 初期名「ラベル1」〜「ラベル6」は **設定画面で家族がカスタマイズ可能**（Stage 4 以降）
- カードシャドウ・角丸・余白は既存 .modal や .list-card と揃える

---

## F. 既存機能との非干渉

### F-1. familymap タブ ＝ 既存機能の親要素
- familymap タブの中身は既存の地図 div、フィルタチップ、現在地ピン FAB、一覧 FAB（→ listView）
- 既存の listView を開くフロー（FAB→listView→ピン詳細→Edit Modal）はすべて familymap タブの内側に閉じる
- 既存の「view-tabs `[リスト] [カレンダー]`」は listView の中で **そのまま残す**（リネームしない、廃止しない）
- **前 P1 の「カレンダー → 思い出ログ」リネームは撤回**。既存呼称を維持

### F-2. familymap タブ以外のタブでの挙動
- schedule / memo タブを選択中：
  - 地図の Leaflet/Google Maps SDK は読み込まれているが非表示（unmount しない）
  - 地図関連イベント（タップ・ドラッグ）は発火しない
  - listView の FAB は非表示
  - 既存の Firestore リアルタイム同期は走り続ける（pins, events 両方 onSnapshot）

### F-3. 既存の家族コード管理・認証フローの流用
- 家族コードの取得・保存・URL hash 管理は既存ロジックをそのまま使う
- events / familyConfig は同じ `familyId` 配下に置く
- Firebase 匿名認証セッションは pins / events で共通

---

## G. Phase 別実装計画

### P1'（本セッション）
**目的**：3 タブ並列ナビ＋既存 UI の familymap タブへの隔離
- 上部 3 タブ navigation 追加（HTML、CSS、JS）
- 既存 HTML（ヘッダーは除く `<div class="filters">` と `<div class="map-wrap">`）を `<section id="topTab-familymap">` でラップ
- `<section id="topTab-schedule">` `<section id="topTab-memo">` のプレースホルダ「準備中です」追加
- タブ切替ロジック `setActiveTopTab(tab)` 関数
- localStorage `family-map.activeTopTab` 永続化、デフォルト `'familymap'`
- 旧 P1 で保存された `prefs.listSubView === 'memorylog'` を `'calendar'` に戻す migration（保険）
- データモデルヘルパー：`eventsRef()` / `eventDocRef(id)` / `labelsDocRef()` / `DEFAULT_LABELS` / `isMemoEvent()` / `isScheduledEvent()`（**読み書きはまだしない**）
- 規模見込み：+250〜350 行

### P2'（本セッション、完了）
**目的**：スケジュールタブの最低限の動作
- [x] スケジュールタブのマンスリーカレンダー UI 実装（月送り、TODAY、ラベル色イベントバー、日付タップ、FAB「＋」）
- [x] 予定の追加・表示・編集（Stage 1：ラベル選択のみ、繰り返し・チェックリスト・コメントなし）
- [x] 予定作成・編集モーダル（E-7 の最小版、「メモに保存する」トグル含む）
- [x] ラベル 6 色プリセットの `ensureDefaultLabels()` 実装（初回起動時に `familyConfig/labels` を `getDoc` → 無ければ `setDoc(DEFAULT_LABELS)`）
- [x] 日詳細スライドアップシート（E-5 簡易版、終日/時刻表示・ラベル色縦バー）
- [x] 予定詳細画面（E-6 簡易版、活動履歴なし）
- [x] events コレクションへの read/write 開始（`onSnapshot` リアルタイム同期、`setDoc/deleteDoc` 単一エンティティ CRUD）
- [x] `connectToFamily()` 末尾に `ensureDefaultLabels()` + `subscribeEvents()` を追加（既存 pins 同期は無改変）
- スコープ外（P3' 以降）：コメント / 繰り返し / 活動履歴 / チェックリスト / 投稿者アイコン / メモタブ実装 / ラベル管理 UI

### P3'（本セッション、完了）
**目的**：スケジュールの強化
- [x] 予定にコメント機能（events ドキュメント内の `comments` 配列に `updateDoc + arrayUnion` で追記）
  - 予定詳細モーダル下部に「コメント」セクション（投稿者・本文・投稿時刻、自分のコメントはアクセントカラー背景）
  - チャット形式の textarea + 送信ボタン（disabled until non-empty）、Cmd/Ctrl+Enter で送信
  - onSnapshot で別端末からの新着コメントが即反映
  - スコープ外（次以降）：写真添付、絵文字リアクション、既読
- [x] 繰り返し（`recurrence: { type: 'none'|'weekly'|'monthly', until: number|null }`）
  - 予定エディタに「繰り返し」セクション（折りたたみ式の `設定/閉じる` ボタン）
  - 3 つのチップ：なし／毎週／毎月。`until` は date input で任意設定
  - マンスリー表示時の展開：`eventsOnDate()` が `__recurInstance` 仮想イベントを生成
  - 編集／削除は **元の予定を変更**（全インスタンスに反映）— エッジケース簡略化
  - 月末跨ぎ：原則 `getDate()` 一致のみ。元が 31 日なら短い月はスキップ
- [x] 活動履歴の自動記録（`activities` 配列に `{id,userId,type:'created'|'updated',timestamp}`）
  - 予定詳細モーダルに「活動履歴」セクション
  - 同一ユーザーの連続 `updated` を集約して「×N」表示（TimeTree 風）
  - 削除は doc が消えるため記録不可（仕様）
- 通知（ブラウザ通知 API は iOS PWA 制限あり、Stage 4 以降検討）

### P4'（本セッション、完了）
**目的**：メモタブの実装
- [x] メモタブのカード一覧 UI（E-1：2 列グリッド、左 4px ラベル色バー、アバター、メタ、タイトル、本文 or チェックリストプレビュー、`N/M 完了済み`、空状態）
- [x] メモ詳細は **予定詳細モーダル `#evDetailBg` を共通化**（E-2 と E-6 を統合、E-3 のチェックリスト表示も同じモーダル内で対応）
- [x] チェックリスト型（E-3）：エディタの「チェックリストにする」トグル + 編集 UI（行追加・削除・Enter 次行・Backspace 空行削除）/ 詳細モーダルでも表示＋行タップで即時 toggle
- [x] 共通モーダルでの「メモに保存する」トグル動作：メモタブ「+」FAB から `defaultMemo:true` で開く、トグル切替でエディタタイトル動的切替、`isMemo` フラグでスケジュール ↔ メモの相互遷移が自動
- [x] `subscribeEvents` / `setActiveTopTab` が `renderMemo()` を呼ぶ live 更新
- 規模：6250 → 7005（+755 行、HTML +14 / CSS +290 / JS +450 程度）

### P5'（本セッション、完了）
**目的**：統合と仕上げ
- [x] ラベル管理 UI（設定画面に「スケジュール / メモのラベル」セクション、行ごとに色チップタップで 12 色パレット / 名前入力 blur で即保存 / 削除ボタン）
- [x] 「＋ ラベルを追加」ボタン（最大 12 個、`LABEL_MAX`）
- [x] `subscribeLabels()` で別端末のラベル変更をリアルタイム反映（input フォーカス中は再描画スキップで未保存入力を保護）
- [x] 削除した labelId を持つ events は無変更（`getLabelById` が null で grey 表示にフォールバック）
- [x] 楽観的更新＋失敗時ロールバック＋ alert
- [x] 統合動作確認（コードレベル）：トグル両方向遷移、繰り返し予定とラベル共存、コメント・活動履歴のメモ適用、ラベル変更の即時伝播、既存機能との非干渉
- [x] 空状態・エラーハンドリングの確認（メモタブ空状態、Firestore 接続失敗時の alert）
- [x] CLAUDE.md / HANDOVER.md / SPEC_SCHEDULE.md の最終更新
- 規模：7005 → 7231（+226 行、HTML +9 / CSS +85 / JS +132 程度）
- 残：ユーザー手動テスト → 承認 → 一括 push

### P6'（本セッション、完了）— UX 修正フェーズ
**目的**：iPhone 実機テストでぐっちから出た 10 項目の UX 改善要望を一括対応
- [x] **A-1** 位置情報許可を初回 1 回のみに：`navigator.permissions.query({name:'geolocation'})` で状態確認、`granted` で silent pan、`prompt` でも `family-map.geoAsked.v1` localStorage フラグがあれば silent。`locate()` FAB 成功時に `rememberGeoAsked()` をマークして以降は cold start でも prompt しない
- [x] **B-1** 「メモに保存する」トグル切替時のグラフィカルな項目開閉：`.memo-hide` + `.memo-hidden` クラス（max-height + opacity + padding/margin/border-color の transition）で日時セクション・繰り返しを slide animate。初回 open は `.memo-no-anim` で抑制（2 RAF 後 remove）
- [x] **B-2** ラベル選択 UI を TimeTree 風タップ展開式に：`.ev-label-trigger`（swatch + 名前 + caret）+ `.ev-label-panel`（既存 chip 群）。`syncLabelTriggerToSelection()` でトリガー表示を選択中ラベルに同期。選択時は自動 fold
- [x] **B-3** 「カレンダーに予定が見えるのに日タップで予定なし」バグ対策。原因不明のまま defensive fix：
  - `eventsOnDate` の繰り返し展開を **多日 span 対応**（master が `getMidnight(endAt) - getMidnight(startAt) + 1` 日続く場合、各 occurrence もその span 日数カバー）
  - `renderScheduleDayList` に safety-net を追加：`eventsOnDate` が空でも raw `events` を直接スキャンしてフォールバック、`console.warn` でログ出力
  - 多日 weekly/monthly recurring の不整合（master の day-of-week 1 日のみ生成）が真因なら同時に解消
- [x] **B-4** 年月ピッカー modal：`#schedYmPickerBg`、年は現在 ±5 のスクロール pill（`scrollIntoView` で開時のみ centre）、月は 4×3 グリッド。「決定」で renderSchedule
- [x] **C-1** メモタブ「+」FAB の `memoLocked: true` モード：`applyMemoLockedMode(true)` で日時・繰り返し・「メモに保存する」トグル自体に `.memo-locked-hidden { display: none !important }` を付与。memoBtn を ON に強制。既存メモの edit 時は `memoLocked` なしで開くので両方向遷移は維持
- [x] **D-1** スワイプダウン grip の hit area 拡大：28px → 52px、`right: 48px` で close-X ボタン領域を避ける、視覚 pill は `position:absolute + left:50% + transform:translateX(24px)` で modal-center 整合
- [x] **P-1** `.btn-primary` を TimeTree 風アクセント色に：`background: var(--accent); color: #fff; box-shadow`、active で `#a4684e` + scale(0.98)
- [x] **P-6** スケジュール grid 横スワイプ前後月 navigation：`setupScheduleSwipeNav()` で touchstart/touchend 監視、閾値 60px + 縦比 0.5、`dx > 0` で前月。swipe 検知時は capture-phase click listener で次の click を swallow
- [x] **P-7** 複数日予定の連続バー表示：`buildScheduleWeekLayouts()` で週ごとに lane を greedy 割当（all-day 優先、長 span 優先）、各日に kind=`single/start/middle/end` のバー描画。`bar-start` は右側角 0、`bar-middle` は両側角 0、`bar-end` は左側角 0。`continuesLeft/continuesRight` フラグで週またぎを判定。`.sched-cell` から横 padding を撤去、bar は cell 全幅
- 規模：7231 → 8021（+790 行、HTML +50 / CSS +330 / JS +410 程度）
- スコープ外（次以降）：参加メンバー（要プロフィール基盤）・マイプロフィール画面・familymap での作成者表示・当日通知・Google カレンダーインポート
- 残：ユーザー手動テスト → 承認 → P5' と合わせて一括 push（P1'-P5' は `cb3e0e1` で push 済なので P6' のみ追加 push）

### P7'（2026-05-26、完了）— プロフィール基盤 + 参加メンバー選択 + ピン作成者表示
**目的**：これまで UI 上は UID の頭文字しか表示できなかった「誰が作った／編集した」を、家族メンバーごとの表示名・アバターで可視化。さらに予定の参加メンバーを家族から選択できるようにする（TimeTree の参加者機能）。**local commit のみ・未 push**。
- [x] **マイプロフィール（設定モーダル内）**：
  - 設定モーダル「ラベル管理」の前に「マイプロフィール」セクションを追加
  - 表示名（最大 20 文字）/ アバター種別タブ（文字 / 絵文字 / 色のみ）/ 背景色 12 色パレット
  - プレビュー丸 48px 表示、保存ボタンで `setDoc(families/{familyId}/members/{authUid}, {displayName, avatar:{type,value,bgColor}, createdAt, updatedAt})`
  - 初回プロンプト：家族接続後に自分の member ドキュメントが無く `family-map.profilePromptShown.v1` フラグも無ければ `#profilePromptBg` 表示。「あとで」「保存して始める」、スキップは永続フラグ
- [x] **参加メンバー選択（予定エディタ）**：
  - 予定エディタの「ラベル」直下に `.ev-members-row`（trigger ボタン + アバター列 + プレースホルダ + 「+N」 + caret）
  - タップで `#memberPickerBg` bottom-sheet（multi-select チェックボックス形式）。「決定」で `editorMembersSelection` Set に commit、保存で `ev.members: [uid, ...]` として永続化
  - 新規予定は自分 1 人プリセレクト、既存予定は `ev.members` から復元、ピッカー閉じる時に「キャンセル」だと revert
  - スコープ外：iCal Attendee 形式（RFC 5545）対応、ゲスト招待 URL、外部メールアドレス参加者
- [x] **イベント詳細モーダル**：
  - 新規 row 2 個：`#evDetailAttendees`（参加者一覧、chip 形式）と `#evDetailCreator`（作成者、アバター + 名前）
  - `renderEventDetailMembersAndCreator(id)` を `renderEventDetailDynamicSections` から呼出、live 更新対応
- [x] **マンスリーバー adornment**：
  - 単一参加者なら小アバター（11px、白枠）、複数なら `+N` テキストを bar 右端に追記
  - kind = `single` / `start` の時のみ。`middle` / `end` は省略してバー混雑回避
- [x] **メモカード作成者 + 参加者**：
  - 左上アバターを `(ev.createdBy)` の頭文字 → `getMemberById(ev.createdBy)` の本物のアバターに差し替え（fallback で uid 頭文字）
  - `ev.members` があればカード下部に attendee 横並び（小、最大 4 件 + `+N`）
- [x] **スケジュール日詳細リスト**：各行の preview 下に attendee 小アバター行（最大 4 件 + `+N`）
- [x] **ピンエディタ作成者**（読み取り専用）：
  - 「ステータス」と「座標」の間に `#pinCreatorRow` 新設（編集モード時のみ表示）
  - `refreshPinCreatorRow` を `openEditor` 末尾で呼出
  - `savePin` で新規ピンに `createdBy: currentUid()` を設定、`pinToCloud` で永続化（既存ピンは無値のまま、creator 行は hidden）
- **Firestore データモデル変更**：
  - 新規 `families/{familyId}/members/{memberId}`（memberId == authUid）
  - `events.members: string[]`（uid 配列、optional）
  - `pins.createdBy: string`（uid、optional、互換性のため）
- **新規 JS ヘルパー**（19 個）：`membersRef` / `memberDocRef` / `subscribeMembers` / `getMemberById` / `myMember` / `currentUid` / `normalizeMember` / `memberDisplayName` / `formatMemberAvatar` / `cloudWriteMyMember` / `renderProfileEditor` / `updateProfilePreview` / `saveMyProfile` / `ensureProfileSetup` / `showProfilePrompt` / `closeProfilePrompt` / `renderProfilePromptColors` / `updateProfilePromptPreview` / `saveProfilePromptForm` / `setEventEditorMembers` / `readEventEditorMembers` / `syncMembersTriggerFromSelection` / `openMemberPicker` / `closeMemberPicker` / `renderMemberPickerList` / `renderEventDetailMembersAndCreator` / `refreshPinCreatorRow`
- **新規定数**：`MEMBER_BG_PALETTE`（12 色、ラベルと同パレット再利用）/ `DEFAULT_MEMBER_BG` / `PROFILE_PROMPT_SHOWN_KEY`
- **新規モジュールキャッシュ**：`membersCache = Map<uid, member>` / `membersUnsub` / `profileEditorState` / `profilePromptColor` / `profilePromptShownThisSession` / `editorMembersSelection` Set / `memberPickerWorkingSet`
- **CSS 追加**（~280 行）：`.fm-avatar`（sm/md/lg/xl）/ `.fm-avatar-row` / `.profile-preview-row` / `.profile-form` / `.profile-tabs` / `.profile-color-grid` / `.profile-prompt-modal` / `.ev-members-row` / `.ev-members-trigger` / `.member-picker-list` / `.member-picker-row` / `.ev-detail-attendees` / `.ev-detail-creator` / `.sched-bar-members` / `.memo-card-members` / `.sched-day-item-members` / `.pin-creator-row`
- **非干渉確認**：既存 pins CRUD / pin onSnapshot / familymap 全機能 / listView / カレンダー / 検索 / ソート / 一括選択 / CSV インポート / Gemini 要約 / 予定 CRUD / コメント / 繰り返し / 活動履歴 / チェックリスト / ラベル管理 / 3 連結スワイプ / P6.4 ヘッダー統合 / P6.5 メモ件数バッジ いずれも DOM/ロジック無改変
- **setupModalBackgroundBlur** の bgIds に `#memberPickerBg` と `#profilePromptBg` を追記、**setupSwipeToClose** の bgId 分岐に `memberPickerBg` を追記（grip swipe で picker 閉じ）
- **規模**：8540 → 9666（+1126 行、HTML +90 / CSS +280 / JS +755 程度）
- **JS シンタックス**：`node --check` で clean。HTML タグバランス：div / section / button / span / script すべて差分 0
- **Firebase Console 追加作業（ユーザー必須）**：`families/{familyId}/members/{memberId}` への `allow read, write: if request.auth != null` を Firestore セキュリティルールに追加して公開。やらないとプロフィール保存が `permission-denied` で失敗
- 次：ユーザー手動テスト → 承認 → push

### P6.4'（本セッション、完了）— contenteditable ロールバック + モーダル背景タップで blur + ヘッダー統合
**目的**：iPhone 17/18 系で contenteditable にもキーボードアクセサリビューが出ることが実機確認で確定したため、P6.2'/P6.3' の workaround を **全面ロールバック**。UX 改善としてヘッダー周りも統合。**local commit のみ・未 push**。
- [x] **contenteditable ロールバック**：5 種の入力 UI を `<input>` / `<textarea>` に戻し、`placeholder` / `maxlength` 属性も復活：
  - ピンエディタ：`titleInput`（input）、`memoInput`（textarea）
  - 予定エディタ：`evTitleInput`（input）、`evBodyInput`（textarea）
  - 予定詳細：`evCommentInput`（textarea）
  - チェックリスト項目：`.ev-checklist-input`（`addChecklistItemRow` 内で動的生成、`<input type="text">`）
  - ラベル名：`.label-mgmt-name`（`renderLabelMgmt` 内で動的生成、`<input type="text">`）
  - 削除した JS：`cedGet/cedSet/cedFocus/cedAttach/cedInitAll/cedUpdateEmptyState/setupAccessoryBarSuppression/_accNeutraliseAll/_accRestoreAll/_accSupportsReadonly/_accFormElements` 関数と関連状態（`_accAttrCache/_accNeutralised/_accRestoreScheduled/_ACC_PICKER_TYPES`）
  - 削除した CSS：`.cedit / .cedit-multi / .cedit:empty::before / .cedit.is-empty::before / .cedit:not(.cedit-multi)` と `.ev-comment-input.cedit` 系 override
  - `syncHeaderActionToInput` は `<input>` 専用に単純化（typeof 分岐削除）、`bindHeaderActionButton` の `cedFocus` は `.focus()` に戻す。P-1 動的保存ボタンは `<input>` でも `focus`/`blur` で発火するため挙動維持
  - `addCommentToCurrentDetail` / `updateCommentSendEnabled` / `savePin` / `openEditor` / `detectPlace` / `saveEvent` / `openEventEditor` / `openEventDetail` / `addChecklistItemRow` / `readChecklistEditor` / `renderLabelMgmt` の値アクセスはすべて `.value` / `.value =` に戻す
- [x] **モーダル背景タップで blur**：`setupModalBackgroundBlur()` を新規追加し `init()` 末尾で呼ぶ
  - 対象 7 モーダル：`#modalBg`（ピン編集）/ `#evEditorBg`（予定編集）/ `#evDetailBg`（予定詳細）/ `#schedDayBg`（日詳細シート）/ `#settingsBg`（設定）/ `#schedYmPickerBg`（年月ピッカー）/ `#gImportBg`（Google Maps CSV インポート）
  - `#bulkBg` は HTML に存在せず（bulkStatusBg と混同しないよう注意、bulkStatusBg は別ロジック）
  - 各モーダルの click を **capture phase** で監視
  - タップ先が `input, textarea, button, a, label, [role="button"]` 内なら何もしない
  - 現在 focus 中の `<input>` / `<textarea>` を `.blur()` し、`e.stopPropagation()` で既存の「背景タップで閉じる」ハンドラを抑止 → **キーボードだけ閉じる、モーダルは残る**（TimeTree 風）
  - フォーカス無しでの背景タップは従来通りモーダル閉じ
- [x] **ヘッダー統合**：旧 `.sched-header` と `.memo-header` をグローバル `<header class="header">` に統合
  - `.brand` 内に `<span class="brand-sub" id="brandSub">` を追加。schedule 用の月ピッカーボタン（`#schedTitleBtn`、`data-tab-only="schedule"`）と memo 用の件数バッジ（`#memoHeaderCount`、`data-tab-only="memo"`）を `[hidden]` で初期化、`setActiveTopTab` 内でタブ別にトグル
  - schedule 用ナビ（TODAY ‹ ›）は `<div class="header-sched-nav" data-tab-only="schedule" hidden>` として `.brand` と `.header-right` の間に配置、`margin-left: auto` で右寄せ
  - `setActiveTopTab` 内で `[data-tab-only]` 要素を全 query して `tab !== el.dataset.tabOnly` なら `hidden` 付与、一致したら `hidden` 削除。さらに `.brand-sub` 自体も全子要素 hidden 時は `display: none` で詰める
  - 旧 in-panel HTML（`<div class="sched-header">月タイトル+TODAY/‹/›</div>` と `<div class="memo-header">MEMO+件数</div>`）は除去
  - 対応 CSS（`.sched-header / .sched-nav-group / .memo-header / .memo-header-title / .memo-header-count`）も削除、新規 CSS（`.brand-sub / .brand-count / .header-sched-nav`）を追加
  - `.sched-title-btn` は padding 7px 14px → 5px 11px、font 14px → 13px に縮小（header 行高さに合わせる）。`.sched-nav-btn` は 32x32 → 28x28、font 16px → 14px
  - 結果：全タブ共通の `[brand-dot] [BRAND TEXT]` + タブ別 sub-info + schedule のみ `[TODAY ‹ ›]` + 常時 `[⚙][YYYY.MM.DD]` の 1 行に集約
- **非干渉確認**：地図／listView／フィルタ／現在地ピン／CSV インポート／Gemini 要約／予定 CRUD／メモ CRUD／コメント／繰り返し／活動履歴／チェックリスト／ラベル管理／P-1 動的保存ボタン／P-6 3 連結スワイプ／P-7 連続バーすべて DOM/ロジック無改変
- 規模：8779 → 8529（**-250 行**、HTML +24 / CSS -76 / JS -198 程度の正味）
- 残：ユーザー実機テスト → 承認 → P6'+P6.1'+P6.2'+P6.3'（push 済）+P6.4' をまとめて push

### P6.2'（本セッション、完了）— P6' 再リファイン（P-6 3 連結 + iOS キーボードアクセサリ抑制）
**目的**：P6.1' で実装した P-6 簡易案（隣月空白）をユーザーが iPhone 実機 3 回目テストで却下し、TimeTree のように横にスライドしたとき隙間なく横の月のカレンダーが見える 3 連結方式に書き直し。同時に「入力時に Safari の上下＋完了ボタンのモーダル（キーボードアクセサリビュー）を出したくない」要求に対応。
- [x] **P-6 3 連結方式に書き直し**：
  - `.sched-grid-track`（display:flex; width:300%; transform:translateX(-33.3333%); touch-action:pan-y）を新設し、3 つの `.sched-grid` パネル（`schedGridPrev` / `schedGrid` / `schedGridNext`、各 width 33.3333%）を横並びに配置。track は `.sched-wrap` の overflow:hidden で外側をクリップ
  - `renderSchedule()` を分解：日付セル生成・週レイアウト計算・バー描画ロジックを `renderScheduleGrid(grid, year, month, isMain)` に切り出し、`renderSchedule()` は title 更新と 3 か月分（prev/current/next）の `renderScheduleGrid` 呼出 + track の transform reset のみ
  - `addMonths(year, month, delta)` ヘルパー追加（年またぎ計算）
  - スワイプ中：`setTrackTransform(px)` = `track.style.transform = calc(-33.3333% + ${px}px)` で finger-track、no easing
  - touchend：|dx| >= viewport × 0.5 で commit → 240ms ease-out で off-screen（`dx>0` なら viewportWidth 分）にスナップ → `gotoScheduleMonth(±1)` で月ステート更新 → `renderSchedule()` が 3 パネルを新月ベースで再構築 + transform を `-33.3333%` に瞬時リセット（jump 無し、ユーザーには連続的に見える）
  - 中央付近なら baseline `-33.3333%` にスナップバック
  - 横ロック判定（|dx| > 8 かつ |dx| > |dy|）で縦スクロール優先
  - `touch-action: pan-y` で vertical pan は native handling、horizontal は JS 管理
  - `touchcancel` でも snap back（horizLocked && !snapping の時）
  - capture-phase click listener を track 上に配置、swipe 検出時は次の click を swallow（cell タップで誤って日詳細が開くのを防ぐ）
  - スワイプ後の click は capture phase で `e.stopPropagation() + e.preventDefault()`
  - 既存のラベル変更時の再描画（`subscribeLabels`）と onSnapshot 経由の再描画はすべて `renderSchedule()` 経由なので 3 連結を自動的に rebuild
- [x] **iOS Safari アクセサリビュー抑制（contenteditable 化）**：
  - 対象 5 種：①ピンエディタ場所名 / メモ（`titleInput` / `memoInput`）、②予定エディタタイトル / 本文（`evTitleInput` / `evBodyInput`）、③予定詳細コメント（`evCommentInput`）、④チェックリスト項目入力（`addChecklistItemRow` 内で動的生成）、⑤ラベル名入力（`renderLabelMgmt` 内で動的生成）
  - スコープ外：家族コード入力（`famCodeInput`、Stage 3）、一覧検索（`searchInput`、Stage 3）、date/time/file input は変更せず（native picker / file dialog のため不要）
  - HTML：`<input class="input" id="..." placeholder="..." maxlength="...">` → `<div class="cedit" id="..." contenteditable="true" data-placeholder="..." data-maxlength="..." data-single-line="1" aria-label="...">`
  - `<textarea class="textarea" ...>` → `<div class="cedit cedit-multi" ...>`
  - CSS 新規（`.input/.textarea` 直下に追加）：
    - `.cedit`：input/textarea と同じ見た目（width, background, border, padding, font, color）、`min-height: 24px; cursor: text; line-height: 1.5; word-break: break-word; white-space: pre-wrap; overflow: hidden`
    - `.cedit:focus`：accent border
    - `.cedit.cedit-multi`：`min-height: 80px; overflow: auto`
    - `.cedit:empty::before, .cedit.is-empty::before`：`content: attr(data-placeholder); color: var(--text-mute); pointer-events: none;`（プレースホルダ疑似実装）
  - `.ev-comment-input` の min-height/max-height は `.cedit-multi` の 80px を上書きするため `.ev-comment-input.cedit-multi { min-height: 36px; max-height: 100px; overflow-y: auto }` を追加
  - JS ヘルパー：
    - `cedGet(el)`：`.innerText` で改行を `\n` 化（`<br>` 経由の改行も取れる）、CRLF を LF 正規化
    - `cedSet(el, val)`：`.textContent = val`（XSS 安全、innerHTML 不使用）+ `cedUpdateEmptyState(el)`
    - `cedFocus(el)`：focus + caret を末尾に移動（`window.getSelection() + Range.collapse(false)`）
    - `cedAttach(el, opts)`：input イベントで maxlength 強制、single-line で `\n` をスペースに置換、paste で plain text 強制（`document.execCommand('insertText')`）、`is-empty` クラス管理、single-line で Enter=blur
    - `cedInitAll()`：`document.querySelectorAll('.cedit').forEach(cedAttach)` — init 時に一括 attach
    - `cedUpdateEmptyState(el)`：`innerHTML` が `''` or `<br>` のみなら `is-empty` 付与
  - `cedInitAll()` を `init()` 冒頭で呼び出し（pin editor 起動より前に確実に走る）
  - 値アクセス：すべて `cedGet` / `cedSet` で統一
    - `openEventEditor`：`titleInput.value = ev.title` → `cedSet(titleInput, ev.title)`
    - `saveEvent`：`titleInput.value` → `cedGet(titleInput)`、`bodyInput.value` → `cedGet(bodyInput)`
    - `openEditor`（pin）：`getElementById('titleInput').value = ...` → `cedSet(getElementById('titleInput'), ...)`
    - `savePin`：同上
    - `detectPlace` POI auto-fill：`t.value` → `cedGet(t) + cedSet(t, ...)`
    - `addCommentToCurrentDetail`：`inp.value` → `cedGet(inp)`、`inp.value = ''` → `cedSet(inp, '')`
    - `updateCommentSendEnabled`：`inp.value.trim()` → `cedGet(inp).trim()`
    - `openEventDetail` の comment reset：同上
    - `addChecklistItemRow`：`<input type="text">` → `<div class="cedit ev-checklist-input">`、`input.value` → `cedGet/cedSet`、Enter ハンドリングは capture phase + `stopImmediatePropagation` で cedAttach の Enter=blur を上書き、TimeTree 風「Enter で次行追加」を維持
    - `readChecklistEditor`：`input.value` → `cedGet(input)`
    - `renderLabelMgmt`：`<input type="text">` → `<div class="cedit label-mgmt-name">`、`name.value` → `cedGet/cedSet`
  - `syncHeaderActionToInput` の値取得を後方互換に：`typeof el.value === 'string' ? el.value : cedGet(el)`（既存 input も contenteditable も両対応）
  - コメント入力の autogrow ロジック削除：contenteditable は content height で自然に伸びるため `commentInput.style.height` の設定は不要
  - ロールバック：すべての変更箇所は `// P6.2' contenteditable migration` コメントでマーク、元の input/textarea 構造は HTML コメントで残存
- 規模：8351 → 8638（+287 行、HTML +18 / CSS +75 / JS +194 程度）
- 既存機能（familymap タブ全機能 / listView / locate FAB / 既存予定 CRUD / メモタブ / コメント / 繰り返し / 活動履歴 / ラベル管理 / Gemini 要約 / P6.1' P-1 動的保存ボタン / P6.1' P-7 連続バー）は全て無改変
- 残：ユーザー手動テスト → 承認 → P6'+P6.1'+P6.2' をまとめて push（P1'-P5' は `cb3e0e1` で push 済）

### P6.1'（本セッション、完了）— P6' リファイン 3 項目
**目的**：P6' で実装した P-1 / P-6 / P-7 をユーザーフィードバックに基づき TimeTree 仕様により忠実に作り直し
- [x] **P-1** 保存ボタンを TimeTree 風の動的切替に：右上に `.modal-header-action` 新規ピル型ボタンを追加（`#evEditorBg` と `#modalBg` 両方）。`bindHeaderActionButton(buttonId, titleInputId, onSave)` ヘルパー + title input の `focus`/`blur` イベントで state 切替。`as-keyboard`（title focused or empty → tap で `input.focus()` 呼出してキーボード起動、グレー） ⇔ `as-save`（title blurred + has content → tap で save 実行、アクセント色）。pin editor では `detectPlace` で title 自動入力した直後にも `syncHeaderActionToInput` を呼出。bottom `.actions` の 保存 ボタンは残存。
- [x] **P-6** 指追随スワイプ＋スナップに置換：touchmove で `.sched-grid` 全体に `transform: translateX(dx)` をリアルタイム適用（finger tracking、no easing）。touchend で |dx| >= width × 0.5 なら off-screen にスナップ → `gotoScheduleMonth(±1)` → transform リセット（width × 220ms ease-out transition）。中央付近なら translateX(0) にスナップバック。横ロック判定（|dx| > 8 かつ |dx| > |dy|）で縦スクロールとの誤検出を排除。簡易案（3 連結なし、現月のみずらす、隣月空間は背景）。スワイプ検出後の click は capture-phase listener で swallow。
- [x] **P-7** 複数日バーをセル境界跨ぎの連続バー化：`.sched-grid` を縦 flex に、各週を `.sched-week`（`position: relative; display: grid; grid-template-columns: repeat(7, 1fr); gap: 0`）でラップ。各セルから `.sched-events / .sched-event-slot / .sched-event-bar` 構造を撤去、代わりに `.sched-week-bars` 絶対配置オーバーレイ（`pointer-events: none`）で `<div class="sched-bar">` を `left:${first/7*100}%; width:${(last-first+1)/7*100}%; top:${lane*13}px` 配置。バーが日と日の隙間を完全に埋める。`.sched-cell` 間は border-right: 0 で重ねる（境界線は左セルの border-left で表現）、`:first-child / :last-child` で週端の rounded を生成。今日セルは `z-index: 2` + full border で完全アクセント枠を維持。`.sched-event-more` (+N) はセル内絶対配置で残存。`barsByKey` Map で `(eventId, lane)` をキーに週内 contiguous run を集約、kind は `inst.first/last` + `continuesLeft/continuesRight` から再計算。
- 規模：8017 → 8350 前後（+330 行、CSS +110 / JS +220 程度）
- 既存機能（familymap タブ全機能 / listView / locate FAB / 既存予定 CRUD / メモタブ / コメント / 繰り返し / 活動履歴 / ラベル管理 / Gemini 要約）は全て無改変
- 残：ユーザー手動テスト → 承認 → P6' + P6.1' をまとめて push（P1'-P5' は `cb3e0e1` で push 済）

---

## H. push 戦略

### H-1. 一括 push 方針
- **P1'〜P5 すべて完了するまで `git push` しない**（ユーザー指示、本セッションで再確認済み） — P1'-P5' は 2026-05-25 後刻にユーザー承認の上 push 済（`d645b93..cb3e0e1`）
- **P6'（UX 修正フェーズ）も同じ規則**：iPhone 実機テスト後に出た 10 項目 fix は本セッションで local commit にとどめ、ユーザー承認後 push
- 各 Phase ごとに local commit のみ蓄積

### H-2. commit メッセージ規則
- プレフィックス：`feat(family-map): P<N>'`（プライム付きで旧 P1 と区別）
- 例：
  - `feat(family-map): P1' add top-level 3-tab nav (familymap/schedule/memo), wrap legacy UI`
  - `feat(family-map): P2' add schedule monthly view, event CRUD, label presets`
  - `feat(family-map): P3' add event comments, recurrence, activity log`
  - `feat(family-map): P4' add memo tab, card grid, checklist memo`
  - `feat(family-map): P5' integrate, polish, label management UI`
  - `feat(family-map): P6' UX polish + bug fixes (10 items from iPhone test)`

### H-3. 緊急時の退避
- バックアップタグ `pre-schedule-feature-2026-05-25`（main の旧 HEAD）
- バックアップ branch `backup/pre-schedule-2026-05-25`
- 旧 P1 廃棄タグ `p1-discarded-2026-05-25`（commit `c412449`、push 済）
- 万一新方針も廃棄したくなったら `git reset --hard pre-schedule-feature-2026-05-25` で戻れる

---

## I. リグレッションテスト項目

全 Phase 完了後にユーザーが iPhone Safari で確認するチェックリスト。**この項目を満たすまで push しない。**

### I-1. 既存機能（familymap タブで従来通り動くか）
- [ ] 地図が表示される
- [ ] 地図タップでピン追加モーダルが開く
- [ ] 既存ピン編集（タイトル・メモ・ステータス変更）
- [ ] ピン削除
- [ ] 上部フィルタチップ（すべて／訪問済み／行きたい／思い出）
- [ ] 現在地ピン📍ボタン（青パルス表示・watchPosition）
- [ ] 一覧ボタン → listView 表示
- [ ] listView 内「リスト／カレンダー」サブタブ切替
- [ ] 検索（名前・住所・メモ横断）・ソート
- [ ] カレンダーの月送り・日付タップでピン抽出
- [ ] 一覧の「選択」モード（一括削除・一括タグ変更）
- [ ] 設定モーダル（家族コード表示・コピー・招待リンク共有）
- [ ] エクスポート / インポート JSON
- [ ] Google Maps CSV インポート（Stage 0 選択画面 + 取り込み）
- [ ] Gemini 子育て要約（POI ピン詳細）

### I-2. 新機能（スケジュール・メモタブ）
- [ ] 上部 3 タブ切替（familymap / schedule / memo）
- [ ] タブ選択が localStorage に永続化（PWA 再起動後も保持）
- [ ] スケジュールタブ：マンスリー表示、月送り、日付タップで日詳細
- [ ] 予定追加（タイトル・日時・ラベル）→ 即座にカレンダーに反映
- [ ] 予定編集・削除
- [ ] 「メモに保存する」トグル ON → スケジュールから消えてメモタブに出る
- [ ] メモタブ：カード一覧表示
- [ ] メモ追加・編集・削除
- [ ] チェックリスト型メモ：項目追加・ON/OFF・進捗表示
- [ ] 「メモに保存する」トグル OFF + 日時設定 → スケジュールタブへ昇格
- [ ] 別端末で同期確認（夫婦で同じ家族コード）

### I-3. データ整合性
- [ ] エクスポート JSON に events / labels が含まれるか（Stage 5 で要拡張）
- [ ] localStorage 移行（旧 prefs.listSubView の値域チェック）
- [ ] Firestore セキュリティルール正常動作

---

## J. メモ・備考

### J-1. 進捗管理
- P1' 完了時点：このファイル + index.html + CLAUDE.md + HANDOVER.md を 1 つの commit に
- 各 Phase 開始時に本ファイル「J-2. 進捗ログ」に追記

### J-2. 進捗ログ
- **2026-05-25 (9)**：**P6.4' 実装** = contenteditable ロールバック ＋ モーダル背景タップで blur ＋ ヘッダー統合。
  - ロールバック：iOS 17/18 系で contenteditable でもキーボードアクセサリビューが出ることが確定。P6.2'/P6.3' の workaround を全面撤回し `<input>` / `<textarea>` に復帰。`ced*` ヘルパー群と `setupAccessoryBarSuppression` 系を全削除、`.cedit` 系 CSS も削除
  - 背景タップで blur：`setupModalBackgroundBlur()` を新規追加、対象 7 モーダルで capture phase の click を監視、focus 中の input/textarea を `.blur()` + `e.stopPropagation()` で「キーボードのみ閉じる」UX を実現
  - ヘッダー統合：旧 in-panel `.sched-header` と `.memo-header` をグローバル header に集約。`.brand-sub` 内に schedule の月ピッカーと memo の件数バッジを格納、`[data-tab-only]` でタブ別表示切替。TODAY ‹ › も `.header-sched-nav` として header 直下
  - 規模：8779 → 8529（**-250 行**）。local commit のみ・未 push
- **2026-05-25 (7)**：**P6.2' 実装** = P-6 3 連結方式リファイン ＋ iOS Safari キーボードアクセサリビュー抑制（contenteditable 化）。
  - P-6：P6.1' 簡易案（隣月空白）を 3 連結方式に置換。`.sched-grid-track` に prev/current/next 3 パネルを同時レンダリング、`renderScheduleGrid()` ヘルパー切り出し、`addMonths()` 追加。スワイプ中 finger-track、commit 時 off-screen snap → 月切替 → transform reset で jump 無し
  - contenteditable：`<input>` / `<textarea>` を `<div contenteditable>` に置換（5 種：titleInput/memoInput/evTitleInput/evBodyInput/evCommentInput/checklist 項目/label name）。CSS `.cedit` `.cedit-multi` `.cedit:empty::before` 追加、JS `cedGet/cedSet/cedFocus/cedAttach/cedInitAll/cedUpdateEmptyState` ヘルパー導入。`syncHeaderActionToInput` 後方互換、チェックリスト Enter は capture phase で cedAttach の Enter=blur を上書き
  - 規模：8351 → 8638（+287 行）。local commit のみ・未 push。P6'+P6.1'+P6.2' を 1 セッションで一括 push 待ち
- **2026-05-25 (1)**：旧 P1（c412449）実装、`view-tabs` 内サブタブ拡張案。tag `pre-schedule-feature-2026-05-25` でバックアップ。
- **2026-05-25 (2)**：方針変更により旧 P1 を `p1-discarded-2026-05-25` で保管し、main を `pre-schedule-feature-2026-05-25` に reset。**新 P1' 着手**：上部 3 タブ並列ナビ＋既存 UI を familymap タブにラップ。データモデルは単一エンティティ + isMemo フラグ案に変更。本仕様書を新方針で全面書き直し。
- **2026-05-25 (3)**：**P2' 実装**。スケジュールタブのマンスリーカレンダー UI（月送り / TODAY / 日付タップ / ラベル色バー / FAB「+」）、日詳細スライドアップシート、予定エディタモーダル（タイトル・終日・日時・「メモに保存する」トグル・ラベル選択・本文）、予定詳細モーダル（編集・削除）。Firestore CRUD：`events/{eventId}` の `setDoc/deleteDoc/onSnapshot`、`familyConfig/labels` の `getDoc`→無ければ`setDoc`。`connectToFamily()` 末尾に `ensureDefaultLabels()` + `subscribeEvents()` 追加（pins は無改変）。規模 4495 → 5650（+1155）。local commit のみ・未 push。ユーザー次手動作業：Firebase Console で **events / familyConfig** へのセキュリティルール match ブロック追加（§ D）。
- **2026-05-25 (5)**：**P4' + P5' 実装 = 全 Phase 完了**。
  - **P4'**（commit `d449e02`、index.html 6250 → 7005、+755 行）：
    - メモタブのプレースホルダを **2 列カードグリッド + 件数ヘッダ + 右下「+」FAB** に置換。各カードは左 4px ラベル色バー、左上アバター（uid 頭文字）、メタ（更新日 YYYY/MM/DD）、ラベル色タイトル、本文プレビュー（4 行 ellipsis）or チェックリストプレビュー（先頭 4 件 + `N/M 完了済み`）。空状態は「メモはまだありません」誘導文付き
    - 予定エディタモーダルに **「チェックリストにする」トグル + 編集 UI** 追加（折りたたみ、ON 時に展開）。編集行は `[checkbox] [text input] [✕]`。Enter で次の行を自動追加（focus 移動付き）、Backspace で空行を削除（最低 1 行は残す）、`maxLength=200`
    - 予定詳細モーダル `#evDetailBg` の本文上に **`#evDetailChecklist`** を追加。`renderDetailChecklist` で `N/M 完了済み` + 各アイテム行を描画、行タップで `toggleDetailChecklistItem(eventId, itemId)` を呼び `updateDoc({ checklist: newList, updatedAt })` で局所書き込み（コメント追加と同じ安全パターン、optimistic UI + rollback）
    - `subscribeEvents` で `checklist` を defensive 正規化（`{id,text,checked}` 形式、id 無ければ uuid 生成）。`cloudWriteEvent` ペイロードにも `checklist` を追加（既存の comments/activities 同様、setDoc で正しく永続化）
    - **「メモに保存する」両方向遷移の完全実装**：メモタブ「+」FAB は `openEventEditor({ id: null, defaultMemo: true })` を呼び、`evMemoToggle` が ON 状態で開く（startAt 入力欄もグレーアウト）。トグル切替時に `evEditorTitle` の文字列も連動して切替（「メモを追加」←→「予定を追加」、編集時は「メモを編集」←→「予定を編集」）
    - `setActiveTopTab('memo')` と `subscribeEvents` の onSnapshot callback で `renderMemo()` 呼出を追加
    - スケジュール ↔ メモのデータ遷移は完全にトグルベース：トグル ON 保存で `isMemo:true` となり `isScheduledEvent` filter で弾かれてスケジュールから消え、`isMemoEvent` filter で memo タブに表示。逆も同様。データは消えない、ただ表示位置だけ変わる（TimeTree 流）
  - **P5'**（commit `cc4dbe8`、index.html 7005 → 7231、+226 行）：
    - 設定モーダル `#settingsBg` 内に **「スケジュール / メモのラベル」セクション** を追加。家族コードと招待・共有の間に配置
    - 各ラベル行は `[swatch] [name input] [✕]`。swatch タップで **12 色パレット** が展開（`LABEL_PALETTE` 定数、既存 6 色 + 6 色拡張）、色選択で即 `commitLabelEdit(idx, {color})`、パレット閉じる
    - 名前入力は focus 時に元値保持、blur 時に変更があれば即 `commitLabelEdit(idx, {name})`、Enter キーで blur
    - 削除ボタンは `labelsCache.length <= 1` の時 disabled。削除前に「このラベルが付いている予定・メモはラベルなしになります」を confirm
    - 下部に「**＋ ラベルを追加**」ボタン（`labelsCache.length >= LABEL_MAX (12)` で disabled）。未使用色を `LABEL_PALETTE` から優先選択
    - **全変更を `commitLabelsList(next)` 経由**：先にローカル更新 + 影響範囲の再描画（renderLabelMgmt / renderSchedule / renderMemo）→ `cloudWriteLabels(next)` で `setDoc(labelsDocRef, {labels:[], updatedAt})` → 失敗時はロールバック + alert
    - **`subscribeLabels()` 新規追加**：`onSnapshot(labelsDocRef())` で他端末のラベル変更が即反映。schedule / memo / editor / detail / settings の各セクションを必要に応じ再描画。`#labelMgmtList` 内の input にフォーカス中は再描画スキップで未保存入力を保護（focus loss & data race の防止）
    - `connectToFamily()` 末尾に `subscribeLabels()` 呼出を追加（`ensureDefaultLabels` の then 内）
    - **削除した labelId を持つ event のデータは無変更**：`getLabelById` が null を返し、`renderSchedule` / `renderMemo` / `openEventDetail` のいずれも grey フォールバックで安全に表示。次回編集でラベル再選択可
    - 統合動作確認（コードレベル）：
      - メモ ↔ 予定のトグル遷移（双方向、データ保存維持）
      - 繰り返し予定にラベル付与・変更が即反映（recurrence + label の独立性）
      - コメント・活動履歴がメモにも適用（イベントエンティティ共通）
      - ラベル変更が schedule グリッドのバー色・memo カードのタイトル色＋色バー・editor のチップ・detail のラベルバーに即時伝播
      - 既存機能（familymap タブ全機能 + listView + 設定の他セクション）への非干渉
    - CSS 追加：`.label-mgmt-list / -row / -swatch / -name / -del / -add / -palette`
  - **Firebase Console 追加作業は不要**（events / familyConfig のセキュリティルールは P2' 時点で追加済み、`familyConfig/labels` ドキュメントだけが新規だが同じ match ブロックで読み書きできる）
  - local commit 6 個蓄積（`c4f7961` / `35a3fdf` / `80cec9c` / `e77d6c2` / `d449e02` / `cc4dbe8`）、未 push。ユーザー手動テスト → 承認 → 一括 push 待ち
- **2026-05-25 (6)**：**P6' 実装 = UX 修正フェーズ完了**（local commit のみ・未 push）。ぐっちが iPhone 実機テスト後にフィードバックした 10 項目の UX 改善：A-1 位置情報初回限定 / B-1 メモトグル切替アニメ / B-2 ラベル選択タップ展開 / B-3 カレンダー vs 日詳細整合の defensive fix（多日 recurring 対応 + safety-net） / B-4 年月ピッカー / C-1 メモ専用エディタ / D-1 grip hit area 拡大 / P-1 保存ボタン accent / P-6 横スワイプ前後月 / P-7 複数日連続バー。規模：7231 → 8021（+790 行）。詳細は § G の P6' セクション。
- **2026-05-25 (4)**：**P3' 実装**。
  - **コメント**：予定詳細モーダル下部に「コメント」セクション（一覧 + textarea + 送信ボタン）。`updateDoc + arrayUnion` で events ドキュメント内 `comments` 配列に追記（既存 setDoc 系の event 書き込みと並行させても他フィールドを壊さない）。Optimistic UI（送信時に即ローカルに push し、失敗時のみロールバック）。送信成功は onSnapshot 経由で別端末にも即配信。
  - **繰り返し**：予定エディタに `ev-recur-row` + 折りたたみ詳細ブロック。`recurrence: { type: 'none'|'weekly'|'monthly', until: number|null }` を events doc に保存。マンスリー表示は `eventsOnDate()` が `__recurInstance: true` の仮想イベントを生成して描画（編集／削除は元の予定に作用）。`until` が指定された場合はその日 23:59:59.999 までを終端とする。月末跨ぎは `Date#getDate()` 一致でのみ展開（簡易仕様）。
  - **活動履歴**：events doc に `activities: [{id,userId,type,timestamp}]` を保持。`saveEvent` で 'created' / 'updated' を append、`renderActivityLog` で同一ユーザーの連続同 type を「×N」集約表示（TimeTree 風）。「あなた / 家族の誰か」で識別（user 名フィールド未実装のため uid 一致判定のみ）。
  - **影響範囲**：`subscribeEvents` の正規化、`cloudWriteEvent` ペイロード、`saveEvent` の活動 push、`eventsOnDate` の繰り返し展開、`openEventDetail` のセクション追加、init() のリスナー登録。既存 P2' の予定 CRUD ロジック（保存・編集・削除フロー）はそのまま動く。`comments` は `arrayUnion` 経路、それ以外は `setDoc` の単一書き込み経路で安全に分離。
  - **Firebase Console 追加作業は不要**（events / familyConfig のルールは P2' 時点で追加済み、サブコレクション化していないため）。
  - 規模：5650 → 6250（+600 行、HTML +30 / CSS +200 / JS +370 程度）。
  - local commit のみ・未 push（P5' 完了後にユーザー承認を得て一括 push）。

### J-3. 関連メモリ
- `family_map_gemini_proxy.md` — Cloudflare Worker 経由・gemini-2.5-flash
- `family_map_git_author.md` — ローカル限定 Claude author 設定

---

## P7.2'（2026-05-26、完了）— プロフィール周りの 5 件 UX 修正

**ステータス**：local commit のみ・未 push。P7' + P7.1' に重ねて適用。  
**規模**：index.html 9646 → 9874（**+228 行**、HTML 0 / CSS +29 / JS +199 程度）。

### 目的
ユーザー（ぐっち）が P7' / P7.1' を実機検証する中で報告した 5 件の UX 不具合を一括対応。プロフィール基盤の信頼性向上と、スケジュール／メモのモーダル UI 整理。

### (1) PWA 再起動時のプロフィール再要求問題
- **症状**：Safari で名前保存 → ホーム画面追加 → PWA 起動でプロンプトが再表示される。さらに Safari で設定したはずのプロフィールも見えない。
- **原因**：iOS Safari と PWA は localStorage が別領域。`family-map.profilePromptShown.v1` flag が Safari にだけ立つ → PWA からは flag が見えない → 再表示。さらに Safari で「あとで設定」を押した場合はそもそも Firestore に何も書かれていない（flag だけが立つ）。
- **修正**：`ensureProfileSetup()` を async 化し、判定階層を以下に変更：
  1. `myMember()` cache fast-path（早期 return）
  2. `getDoc(memberDocRef(uid))` で Firestore を確認 → `displayName` 非空ならプロンプトスキップ ＋ localStorage flag を backfill（既存コードへの互換）
  3. Firestore に doc が無い場合のみ、従来の localStorage flag をチェック（同一クライアントでの「あとで設定」を尊重）
  4. それも無ければ初回プロンプト表示
- Firestore アクセス失敗（permission-denied / network 切断）時は console.warn → localStorage flag フォールバックでロックアウト回避
- `membersCache.set` で `getDoc` 経由のデータも cache に seed して即座に `myMember()` が真を返すように

### (2) プロフィール画面：アイコンタイプ切替で名前が消える
- **症状**：表示名入力後にアイコンタイプ（文字 / 絵文字 / 色のみ）を切り替えると、入力済みの表示名が消える。
- **原因**：`renderProfileEditor()` が毎呼出時に `me = myMember()` から `profileEditorState.type` を含むすべてを再シードしていた。タブ click ハンドラは `profileEditorState.type = newType` → `renderProfileEditor()` を呼ぶが、その中で `me.avatar.type` から再上書きされる（type が revert）。さらに name input も `me.displayName || ''` で上書きされる（new user は空文字）。
- **修正**：
  - `renderProfileEditor(opts)` に `seedFromMember: false` オプション追加。`opts.seedFromMember !== false` のときだけ `me` から `profileEditorState` を再シード（外部 onSnapshot 経由の更新では従来通り再シード）。
  - タブ click ハンドラを 4 段に分解：①現在の input 値（name/initial/emoji）を snapshot → ②`profileEditorState.type` を新タブに更新 ＋ initial/emoji を `liveInitial/liveEmoji` で editorState に mirror → ③`renderProfileEditor({seedFromMember:false})` → ④name input を `liveName` で復元 ＋ `updateProfilePreview()`。

### (3) プロフィール保存後のフィードバックがない
- **症状**：プロフィール保存ボタンを押しても画面に何の変化もない（実際は保存されているが視覚 feedback 無し）。
- **原因**：`showHint()` を呼んでいるが、`#hint` 要素は `.map-wrap` 内（familymap タブの中、z-index 500）。設定モーダル（z-index 1000）の上に描画されないため、ユーザーには見えない。
- **修正**：新規に **app-wide toast** を実装：
  - CSS `.fm-toast`：`position: fixed; left: 50%; bottom: 72px + env(safe-area-inset-bottom); z-index: 2000; opacity: 0; transition: opacity 0.18s ease, transform 0.18s ease;`
  - JS `showToast(text, ms=1500)`：単一インスタンス（`_toastEl` を `document.body` 直下に lazy 生成→再利用）。reflow を強制してから `.show` を付与（連続呼出でも transition が常に走る）。
  - `saveMyProfile` と `saveProfilePromptForm` の成功 toast を `showToast('プロフィールを保存しました', 1500)` に切替（失敗時は従来の `alert()` のまま）。
- 既存の `showHint` は無改変（他箇所からは引き続き使用）。

### (4) 参加メンバープルダウンに他メンバーが出ない
- **症状**：家族の他メンバーがプロフィール設定済みでも、予定エディタの参加メンバープルダウンに自分しか出ない。
- **根本原因（調査結果）**：`renderMemberPickerList` が `Array.from(membersCache.values())` のみを source にしていた。`subscribeMembers()` は `families/{familyId}/members/*` を購読しているため、**そこに doc を書いた家族メンバーしか cache に入らない**。プロンプトを「あとで設定」で dismiss した家族メンバーや、P7' より前の版を使っている家族メンバー、あるいは Safari で flag だけ立てた状態の家族メンバーには doc が無い → cache 不在 → picker から見えない。さらにユーザー自身は最初の起動でプロンプトを保存している（ので self は cache に居る）→「自分だけ見える」状態になる。
- **修正**：UID source を以下の和集合に拡大：
  - `currentUid()`（self、必ず存在）
  - `membersCache.keys()`（profile doc がある人）
  - すべての `event.createdBy`（events にイベント作った人）
  - すべての `event.members[]`（他人を attendee に指定したものから観測される uid）
  - すべての `pin.createdBy`（pins から観測される uid）
- doc が無い UID は synthetic record（`__noProfile: true`）で fallback アバター（uid 頭文字）＋「（未設定）」ラベル付きで render。選択は可能。
- ソート順：①self → ②profile あり（alphabetical by displayName）→ ③profile なし（uid 頭文字でソート）。
- `events` / `members` snapshot 受信時に picker open なら `renderMemberPickerList()` を再呼出して live 更新。

### (5) スケジュール登録から「メモに保存する」トグルを削除
- **症状**：スケジュールタブから「+」FAB で開いた追加モーダルに「メモに保存する」トグルが含まれており、項目が多くて画面が縦に長い。ユーザーは「メモを書くならメモタブから書く」運用なので、スケジュール側にこの toggle は不要。
- **修正**：
  - `openEventEditor({scheduleLocked: true})` 新規オプション。`applyScheduleLockedMode(locked)` 関数で `evMemoRow` だけに `.memo-locked-hidden` を付与し toggle を OFF にロック（日時・繰り返し行は schedule で必要なので表示維持）。
  - `schedAddBtn` と `schedDayAddBtn` の click ハンドラに `scheduleLocked: true` を追加。
  - 既存予定編集時（`editingEventId` truthy）は `scheduleLocked` 適用条件 `&& !editingEventId` で打ち消し → 既存予定は従来通り toggle 見える（schedule↔memo 遷移を維持）。
  - データモデル上 `isMemo` フラグは残存（save 時に toggle 強制 OFF なので `isMemo: false` で保存）。
- メモタブからの追加（`memoLocked: true`）は P6' C-1 のまま無改変。

### 非干渉確認
- familymap タブ全機能 / listView / 地図 / Gemini 要約 / pins CRUD / メモタブ「+」FAB（`memoLocked` 経路）/ メモ既存編集 / コメント / 繰り返し / 活動履歴 / チェックリスト / ラベル管理 / 設定モーダルの他セクション / P-6 3 連結スワイプ / マンスリー連続バー（P-7） すべて DOM/ロジック無改変。
- `applyMemoLockedMode` は P6' C-1 のまま無改変。`applyScheduleLockedMode` は新規。両者は独立に呼ばれる。

### 検証
- JS シンタックス：`node --check` で clean（232043 chars の inline モジュール）。
- HTML タグバランス：div 284/284 / section 3/3 / button 112/112 すべて一致。

### push 戦略
- P7' + P7.1' + P7.2' をまとめてユーザー承認後に push（commit メッセージは P7.2' 単独）。
- 全体としては P6' 〜 P7.2' まで未 push 分が累積している。一括 push 時に GitHub Pages が自動デプロイ → iPhone Safari でキャッシュ無効化（設定 → Safari → 履歴と Web サイトデータを消去）→ 動作確認の順。

---

## P7.3'（2026-05-27、完了）— 参加メンバー bottom-sheet z-index 修正 + メモ保存トグル完全非表示

**ステータス**：local commit のみ・未 push。P7' + P7.1' + P7.2' に重ねて適用。
**規模**：index.html 9874 → 9918（**+44 行**、HTML +12 / CSS +18 / JS +14 程度）。

### 目的
P7.2'（commit `130455f`、push 済）の追加バグ修正。ユーザー（ぐっち）から以下 2 件の追加報告：
1. 予定エディタで「参加メンバー」trigger をタップ → ピッカーが出ない／編集モーダルを ✕ で閉じると遅れて picker が出てくる
2. メモ追加モーダルから「メモに保存する」トグルを完全に削除（メモ ↔ 予定の昇格動線は実用していない）

### (1) 参加メンバー bottom-sheet の表示タイミング異常
- **症状**：trigger タップで視覚的な押下フィードバックは出るが、ピッカーの選択肢が画面に出ない。編集モーダルを ✕ で閉じた直後に「参加メンバーを選ぶ」ウィンドウが遅れて表示される
- **真因（コードリーディングで特定）**：
  - `.modal-bg` は共通 CSS で `z-index: 1000` 固定。`#evEditorBg`（line 4004）と `#memberPickerBg`（line 3663）は同じ z-index で、DOM 順では editor のほうが後にある
  - CSS の painting 規則：同 z-index・同 stacking context では**後の兄弟が前の兄弟の上に描画される**
  - 結果、`openMemberPicker()` で picker に `.open` が付いても、editor がその上に被さって視覚的に見えない
  - ユーザーが editor を ✕ で閉じると `.open` が外れて `display:none`、picker だけが残る → 「遅れて出てくる」体感
- **修正**：
  - 新 CSS rule：`#memberPickerBg, #profilePromptBg { z-index: 1500 }` を `.modal-bg` の下に追加
  - 理由・選定値：toast（`.fm-toast` z-index 2000）の下、通常モーダル（z-index 1000）の上に明示的なレイヤーを切る。1500 は中間値で他に予約なし
  - profile prompt も同じレベルに上げた根拠：万一設定モーダル内から初回プロンプトが triggered される将来パスに備える（現状は connectToFamily 直後のため重複ケースはレアだが、防御的に整える）
- **補強**：
  - `openMemberPicker()` に追加処理：
    - (a) 直前にフォーカスされている `<input>` / `<textarea>` を `.blur()` で外す → iOS キーボードを閉じてから picker が登場（キーボードに picker の下端が隠れる事故を防ぐ）
    - (b) `renderMemberPickerList()` を picker `.open` 付与の**前に同期実行**するコメントを明示化（既に既存挙動だがコード意図を明文化）
- **既存の picker 関連挙動はすべて維持**：
  - `setupModalBackgroundBlur` 対象に `#memberPickerBg` 含む（P6.4'）
  - `setupSwipeToClose` の `data-swipe-close="memberPickerBg"` グリップ（P7'）
  - capture-phase click listener `if (e.target.id === 'memberPickerBg') closeMemberPicker(false)`（P7'）
  - subscribeMembers / subscribeEvents の picker open 時の再描画（P7.2' (4)）
- **z-index ピラミッド整理**：
  - `.fm-toast` … 2000（最上位、ユーザーフィードバック）
  - `#memberPickerBg`, `#profilePromptBg` … 1500（モーダル on モーダル）
  - `.modal-bg`（その他 7 種）… 1000
  - 通常 UI（ヘッダー、FAB 等）… 100 以下

### (2) メモ追加モーダルから「メモに保存する」トグル削除
- **症状（ユーザー報告）**：メモ追加時に「メモに保存する」項目が出ているが、メモ ↔ 予定の昇格／降格動線は実用していない。完全に消したい
- **方針判断**：
  - メモタブ「+」FAB → isMemo=true で保存
  - スケジュールタブ「+」FAB → isMemo=false で保存
  - 既存予定／メモの編集時は元の isMemo を維持
  - これらは toggle UI が無くてもプログラム的に `setToggleState(memoBtn, ...)` で確定するため、UI から完全に消しても動作整合性は保たれる
- **修正**：
  - HTML：`<div class="ev-memo-row" id="evMemoRow" style="display:none;" aria-hidden="true">` に変更（inline style で常時非表示）
  - `<button id="evMemoToggle">` は DOM 残置（`saveEvent` が `getToggleState(memoBtn)` を読むため必須）
  - `applyMemoLockedMode` / `applyScheduleLockedMode` の `evMemoRow` への class 操作は無改変（inline style が常に勝つので影響なし）
  - `evMemoToggle` の `onclick` ハンドラ（line 9453）も無改変（要素が tap 不可能なので dead code 化、将来復活余地として残置）
- **データ整合性の検証**：
  - 新規メモ（memo FAB）：`opts.defaultMemo=true && opts.memoLocked=true` → `setToggleState(memoBtn, true)` × 2（冗長だが ON）→ `saveEvent` で `isMemo=true` 保存
  - 新規スケジュール（schedule FAB）：`opts.scheduleLocked=true && !editingEventId` → `applyScheduleLockedMode(true)` → `setToggleState(memoBtn, false)` → `saveEvent` で `isMemo=false` 保存
  - 既存メモ編集：`setToggleState(memoBtn, ev.isMemo === true)` で復元 → `saveEvent` で同値保存
  - 既存スケジュール編集：同上、`isMemo=false` 維持
- **CSS specificity 注意**：
  - `.memo-locked-hidden { display: none !important }` が `evMemoRow` に動的に付くケースあり（`applyMemoLockedMode(true)` 時）
  - inline `style="display:none"` は `!important` 無し → `!important` クラスより弱い、が、値が同じ `display:none` なのでどちらが勝っても結果は不変
  - `applyMemoLockedMode(false)` で class が remove されても inline style が継続して非表示を保証

### 非干渉確認
- familymap タブ全機能 / listView / pins CRUD / Gemini 要約 / 予定 CRUD（保存・読込・onSnapshot）/ メモ CRUD / コメント / 繰り返し / 活動履歴 / チェックリスト / ラベル管理 / プロフィール画面 / 初回プロンプト / 参加メンバー選択（z-index 修正後の正常動作）/ ピン作成者表示 / 3 連結スワイプ / P6.4 モーダル背景タップ blur / P-1 動的保存ボタン / P-7 連続バー / setupModalBackgroundBlur / setupSwipeToClose すべて DOM/ロジック無改変
- 唯一の挙動変更は (1) z-index による視覚的階層整理と (2) `#evMemoRow` の常時非表示化のみ。下層データモデル（events.isMemo フラグ）は無改変

### 検証
- JS シンタックス：`node --check` で clean（232740 chars の inline モジュール）
- HTML タグバランス：div 209/209 / section 3/3 / button 94/94 / span 59/59 / header 1/1 / nav 1/1 すべて一致

### push 戦略
- P7' + P7.1' + P7.2' + P7.3' をまとめてユーザー承認後に push
- 直前 push 済 commit は `130455f`（P7.2'）。P7.3' は local の単独 commit として積む
- 一括 push 時に GitHub Pages が自動デプロイ → iPhone Safari + PWA でキャッシュ無効化 → 動作確認の順

---

## P8'（2026-05-28〜、設計完了・実装未着手）— Google 認証移行 + 複数カレンダー連携 + 当日通知

**ステータス**：設計フェーズ完了（agent thread `adf347ac194abc593` のドラフトを正本とする）、実装未着手・local commit/push なし。  
**目的**：family-map を「家族の総合ツール」化する仕上げとして、(A) Google 認証への移行と既存匿名 uid のマイグレ、(B) 外部 Google カレンダーの複数連携と TimeTree 風フィルタチップ UI、(C) 当日通知（Cloudflare Worker cron）を 3 サブステージで実装する。**全 7 論点の判断はぐっち（2026-05-28）から確定済み**。

### 全体方針
- **3 サブステージ分割**：P8'-A → P8'-B → P8'-C の順で実装、各サブステージ完了で独立 push（承認後）
- **Cloudflare Worker proxy 中心**：OAuth refresh token / FCM 配信キー / Gmail API 等のサーバ側秘匿要素はすべて Worker secret 化し、クライアント（PWA）にはトークンを置かない（既存 `family-map-gemini` Worker と同じ構成方針）
- **既存匿名 uid との後方互換**：強制マイグレーションだが、events.createdBy / pins.createdBy / members.{authUid} / events.members[] に残っている旧 uid を新 Google uid に書き換える batch を Worker から実行
- **HTML 分割は当面しない**：単一 `index.html` 維持を仮置き、P8'-B-2（events 紐付け＋初回同期エンジン）の実装規模が見えた時点で再判断（10000 行を超えたら分割を真剣に検討）

### 確定した論点 1-7（2026-05-28 ぐっち判断）

| # | 論点 | 決定 |
|---|---|---|
| 1 | OAuth refresh token の保存先 | **Cloudflare Worker proxy（`family-map-gcal` 新設）の Secrets** |
| 2 | カレンダー表示 ON/OFF 状態 | **per-user（`families/{familyId}/userCalendarPrefs/{authUid}` コレクション）** |
| 3 | 削除同期のデフォルト | **ON + source 単位で OFF 可、OFF 時は orphan フラグ警告つき** |
| 4 | マイグレーション | **強制**（キャンセル不可、「Google アカウントで引き継ぎ」ボタンのみ） |
| 5 | 下準備パッチの詳細 | specialist 推奨どおり（+30 行、デバッグ情報セクション含む、Firebase Console 作業は本番パッチ直前、Firestore ルール変更は本番パッチで） |
| 6 | TimeTree UX 確証 | 公式 LP 2026-01-19 / Help 2026-01-13 で確証取得済み（下記 § TimeTree UX 確証） |
| 7 | HTML 分割 | **SPEC 上は「単一 HTML 維持を仮置き」と明記、P8'-B-2 実装時に再判断** |

### TimeTree UX 確証（公式情報 2026-01）

- **統合ビュー名**：「Home Calendar」（旧 All Calendars、2026-01-19 公式 LP 改訂）
- **フィルター UI**：画面上部のチェック式フィルター（カラーチップ／チップに近い）、右上トグルで「利用頻度順並び替え」可
- **ナビゲーション**：画面下部タブ（Home Calendar / More）
- **カラー設計**：カレンダー自体にテーマカラー、ラベル色併用可
- **外部カレンダー（Google 等）**：元の色に近い色に自動調整される（つまり Google 側の colorId を尊重して吸い上げる方針が公式 UX に整合）
- **1 アカウント最大 20 カレンダー**
- **specialist 事前設計（カラーピル方式・per-user 表示状態・source 単位色分け）は公式 UX と方向性一致** → 大きな書き直しは不要
- **追加採用**：calendar source 追加時のデフォルトカラーを Google 側 `colorId` から引き継ぐ（ユーザーは後から変更可）

---

### P8'-A — 永続認証への移行 + 既存匿名 uid マイグレーション（**2026-05-30 完了**）

**目的**：Firebase 匿名認証 → 永続認証へ移行し、家族の既存 events / pins / members に残っている匿名 uid を新 uid にバッチ書き換えする。当初は Google OAuth を想定していたが、iOS PWA standalone の構造的制約により **Email/Password に方針転換** → 採用。**強制マイグレーション**（キャンセル不可、引き継ぎボタンのみ）。

#### 設計判断：M1=C 採用
- 過去議論で M1=A（家族コード再共有）、M1=B（家族コード継続 + uid 個別マッピング）、M1=C（下準備パッチ + 本番マイグレパッチの 2 段構え）の 3 案を比較
- 採用：**M1=C**（家族コードは継続、legacyUid を localStorage に保存した状態を観測してから本番マイグレを投入）
- 理由：①ユーザー操作なしで legacyUid 取得できる、②家族コード再入力不要（family-map の重要 UX 制約）、③ legacyUid が確実に永続化されてから本番投入できる

#### サブステージ P8'-A-1：下準備パッチ（完了、commit `b467237`、push 済）
- **スコープ内**：
  - `init()` 末尾で現在の Firebase 匿名 uid を `localStorage['family-map.legacyUid']` に保存
  - `families/{familyId}/members/{authUid}` ドキュメントに `legacyUid: authUid` フィールドを追記（クライアント側 setDoc merge）
  - 設定モーダル末尾に「デバッグ情報」セクション（折りたたみ式、`<details>`）を新設：currentUid / legacyUid / familyId / membersCache の size 等を表示。ぐっちが iPhone から状態を確認できるように
  - Firebase Console 作業は**不要**（既存 members ルールでカバー、新コレクション無し）
  - Firestore ルール変更も**不要**（既存ルールのみ）
- **規模**：+30 行（HTML +5 / CSS +5 / JS +20）
- **結果**：legacyUid が localStorage と Firestore members 両方に保存されることを実機検証で確認。後段（P8'-A-2 → P8'-A-3）で `runUidMigration(legacyUid, newUid)` の client-side マイグレ起動条件として活用された

#### サブステージ P8'-A-2：Google OAuth 認証（**撤回**）

**結論**：iOS PWA standalone と通常 Safari の IndexedDB / Cookie scope 分離により**動作不能**。撤回。

**実装した内容**（commit `550baa7`、push 済、後に内容を P8'-A-3 で全面書き換え）：
- Google OAuth プロバイダ有効化（Firebase Console 手動作業実施済）
- 「Google アカウントで引き継ぎ」モーダル + `signInWithPopup(GoogleAuthProvider)` / `signInWithRedirect` / `getRedirectResult` の自動切替
- `runUidMigration(legacyUid, newUid)` で client-side マイグレ（getDocs + updateDoc 走査、idempotent）
- 設定モーダルに「アカウント」セクション + サインアウトボタン

**動かなかった理由（実機検証で確定）**：
- iOS Safari は PWA standalone と通常 Safari でブラウジングコンテキスト（IndexedDB / Cookie scope）を**分離**する仕様
- PWA → `signInWithRedirect` → Safari で Google 認証成功 → `__/auth/handler` 経由で PWA に戻る → **credential は PWA scope に届かない**
- `getRedirectResult` が空 / `onAuthStateChanged` で user 未取得 → 再びログインモーダル → **無限ループ**
- Safari 通常タブで開けば動くが、ぐっちは PWA からの利用が主体（家族向け運用前提）

**追加で試した修正**（commit `b7f7511`、push 済、これも撤回）：
- iOS PWA 検知（`navigator.standalone === true` + display-mode `standalone`）→ 「Safari で開く」ボタンを出す UI
- `window.location.href = 公開URL` で外部 Safari への切替を期待
- 実機検証結果：**iOS は PWA → 外部 Safari への BrowsingContext 切替を許さない**（同一 PWA scope 内に留まる）→ 切替動作せず

**教訓（同じ轍を踏まないために）**：
- Google OAuth / Apple Sign In などの **redirect ベースの認証**は iOS PWA standalone で原理的に動かない（Firebase に限らず）
- iOS PWA で永続認証を持つには **redirect しない方式**（Email/Password、Custom Token、Anonymous → Custom claim の付け替え等）が必須
- 横断的教訓は `C:\AppDev\SHARED.md` § 12「解決策（2026-05-30 確定）」サブセクションに記載

**Firebase Console 設定**（P8'-A-2 投入時に実施、撤回後も**残置**）：
- Authentication → Sign-in method → Google **有効化済**
- OAuth consent screen / Authorized domains 設定済（`examrx79bd03-star.github.io` 含む）
- これらは P8'-A-3 採用後も無害（呼び出されないだけ）。将来 PC / Safari 通常タブ用に Google を復活させる場合はそのまま使える

#### サブステージ P8'-A-3：Firebase Email/Password 認証（**採用**、commit `3e96adb`、push 済）

**採用理由**：
- `signInWithEmailAndPassword` / `createUserWithEmailAndPassword` / `sendPasswordResetEmail` は `Promise<UserCredential>` を**直接返し redirect を伴わない**
- PWA / Safari コンテキスト分離問題が**原理的に起きない**
- iOS PWA standalone でログイン状態が**永続化**される（IndexedDB の `firebaseLocalStorageDb` に session が保存され、再起動でも継続）
- パスワードリセット機能も内蔵（`sendPasswordResetEmail`）

**実装内容**：
- HTML 全面再設計：`#googleLoginBg` / `#googleLoginIosPwa` 削除、`#authLoginBg` を 2 タブ構成（ログイン / 新規登録）に
  - ログインフォーム：メール + パスワード（表示/隠すトグル）+ ログインボタン + 「パスワードを忘れた」リンク
  - 新規登録フォーム：メール + パスワード（6文字以上）+ パスワード確認 + 「アカウントを作成」ボタン
  - エラー表示 `#authLoginError`（赤）、情報表示 `#authLoginInfo`（緑、パスワードリセット成功時）
- CSS：`.google-login-*` → `.auth-login-*` / `.auth-tabs` / `.auth-tab` / `.auth-form` / `.auth-field` / `.auth-password-wrap` / `.auth-password-toggle` / `.auth-submit-btn`
- JS imports 差し替え：削除 `GoogleAuthProvider` / `signInWithPopup` / `signInWithRedirect` / `getRedirectResult`。追加 `signInWithEmailAndPassword` / `createUserWithEmailAndPassword` / `sendPasswordResetEmail`
- 関数追加：`showAuthLoginModal` / `setAuthMode('login'|'signup')` / `formatAuthError(e)`（Firebase エラーコードを日本語化）/ `startEmailPasswordSignIn` / `sendPasswordReset`
- 関数削除：iOS PWA 検知ヘルパー（`isPwaStandalone` / `isIOS` / `isIosPwaLoginBlocked` / `openInSafari`）と `signInWithGoogle` 系一式
- `initCloud()`：`getRedirectResult(fbAuth)` drain を削除（redirect 経路なし）、`onAuthStateChanged` の `!user || isAnonymous` 分岐で `showAuthLoginModal()` を呼ぶ。サインイン後 `currentAuthProvider === 'password'` で `runUidMigration` を起動
- `handleSignOut()`：確認メッセージを「同じメールアドレスで再ログイン」に変更
- マイグレーション再利用：`runUidMigration(legacyUid, newUid)` は無改変（provider 非依存）
- 「パスワードを忘れた」UX：メール欄に入力 → リンクタップで `sendPasswordResetEmail` 呼出 → 成功時「再設定メールを送信しました」、失敗時は日本語化エラー
- 新規登録 UX：パスワード 6 文字未満 / パスワード（確認）不一致 はクライアントで弾く、submit 中は disabled

**iOS PWA 検知ロジック削除の根拠**：
- Email/Password は redirect しないため、PWA / Safari コンテキスト分離問題が原理的に起きない
- `isPwaStandalone` / `isIOS` / `openInSafari` などのヘルパーは完全に obsolete → 削除

**5 回のマイグレ実行**（手動 live run、`_scripts/migrate-uids.mjs` 経由）：
1. 6 個の旧 anonymous uid → `53iGd…`（PWA 削除事故後の応急復旧）
2. `53iGd…` → `Btk15JJ…`（PWA 再削除で再分裂）
3. `Btk15JJ…` → `HGJsABwfqPa…`（Safari Google ログインで再発行）
4. （スキップ）
5. `HGJsABwfqPa…` → **`qj3Se1s57UXEGcfseSavERbtHUw2`**（Email/Password 採用後、最終 uid）

**最終的に確定した方針**：
- 認証は **Firebase Email/Password** のみ（Google 認証は完全廃止、HTML/JS から削除）
- 家族メンバーごとに**別アカウント**で運用（夫婦＋娘で個別 uid、当初の「1 アカウント共有」案は撤回）
- ぐっちの uid：`qj3Se1s57UXEGcfseSavERbtHUw2`（displayName「ねぇねぇと呼ばれる人 🌻」）
- 妻・娘は今後 Safari から新規登録予定。家族コード `VNWMGUF94G` を入力して参加
- 新規家族メンバー向けガイドは `_scripts/family-member-onboarding.md`

**Firebase Console 作業（実施済）**：
1. Authentication → Sign-in method → **Email/Password を有効化**
2. Authentication → 承認済みドメインに `examrx79bd03-star.github.io` 含む（既存、無改変）
3. Firestore セキュリティルールは現状維持（`request.auth != null` だけで Email/Password でも動作）

**残課題（次セッション以降）**：
- パスワードリセットメールの送信者名 / Action URL カスタマイズ（任意、Firebase Console → Authentication → Templates）
- パスワード変更 UI（設定モーダル内、`updatePassword` + reauthenticate）
- multi-provider linking（将来 Google も並存させたくなったら `linkWithCredential` で同一 uid に複数 provider 紐付け、ただし iOS PWA では Google は動かないので PC/Safari 通常タブ用のオプション止まり）

---

### P8'-B — 複数 Google カレンダー連携 + TimeTree 風 UI

**目的**：Google カレンダー（個人の予定、家族の予定、業務 b 案件カレンダー等）を **複数** family-map に同期表示する。TimeTree の Home Calendar 風にカラーチップフィルタで切替。

#### 全体規模見積もり
- 4 サブステージ合計：**+900〜1300 行**
- 各サブステージで独立 commit、独立 push（承認後）
- **HTML 分割判断**：P8'-B-2 実装時点で index.html が 10000 行超えなら別ファイル分割を真剣検討、それ未満なら単一維持

#### サブステージ P8'-B-1：calendarSources モデル + Cloudflare Worker proxy + OAuth incremental
- **スコープ内**：
  - 新 Firestore コレクション `families/{familyId}/calendarSources/{sourceId}`：
    ```js
    {
      provider: 'google',
      googleCalendarId: string,       // primary or other calendar id
      displayName: string,
      color: string,                  // hex、Google colorId から初期値、ユーザー変更可
      ownerAuthUid: string,           // 接続したユーザーの uid（refresh token は Worker 側 secret）
      syncEnabled: boolean,
      syncDeletion: boolean,          // 削除同期 ON/OFF（デフォルト ON、論点 3）
      lastSyncedAt: number,
      syncToken: string | null,       // Google API incremental sync token
      createdAt: number,
      updatedAt: number
    }
    ```
  - 新 Cloudflare Worker `family-map-gcal`（独立 Worker、`family-map-gemini` とは別）：
    - secrets：`GOOGLE_OAUTH_CLIENT_ID`、`GOOGLE_OAUTH_CLIENT_SECRET`、ユーザー単位の refresh token を KV / D1 / Durable Object に保存（量が増えたら）
    - エンドポイント：
      - `POST /oauth/start` → Google OAuth URL を返す（PKCE 付き）
      - `POST /oauth/callback` → code → refresh token + access token、refresh token を Worker storage に保存、access token を一時返却
      - `POST /list-calendars?authUid=...` → user's Google Calendar list（refresh token 経由で access token 取得して Google API 叩く）
      - `POST /sync-calendar?sourceId=...` → 単一 source の events を fetch（syncToken でインクリメンタル）、返却
    - Origin チェック：`https://examrx79bd03-star.github.io` のみ
  - 設定モーダルに「カレンダー連携」セクション：
    - 「+ Google カレンダーを追加」ボタン → Worker `/oauth/start` を popup window
    - 接続済み source の list 表示（displayName / color swatch / 同期 ON/OFF / 削除ボタン）
- **スコープ外**：
  - events 紐付け（B-2）
  - 初回同期（B-2）
  - フィルタチップ UI（B-3）
  - 削除同期（B-4）
- **規模見積もり**：HTML +80 / CSS +60 / JS +200 / Worker コード ~500 行（新規）
- **テスト観点**：
  - 「+ Google カレンダーを追加」→ popup で Google OAuth → 認可後 popup 自動 close → 設定モーダルに新 source が追加表示される
  - calendarSources/{sourceId} ドキュメントが Firestore に作成される
  - Worker storage（KV 等）に refresh token が保存される（ぐっちは目視確認不可、Cloudflare ダッシュボードログから確認）
  - 接続済み source の削除ボタン → Worker からも refresh token を削除（revoke は best effort）
  - 1 家族で複数の Google カレンダー（個人カレンダー + 家族カレンダー + 業務カレンダー等）を接続できる

#### サブステージ P8'-B-2：events 紐付け + 初回同期エンジン
- **スコープ内**：
  - 既存 `events/{eventId}` doc に `sourceId: string | null` フィールド追加（null = family-map ネイティブ、`sourceId` あり = 外部カレンダー由来）
  - 新規 `externalEventId: string | null`（Google Calendar の event id）
  - 新規 `syncMeta: { lastSyncedAt, etag, ... }` フィールド
  - 初回同期エンジン：calendarSources の各 source について Worker `/sync-calendar` を叩き、返ってきた events を family-map の events コレクションに upsert（Google event id ベースで冪等）
  - 30 分間隔で **throttled** 自動同期（クライアント側タイマー、PWA フォアグラウンドのみ）
  - 「手動再同期」ボタン（カレンダー連携セクション内、source 単位）
  - **HTML 分割再判断ポイント**：このサブステージ実装時に index.html 行数を測り、10000 行超えるか確認 → 超えるなら分割設計に切替、未満なら単一維持
- **スコープ外**：
  - フィルタチップ UI（B-3）
  - 削除同期（B-4）
  - family-map → Google の双方向同期（B-2 では Google → family-map の one-way のみ、双方向は将来検討）
- **規模見積もり**：HTML +30 / CSS +20 / JS +400 / Worker 拡張 ~200 行
- **テスト観点**：
  - 接続済みカレンダーの予定が初回同期でスケジュールタブに出てくる
  - 30 分後に自動再同期され新規予定が追加されている
  - 手動再同期ボタンで即座に最新化される
  - Google 側で予定を編集 → 同期後 family-map 側も更新（incremental sync token 経由）
  - 重複登録されない（Google event id ベースで idempotent）

#### サブステージ P8'-B-3：フィルタチップ UI + userCalendarPrefs per-user + Google colorId 吸い上げ
- **スコープ内**：
  - 新 Firestore コレクション `families/{familyId}/userCalendarPrefs/{authUid}`（**論点 2 確定**：per-user 状態）：
    ```js
    {
      visibleSourceIds: string[],     // 表示 ON の source id list
      pinnedSourceIds: string[],      // ピン留めしたい source（先頭に出す）
      sortOrder: 'frequency' | 'manual' | 'name',
      updatedAt: number
    }
    ```
  - スケジュールタブ上部にフィルタチップ行（TimeTree Home Calendar 風）：
    - 各 calendarSource + family-map ネイティブを 1 つのチップとして表示
    - チップは `[color swatch] [displayName] [✓ or □]`
    - タップで visibleSourceIds から add/remove
    - 右上にトグル「利用頻度順並び替え」
  - **Google colorId 吸い上げ**：calendar source 追加時に Google API の `colorId` を取得し、それに最も近い hex を `color` フィールドに自動 set（ユーザーは後から `displayName/color` を編集可）
  - メモタブには影響なし（メモは family-map ネイティブのみ）
- **スコープ外**：
  - 削除同期（B-4）
  - source ごとの色を Google 側に反映（family-map → Google 同期は B-2 で除外済み）
- **規模見積もり**：HTML +50 / CSS +80 / JS +250
- **テスト観点**：
  - フィルタチップで個別 source を ON/OFF → カレンダーグリッドのバーがリアルタイムで filter される
  - 別端末（夫の端末で OFF した source）でも自分の visibleSourceIds は変わらない（per-user 検証）
  - チップの並び替えがユーザー毎に保存される
  - 新規カレンダー接続時に Google 側の色味と近い色がデフォルトになる
  - 「利用頻度順並び替え」トグルで頻度順／登録順を切替できる

#### サブステージ P8'-B-4：削除同期（source 単位 ON/OFF、デフォルト ON）+ 30 分 throttled + 手動再同期
- **スコープ内**：
  - **論点 3 確定**：削除同期はデフォルト ON、source 単位で OFF 可
  - calendarSources doc の `syncDeletion: boolean` フィールド（デフォルト true）
  - source 設定 UI に「削除同期」トグル
  - OFF 時：Google 側で削除された event を family-map 側で**保持**するが、`orphan: true` フラグを付与し、UI 上で「⚠️ Google 側で削除済み」バッジ表示
  - orphan 警告：詳細モーダルに「このイベントは Google カレンダー側で削除されています。手動で削除しますか？」ボタン
  - 30 分間隔の自動同期に削除検知も含める（Google API の `showDeleted=true` パラメータ）
  - 手動再同期ボタンで即座に削除を検知
- **スコープ外**：
  - family-map → Google の双方向同期
  - 完全な復元機能（orphan の Google 側復元）
- **規模見積もり**：HTML +20 / CSS +20 / JS +150
- **テスト観点**：
  - 削除同期 ON：Google 側で予定削除 → 30 分後 or 手動再同期で family-map 側からも消える
  - 削除同期 OFF：Google 側で予定削除 → family-map 側に残る + ⚠️ バッジ
  - orphan の手動削除ボタンで family-map 側からも消える
  - orphan の手動 unflag ボタン（誤って削除同期 OFF にして消えなくなった場合の救済）

---

### P8'-C — 当日通知（Cloudflare Worker cron + FCM）

**目的**：当日の予定を朝に通知する（家族向け、夫婦＋娘の端末）。FCM 経由で iOS PWA に通知配信。

**前提**：P8'-A 完了（Google 認証で安定した uid）、P8'-B 完了（events に Google カレンダー由来も含めて統合済み）

#### スコープ内
- Service Worker（既存 PWA に新規追加、`service-worker.js`）
  - FCM の Web Push を受信して `notification.show()`
  - 通知タップで family-map を開く（特定 event の詳細モーダルを `?eventId=...` で起動）
- 新 Cloudflare Worker `family-map-notifier`（独立 Worker）
  - cron trigger（毎朝 7:00 JST、Cloudflare cron でスケジュール）
  - Firestore REST API + JWT 認証（Service Account の private key で署名）
  - 各家族の events から本日該当の予定を抽出
  - 各メンバーの FCM トークンに対して送信
  - FCM 配信は Worker 内で `https://fcm.googleapis.com/v1/projects/family-map-c5110/messages:send` を直叩き（Service Account JWT で auth）
- 新 Firestore コレクション `families/{familyId}/fcmTokens/{authUid}`：
  ```js
  {
    token: string,
    platform: 'web-push' | 'ios-pwa',
    enabled: boolean,
    updatedAt: number
  }
  ```
- 設定モーダルに「通知設定」セクション：
  - 「当日の予定を朝 7 時に通知」トグル
  - ON にすると `Notification.requestPermission()` → FCM token 取得 → Firestore に保存
  - 通知時刻はユーザー毎に変更可（朝の通知時刻ピッカー）
  - 「テスト通知を送る」ボタン（即座に Worker `/send-test?authUid=...` を叩いて検証）

#### スコープ外
- iOS PWA で FCM が動作しない場合のフォールバック（Apple は iOS 16.4+ で Web Push 対応、ぐっちの端末を確認する必要あり）
- 通知の細かいカスタマイズ（音、振動、通知グルーピング等）
- 当日以外の通知（明日／1 週間先／カスタム時刻オフセット）
- 家族外への通知配信

#### 規模見積もり
- HTML +30 / CSS +30 / JS +200 / Service Worker ~100 行 / Worker コード ~600 行

#### テスト観点
- 通知設定 ON → 当日朝 7 時に予定がプッシュ通知で届く
- 通知タップで family-map が起動し、該当 event の詳細モーダルが開く
- テスト通知ボタンで即座に通知が届く
- 当日予定がゼロの日は通知が来ない
- 夫婦両方の端末で独立に通知が届く（per-user FCM token）
- 通知 OFF で Firestore の fcmTokens.enabled = false になり通知が止まる
- iOS PWA でも通知が届く（Apple iOS 16.4+ 検証必須）

#### Cloudflare Console 作業（実装直前）
1. 新 Worker `family-map-notifier` 作成
2. cron trigger 設定（`0 22 * * *` UTC = 7:00 JST）
3. Service Account の private key を Worker secret に格納（`FIREBASE_SERVICE_ACCOUNT_JSON`）
4. FCM 用の Firebase Cloud Messaging API を Firebase Console で有効化（既に有効化済みの可能性あり、要確認）

---

### P8' 全体の commit / push 戦略
- 各サブステージ完了で独立 commit、ユーザー承認後に独立 push（一括ではない）
- commit メッセージ規則：
  - `feat(family-map): P8'-A-1 add legacyUid storage prep patch`
  - `feat(family-map): P8'-A-2 migrate anonymous uid to Google OAuth (forced)`
  - `feat(family-map): P8'-B-1 add calendarSources model + family-map-gcal worker`
  - `feat(family-map): P8'-B-2 add events sourceId linkage + initial sync engine`
  - `feat(family-map): P8'-B-3 add filter chips + per-user prefs + Google colorId import`
  - `feat(family-map): P8'-B-4 add deletion sync (per-source toggle, orphan warning)`
  - `feat(family-map): P8'-C add daily notification (FCM + worker cron)`
- 各サブステージ間に十分な実機検証期間を取る（特に P8'-A-1 → P8'-A-2 は 1 週間）
- Cloudflare Worker / Firebase Console の手動作業は各サブステージの実装パッチ投入**直前**に実施（実装後に Console 作業を忘れて permission-denied で動かないリスクを排除）

### P8' 全体の HTML 分割再判断ポイント
- **P8'-B-2 実装時**：index.html の行数を測り、10000 行を超えるかチェック
  - 超える：別ファイル分割を真剣に検討、`schedule.js` `members.js` `calendars.js` 等の独立 ESM ファイル化を設計
  - 未満：単一 HTML 維持、P8'-C まで継続
- 単一 HTML を維持する場合のリスク：
  - エディタが重くなる（VSCode で開くと数秒待つ）
  - Service Worker のキャッシュ更新時に常にフルダウンロード
- 分割するメリット：
  - ESM の tree-shaking が効く（Service Worker キャッシュ更新で差分のみ）
  - コード探索が楽になる
- 分割するデメリット：
  - GitHub Pages の MIME type 設定（既存設定無改変で動くか要検証）
  - Service Worker のキャッシュ戦略を見直す必要
