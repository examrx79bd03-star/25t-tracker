# family-map スケジュール／メモ機能 仕様書

**作成日**: 2026-05-25（旧版を全面改訂、新方針）
**ステータス**: **🟢 全 Phase 完了（P1' / P2' / P3' / P4' / P5'）** — local commit のみ蓄積、push 未実施（ユーザー承認待ち）
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

---

## H. push 戦略

### H-1. 一括 push 方針
- **P1'〜P5 すべて完了するまで `git push` しない**（ユーザー指示、本セッションで再確認済み）
- 各 Phase ごとに local commit のみ蓄積
- 全完了後、ユーザー承認を得て一括 push

### H-2. commit メッセージ規則
- プレフィックス：`feat(family-map): P<N>'`（プライム付きで旧 P1 と区別）
- 例：
  - `feat(family-map): P1' add top-level 3-tab nav (familymap/schedule/memo), wrap legacy UI`
  - `feat(family-map): P2' add schedule monthly view, event CRUD, label presets`
  - `feat(family-map): P3' add event comments, recurrence, activity log`
  - `feat(family-map): P4' add memo tab, card grid, checklist memo`
  - `feat(family-map): P5' integrate, polish, label management UI`

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
