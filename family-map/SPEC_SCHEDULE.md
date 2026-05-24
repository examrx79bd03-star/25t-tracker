# family-map — スケジューラー・メモ機能 設計書（SPEC_SCHEDULE.md）

**作成日**: 2026-05-25
**ステータス**: P1 完了 / P2 着手待ち
**関連 commit / tag**:
- バックアップ tag: `pre-schedule-feature-2026-05-25`
- バックアップ branch: `backup/pre-schedule-2026-05-25`
- P1 実装 commit: （P1 commit 後に追記）

---

## A. 目的・スコープ

### 何を追加するか
family-map に **TimeTree 風の家族共有スケジューラー＋メモ機能**を追加する。これまでは「場所のピン」のみだったが、家族で日程・予定・買い物リストなどを同期できるようにする。

### なぜ追加するか
夫婦＋娘の生活軸を「場所」と「時間」の両方でカバーすることで、家族向けアプリとしての完成度を上げる。市販の TimeTree は十分高機能だが、family-map は「ピン × 予定 × メモ」を1つの家族コードで完結させられる点でユニーク。

### 達成目標
- 家族の予定をマンスリーカレンダーで一覧できる
- 各予定にコメント／写真／繰り返しを付けられる（最低限）
- 共有メモ（チェックリスト付き）を家族で編集できる
- メモを予定に「昇格」できる（買い物予定→明日の買い物予定など）
- すべて Firestore でリアルタイム同期、家族コード認証

### 参考資料
- TimeTree 調査資料: `C:\Users\commo\Downloads\compass_artifact_wf-ef604dd0-f634-4d5a-9ce0-6b25b549a4b4_text_markdown.md`

### スコープ外（v1 では実装しない）
- 予定 ↔ ピン紐付け（地図連携）→ Stage 2 以降に回す
- 既読／未読バッジ
- 通知（push 通知）
- iCal エクスポート
- タイムゾーン考慮（JST 固定）

---

## B. ナビゲーション構造（案 A：タブ分離）

### 既存構造
- 地図画面（常時表示、フルスクリーン）
- 右上「歯車」アイコン → 設定モーダル
- 右下「一覧 N」FAB → 一覧 view（フルスクリーン slide-up）
  - 一覧 view 内に view-tab で `[リスト] [カレンダー]` のサブビュー切替

### 新構造（案 A 採用）
一覧 view 内のサブタブを拡張する。タブバーは横並び 3 つ。

```
┌─ 地図画面（ベース）──────────────────┐
│  [歯車] 右上 = 設定                       │
│  [一覧 N] 右下 = 一覧 view を開く          │
└──────────────────────────────────────────┘

[一覧 view（slide-up モーダル）] ─────────
  [リスト] [思い出ログ] [スケジュール]    ← サブタブ 3 つ
  ├─ リスト       … 既存「リスト」サブビュー
  ├─ 思い出ログ   … 既存「カレンダー」サブビューをリネーム
  └─ スケジュール … 新規。内部に二段目サブタブ
       ┌─ [マンスリー] [メモ]
       ├─ マンスリー … 予定のカレンダー表示・追加・編集
       └─ メモ       … 共有メモ・チェックリスト
```

### 命名理由
- 「カレンダー」は実態としては「ピンを登録日付順にカレンダー表示する＝思い出ログ」なのでリネーム。「スケジュール」とは違う性質（過去のピン記録 vs 未来の予定）なので分離は妥当
- 「スケジュール」内サブタブは「マンスリー（予定）」「メモ（共有メモ）」とする

---

## C. データモデル（Firestore）

### 既存
```
families/{familyId}/pins/{pinId}
  - 既存仕様のまま、無変更
```

### 新規 1: events（予定）
```
families/{familyId}/events/{eventId}
{
  id:         string  (UUIDv4 / client-gen)
  title:      string  (必須、トリム後 1〜100 文字)
  startAt:    number  (epoch ms — 終日の場合は当日 00:00 JST)
  endAt:      number  (epoch ms — 終日の場合は当日 23:59:59 JST)
  allDay:     boolean (true = 終日)
  labelId:    string  ('label1'〜'label6'、familyConfig/labels を参照)
  recurrence: {
    type:  'none' | 'weekly' | 'monthly'
    until: number?   // 終了日 epoch ms（無ければ無期限）
  }
  comments:   Array<{
    id:        string  (UUIDv4)
    userId:    string  (匿名 Auth の uid)
    text:      string  (本文)
    photoUrl:  string?  // v1 未実装、v2 で対応
    createdAt: number  (epoch ms)
  }>
  createdBy:  string  (匿名 Auth の uid)
  createdAt:  number  (epoch ms, immutable)
  updatedAt:  number  (epoch ms, last-write-wins 用)
}
```

#### 繰り返しの扱い（v1 シンプル仕様）
- `recurrence.type === 'weekly'` の場合：`startAt` の曜日と同じ曜日に毎週発生（時刻は `startAt` の hh:mm）
- `recurrence.type === 'monthly'` の場合：`startAt` の日付と同じ日に毎月発生
- 表示時にカレンダー側で展開（バックエンドには 1 件しか保存しない）
- `until` が設定されていればそこまで、無ければ表示中の月までは無条件で展開

### 新規 2: memos（共有メモ）
```
families/{familyId}/memos/{memoId}
{
  id:        string  (UUIDv4)
  title:     string  (必須、1〜100 文字)
  body:      string  (自由メモ、最大 2000 文字)
  checklist: Array<{
    id:      string  (UUIDv4)
    text:    string
    checked: boolean
  }>
  comments:  Array<{ id, userId, text, createdAt }>
  createdBy: string  (uid)
  createdAt: number  (epoch ms)
  updatedAt: number  (epoch ms)
}
```

### 新規 3: familyConfig（家族設定）
```
families/{familyId}/familyConfig/labels
{
  labels: Array<{
    id:    string  ('label1' 〜 'label6'、固定 6 個)
    name:  string  (初期値 "ラベル1" 〜 "ラベル6"、設定で編集可)
    color: string  (CSS 色文字列 / hex)
    order: number  (並び順、0-5)
  }>
  updatedAt: number  (epoch ms)
}
```

#### デフォルト 6 色（初期化時にセット）
```js
const DEFAULT_LABELS = [
  { id: 'label1', name: 'ラベル1', color: '#E57373', order: 0 }, // 赤
  { id: 'label2', name: 'ラベル2', color: '#FFB74D', order: 1 }, // オレンジ
  { id: 'label3', name: 'ラベル3', color: '#FFF176', order: 2 }, // 黄
  { id: 'label4', name: 'ラベル4', color: '#81C784', order: 3 }, // 緑
  { id: 'label5', name: 'ラベル5', color: '#64B5F6', order: 4 }, // 青
  { id: 'label6', name: 'ラベル6', color: '#BA68C8', order: 5 }, // 紫
];
```

### メモ → 予定への昇格（writeBatch で原子化）
```js
async function promoteMemoToEvent(memo, scheduledAt) {
  const batch = writeBatch(fbDb);
  const newEvent = {
    id: uuid(),
    title: memo.title,
    startAt: scheduledAt,
    endAt:   scheduledAt + 60 * 60 * 1000, // 1 時間
    allDay:  false,
    labelId: 'label1',
    recurrence: { type: 'none' },
    comments: [],
    createdBy: fbAuth.currentUser.uid,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  batch.set(doc(fbDb, 'families', familyId, 'events', newEvent.id), newEvent);
  batch.delete(doc(fbDb, 'families', familyId, 'memos', memo.id));
  await batch.commit();
}
```

---

## D. Firestore セキュリティルール変更案

### 現状ルール（推定、Firebase Console で要確認）
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /families/{familyId}/pins/{pinId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### P2 開始前にユーザーが Firebase Console で行う作業

1. https://console.firebase.google.com/ → プロジェクト `family-map-c5110` を開く
2. 左メニュー「Firestore Database」→「ルール」タブ
3. 既存ルール全体を以下に置き換え（既存 pins ルールは維持）：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 既存：ピン
    match /families/{familyId}/pins/{pinId} {
      allow read, write: if request.auth != null;
    }
    // 新規：予定
    match /families/{familyId}/events/{eventId} {
      allow read, write: if request.auth != null;
    }
    // 新規：メモ
    match /families/{familyId}/memos/{memoId} {
      allow read, write: if request.auth != null;
    }
    // 新規：家族設定（ラベルなど）
    match /families/{familyId}/familyConfig/{configId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

4. 右上の「公開」ボタンをクリック
5. 反映に 30 秒〜 1 分かかる

### 注意
- 家族コードを知っていれば誰でも読み書きできる「ゆるい」ルールのまま。これは現状のピンと同じセキュリティモデル
- v2 以降で「家族コードを知っている匿名ユーザのみ」をより厳密化する余地あり（家族コードのハッシュ化など）

---

## E. UI 構造（モーダル・サブタブ含む）

### スケジュールタブの構成

```
[スケジュール] サブタブを開いた状態
├─ 二段目サブタブ [マンスリー] [メモ]
└─ コンテンツエリア（高さ可変、内部スクロール）
```

#### マンスリービュー
- 月送り（既存の思い出ログのカレンダー実装を流用）
- セルに該当日の予定をラベル色のドットで表示
- 日付タップ → その日の予定リスト（カードスタイル）を下に表示
- 右下に + FAB（予定追加モーダルを開く）

#### 予定追加モーダル（新規）
```
[予定を追加]                        [×]
─────────────────────────────────────
タイトル        [_____________________]
開始日時        [YYYY-MM-DD]  [hh:mm]
終了日時        [YYYY-MM-DD]  [hh:mm]
[ ] 終日
ラベル          [▼ ラベル1            ]   ← プルダウンで 6 色から選択
繰り返し        [▼ なし               ]   ← なし / 毎週 / 毎月
コメント        [_____________________]
                [_____________________]
─────────────────────────────────────
              [キャンセル] [保存]
```

#### 予定詳細モーダル（編集兼用）
```
[予定の詳細]                        [×]
─────────────────────────────────────
■ ラベル色バー
タイトル: 〇〇病院
日時: 2026-05-30 14:00 〜 15:00
ラベル: ラベル2（黄）
繰り返し: 毎週

[コメント]
- パパ  2026-05-25 19:30
   病院ついでに帰りに買い物頼む
- ママ  2026-05-26 08:15
   了解。リスト確認するね

[コメント入力欄_________________] [送信]
─────────────────────────────────────
        [削除] [編集] [閉じる]
```

#### メモタブ
- メモ一覧（カード形式、タイトル＋本文 1 行プレビュー＋チェックリスト個数）
- 右下に + FAB（メモ追加モーダル）

#### メモ追加・編集モーダル
```
[メモを追加]                        [×]
─────────────────────────────────────
タイトル        [_____________________]
本文            [_____________________]
                [_____________________]
                [_____________________]

[チェックリスト]
[ ] りんご
[ ] 卵
[ ] 牛乳
[+ 項目を追加]

[コメント]
（実装は予定と同形式）
─────────────────────────────────────
[削除] [予定に昇格] [キャンセル] [保存]
```

#### チェックリスト UI 仕様
- 改行（Enter）で新しい項目が自動追加される
- 各項目左のチェックボックスをタップで toggle（保存はリアルタイム or 保存時バッチ）
- 空のまま改行されたら削除
- ドラッグ並び替えは v2

### 設定画面のラベル管理セクション（追加）
```
[設定]
...
■ スケジュールのラベル管理
┌─────────────────────────────┐
│ ● ラベル1     [編集] [削除] │
│ ● ラベル2     [編集] [削除] │
│ ...                          │
└─────────────────────────────┘
[+ ラベルを追加]（上限 6 個）
```

各ラベルの編集モーダル：
- 名前変更（1〜20 文字）
- 色変更（カラーピッカー or プリセットパレット）

---

## F. 既存機能との非干渉

### リネーム影響範囲（既存「カレンダー」→「思い出ログ」）

#### HTML
| 場所 | 旧 | 新 |
|---|---|---|
| `index.html:1837` | `<button class="view-tab" data-view="calendar">カレンダー</button>` | `<button class="view-tab" data-view="memorylog">思い出ログ</button>` |
| `index.html:1876` | `<div class="list-sub hidden" id="subCalendar">` | `<div class="list-sub hidden" id="subMemorylog">` |

#### JS（識別子）
| 場所 | 旧 | 新 |
|---|---|---|
| `listSubView` 値域 | `'list' \| 'calendar'` | `'list' \| 'memorylog' \| 'schedule'` |
| `loadPrefs()` の検証 | `p.listSubView === 'list' \|\| 'calendar'` | `'list' \| 'memorylog' \| 'schedule'` に拡張 |
| `setListSubView()` 切替 | `subList` / `subCalendar` | `subList` / `subMemorylog` / `subSchedule` |

#### localStorage 移行ロジック
```js
// loadPrefs() 内に 1 回限りの migration を仕込む
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    let v = p.listSubView;
    // Migration: 旧 'calendar' を 'memorylog' に置換
    if (v === 'calendar') v = 'memorylog';
    if (['list','memorylog','schedule'].includes(v)) listSubView = v;
    ...
  }
}
```

### 関数名の影響
- `renderCalendar()` → 機能は思い出ログ（過去ピン）のままなので、関数名はそのまま `renderCalendar()` で OK（ピンのカレンダー表示なので「思い出ログレンダラ」と読み替える）
- スケジュールタブ用には別途 `renderScheduleMonthly()` `renderScheduleMemoList()` などを新規作成

### DOM ID
- `subCalendar` → `subMemorylog`
- `calPrev` / `calNext` / `calTitle` / `calGrid` / `calDayPins` は思い出ログ用としてそのまま
- 新規：`subSchedule` / `scheduleSubTabs` / `scheduleMonthly` / `scheduleMemo` / 等

### CSS
- `.view-tab` `.list-sub` は既存をそのまま使う（4 タブでも flex で柔軟に対応）
- スケジュール内サブタブ用に `.schedule-subtab` 系を新規追加（後ほど Phase 2-4 で具体化）

---

## G. Phase 別実装計画

### Phase 1（今回）— 土台作り（〜100 行程度の追加）
**スコープ**：リネーム＋空タブ＋データモデル準備＋セキュリティルール手順書

- ✅ バックアップ tag/branch 作成・push
- ✅ SPEC_SCHEDULE.md 作成（本ファイル）
- 「カレンダー」→「思い出ログ」リネーム + migration コード
- 「スケジュール」サブタブ追加（中身は「準備中です」プレースホルダ）
- スケジュール内サブタブ「マンスリー」「メモ」（中身プレースホルダ、切替ロジックのみ）
- Firestore 参照ヘルパー追加（読み書きは P2 以降）：
  - `eventsRef()` / `memosRef()` / `labelsRef()`
- ラベルデフォルト定数 `DEFAULT_LABELS` 定義
- `family-map.schedule.subtab` localStorage キーで二段目サブタブ状態を永続化
- 既存機能リグレッション目視確認

### Phase 2 — 予定の追加・表示・編集（〜400 行）
**スコープ**：基本 CRUD、コメント・繰り返しなし、ラベル選択のみ

- スケジュールマンスリービューの実装
  - `renderScheduleMonthly()` （思い出ログ風カレンダー）
  - 日付タップ → その日の予定リスト
- 予定追加モーダル（タイトル・日時・終日・ラベル・コメント欄なし）
- 予定詳細モーダル（基本情報＋編集・削除）
- Firestore I/O 実装
  - `onSnapshot(eventsRef)` でリアルタイム同期
  - `setDoc` / `deleteDoc`
- ラベル取得：`onSnapshot(labelsRef)` で `labels` を keep。初回接続時に未存在ならデフォルト 6 個を `setDoc`
- **依存**: P1 のスケルトン

### Phase 3 — 予定にコメント・繰り返し（〜300 行）
**スコープ**：チャット形式コメント、毎週/毎月の繰り返し展開

- 予定詳細にコメントリスト＋入力欄を実装
  - `comments` 配列を update（writeBatch 不要、配列 setDoc で OK）
- 繰り返し展開ロジック
  - `expandRecurrence(event, monthYear)` で表示中の月の発生分を計算
  - until までを上限とする
- **依存**: P2 完了

### Phase 4 — メモタブ（〜400 行）
**スコープ**：メモ CRUD・チェックリスト UI・コメント

- メモ一覧（カード）
- メモ追加・編集モーダル
- チェックリスト UI
  - 改行で自動追加、タップで toggle
  - 空項目の自動削除
- メモにコメント（P3 と同形式）
- Firestore I/O（memos コレクション）
- **依存**: P3 完了

### Phase 5 — 昇格・ラベル管理 UI（〜300 行）
**スコープ**：メモ→予定の writeBatch 昇格、ラベル管理画面

- メモ詳細モーダルに「予定に昇格」ボタン
  - 日時選択ダイアログ → `promoteMemoToEvent()` 実行
  - writeBatch で memos.delete + events.set を原子化
- 設定モーダルにラベル管理セクション追加
- ラベル名・色の編集モーダル
- **依存**: P4 完了

### 行数概算
- 現状: 4279 行
- P1 完了予測: 4400 行前後（+ 120）
- P5 完了予測: 5800 行前後（+ 1500）

---

## H. push 戦略

### 方針
- **P1〜P5 すべて完了するまで `git push` しない**
- 各 Phase ごとに local commit のみ
- 全 Phase 完了後、ユーザーが iPhone Safari で「リグレッションテスト項目」（I 節）を一気に確認し、OK なら一括 push

### commit メッセージ規則
```
feat(family-map): P<N> <summary>

<body: 詳細>

Backup tag: pre-schedule-feature-2026-05-25
Backup branch: backup/pre-schedule-2026-05-25
```

例：
- `feat(family-map): P1 add schedule/memo tab scaffold, rename calendar to memory-log`
- `feat(family-map): P2 implement schedule monthly view and CRUD`
- ...

### 一括 push 時の段取り
1. ユーザーから push 承認を取る
2. `git log --oneline pre-schedule-feature-2026-05-25..HEAD` で commit 一覧を確認
3. Firestore セキュリティルールが Firebase Console で更新済みであることを確認
4. `git push origin main` 実行
5. GitHub Pages 反映待ち（〜1 分）
6. iPhone Safari でキャッシュクリア（設定 → Safari → 履歴と Web サイトデータを消去）
7. ユーザーがリグレッションテスト実施

### 万一の問題発生時のロールバック
```bash
# 一時的な ロールバック（main を backup branch に戻す）
git reset --hard backup/pre-schedule-2026-05-25
git push --force-with-lease origin main   # ユーザー承認後のみ
```

---

## I. リグレッションテスト項目

全 Phase 完了後、ユーザーが iPhone Safari で実機確認。

### 既存機能（壊していないか）
- [ ] 地図表示・タップでピン追加
- [ ] ピン編集・削除モーダル
- [ ] 3 色ステータス（訪問済み・行きたい・思い出）
- [ ] フィルタチップ
- [ ] 一覧 view 開閉
- [ ] 一覧サブタブ「リスト」表示
- [ ] **「カレンダー」→「思い出ログ」リネームが正しく反映**（旧 localStorage 持ち の場合の migration 含む）
- [ ] 一覧サブタブ「思い出ログ」（旧カレンダー）の動作
- [ ] 一覧サブタブの選択状態が再起動後も保持される
- [ ] 検索・ソート
- [ ] 一括選択モード（削除・タグ変更）
- [ ] 現在地ボタン・ピン
- [ ] 設定モーダル
- [ ] 家族コード接続
- [ ] エクスポート／インポート
- [ ] Google Maps CSV インポート
- [ ] Gemini 子育て要約（Worker 経由）

### 新機能（P2-P5 で実装）
- [ ] スケジュールサブタブが表示される
- [ ] 二段目サブタブ「マンスリー」「メモ」切替
- [ ] 予定の追加・編集・削除
- [ ] 予定のラベル選択
- [ ] 予定のコメント投稿
- [ ] 予定の繰り返し（毎週・毎月）
- [ ] メモの追加・編集・削除
- [ ] メモのチェックリスト操作（追加・toggle・削除）
- [ ] メモ → 予定への昇格
- [ ] ラベル管理（設定画面で名前・色変更）
- [ ] 全機能で家族間リアルタイム同期

### Firestore セキュリティルール
- [ ] events / memos / familyConfig の read/write がログイン状態で成功する
- [ ] 未認証状態では失敗する（permission-denied）

### PWA
- [ ] ホーム画面追加後のアイコンタップで起動
- [ ] URL hash の家族コードが保持される

---

## 付録 1: P1 で追加するスケルトンコード

### Firestore 参照ヘルパー
```js
// 予定コレクションへの参照（家族コード接続済みの前提）
function eventsRef() {
  if (!familyId) return null;
  return collection(fbDb, 'families', familyId, 'events');
}
function eventDocRef(eventId) {
  if (!familyId) return null;
  return doc(fbDb, 'families', familyId, 'events', eventId);
}

// メモコレクション
function memosRef() {
  if (!familyId) return null;
  return collection(fbDb, 'families', familyId, 'memos');
}
function memoDocRef(memoId) {
  if (!familyId) return null;
  return doc(fbDb, 'families', familyId, 'memos', memoId);
}

// 家族設定（ラベル）
function labelsDocRef() {
  if (!familyId) return null;
  return doc(fbDb, 'families', familyId, 'familyConfig', 'labels');
}
```

### デフォルトラベル定数
```js
const DEFAULT_LABELS = [
  { id: 'label1', name: 'ラベル1', color: '#E57373', order: 0 },
  { id: 'label2', name: 'ラベル2', color: '#FFB74D', order: 1 },
  { id: 'label3', name: 'ラベル3', color: '#FFF176', order: 2 },
  { id: 'label4', name: 'ラベル4', color: '#81C784', order: 3 },
  { id: 'label5', name: 'ラベル5', color: '#64B5F6', order: 4 },
  { id: 'label6', name: 'ラベル6', color: '#BA68C8', order: 5 },
];

// 初期化（P2 で実装、P1 ではスケルトンのみ）
async function ensureDefaultLabels() {
  // P2 で実装：labelsDocRef() を読んで未存在ならデフォルトを setDoc
  // P1 では呼ばれない（空の関数として宣言のみ）
}
```

---

## 付録 2: 過去の判断履歴

### 案 A vs 案 B vs 案 C
- 案 A（採用）：既存「カレンダー」をリネーム、新規「スケジュール」サブタブを追加（二段目サブタブで内部分割）
- 案 B（不採用）：上部に大きなナビバーを 5 ボタンで新設
- 案 C（不採用）：スケジュール・メモを独立モーダルにして地図画面から直接開く

採用理由：
- 既存の `view-tabs` パターンと一貫性がある
- 大規模な CSS / HTML 再構築が不要
- ユーザーの「サブタブ：マンスリー / メモ」記述に沿う

### 予定 ↔ ピン紐付けは v1 で実装しない
- 予定に「場所」を関連付ける機能は便利だが、UI が複雑化する（ピン選択モーダル、紐付け解除など）
- v2 以降に「紐付け」だけ独立追加することで合意

### ラベルは固定 6 個
- TimeTree も初期 8 色だが、家族 3 人なら 6 個で十分
- 「追加」ではなく「名前と色を編集」できる範囲に絞ることで UI を単純化
- v2 で追加・削除を可能にしてもよい
