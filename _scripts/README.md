# migrate-uids.mjs

family-map のアカウント分離問題（旧 anonymous uid → 新 uid マイグレーション）復旧用スクリプト。
2026-05-28 のぐっち事故対応で作成。

## 利用実績（2026-05-28〜30、計 5 回）

| # | OLD_UIDS | NEW_UID | 契機 |
|---|---|---|---|
| 1 | 6 個の旧 anonymous uid | `53iGdytYPvXtq4OJ0RxjEQ5MPuB2` | 初回の PWA 削除事故、応急復旧 |
| 2 | `53iGd…` | `Btk15JJ…` | PWA 再削除で再分裂 |
| 3 | `Btk15JJ…` | `HGJsABwfqPaRQSk5glpPztTGO1r1` | Safari Google ログインで再発行 |
| 4 | （スキップ） | — | 連続事故で P8'-A-3 を前倒し |
| 5 | `HGJsABwfqPa…` | **`qj3Se1s57UXEGcfseSavERbtHUw2`** | **Email/Password 採用後の最終 uid** |

各回とも下記の設定値（`NEW_UID` / `OLD_UIDS` / `PROFILE_TO_KEEP`）を書き換えて再実行。冪等性により、誤って同じパッチを 2 回流しても安全。

## Email/Password 認証採用後の運用方針（2026-05-30〜）

- **原則として手動マイグレは不要**：Email/Password 認証では client-side の `runUidMigration(legacyUid, newUid)` が起動して、legacyUid から newUid へ自動的に events.createdBy / events.members[] / pins.createdBy / members ドキュメントを書き換える
- 例外的に手動 live run が必要なケース：
  - client-side マイグレが途中失敗 → Firestore の一部 doc に旧 uid が残った場合の掃除
  - 大量データで client-side の getDocs ループが iPhone Safari のタブ生存時間内に終わらない場合
  - 別端末で同時に複数 uid からマイグレが走ってコンフリクトした場合の整合性回復
- 上記のケースで使う場合のみ、後述の手順で実行

## 前提
- Node.js v18 以上（動作確認: v24.14.1）
- `service-account.json` をこのフォルダ（`C:\AppDev\family-map\_scripts\`）に配置
  - Firebase Console → 歯車（プロジェクト設定）→ サービスアカウント → 新しい秘密鍵を生成 → ダウンロードした JSON を `service-account.json` にリネームして配置
- ⚠️ `service-account.json` は `.gitignore` で除外済み。**絶対に commit しない**

## 設定値（スクリプト先頭にハードコード、毎回書き換える）
```
FAMILY_ID       = 'VNWMGUF94G'
NEW_UID         = (現在の uid、Firebase Console → Authentication で確認)
OLD_UIDS        = [置き換え元 uid のリスト]
PROFILE_TO_KEEP = (displayName / avatar を維持したい source uid)
```

最終実行時の設定値（2026-05-30、5 回目）：
```
NEW_UID         = 'qj3Se1s57UXEGcfseSavERbtHUw2'  (Email/Password)
OLD_UIDS        = ['HGJsABwfqPaRQSk5glpPztTGO1r1']
PROFILE_TO_KEEP = 'HGJsABwfqPaRQSk5glpPztTGO1r1'  (「ねぇねぇと呼ばれる人 🌻」)
```

## 依存ライブラリ
インストール済み（`firebase-admin`）。再インストールが必要な場合のみ：

```powershell
cd C:\AppDev\family-map\_scripts
& 'C:\Program Files\nodejs\npm.cmd' install firebase-admin
```

> 注: PowerShell の ExecutionPolicy が Restricted の場合、`npm` 直叩きは `.ps1` 経由で失敗するので、上記のように `npm.cmd` をフルパス指定する。

## 使い方

### dry-run（書き換え件数だけ表示。Firestore は変更されない）
```powershell
cd C:\AppDev\family-map\_scripts
node migrate-uids.mjs --dry-run
```

### 本番実行（dry-run の結果を確認してから）
```powershell
cd C:\AppDev\family-map\_scripts
node migrate-uids.mjs --live
```
プロンプトに `yes` と入力して Enter。

## 処理内容
1. `families/VNWMGUF94G/events` 全件 → `createdBy` / `members[]` / `comments[].userId` / `activities[].userId` の旧 uid を新 uid に置換（members は重複削除）
2. `families/VNWMGUF94G/pins` 全件 → `createdBy` の旧 uid を新 uid に置換
3. `members/ow9QBuVYi…` のプロフィール（displayName・avatar）を `members/53iGd…` にコピー（`createdAt` は元の値を維持、`updatedAt` は現在時刻、`legacyUid` 付与）
4. 旧 uid 6 件分の `members/{oldUid}` を削除

## 安全性
- `--dry-run` と `--live` を**明示的に**要求（引数なしは usage 表示で終了）
- live 実行前に `yes` 入力プロンプト
- writeBatch ではなく `doc.ref.update` を**順次**実行（並列化なし）。途中失敗してもデータ破損は最小化
- 冪等性: 再実行時、既に新 uid に書き換え済みのフィールドは差分なしで skip される
- エラー時は詳細スタックトレース出力 + exit 1

## 復旧後の確認手順
1. iPhone Safari で `https://examrx79bd03-star.github.io/25t-tracker/family-map/`
   - 設定 → Safari → 履歴と Web サイトデータを消去
   - **PWA は削除しない**（削除するとアカウント分離が再発する。§ SHARED.md § 12 参照）
2. Email/Password で同じアカウントにログインし直す
3. 自分が作成した過去予定の「作成者」表示が、現在の名前（プロフィール `ねぇねぇと呼ばれる人 🌻`）になっていることを確認
4. 設定 → デバッグ情報で `currentUid` が `qj3Se1s57UXEGcfseSavERbtHUw2` であることを確認
5. 妻・娘が新規登録するときは家族コード `VNWMGUF94G` を共有（手順は `family-member-onboarding.md` 参照）

## 後片付け
- `service-account.json` を削除（または別の安全な場所に保管）
- `_scripts/node_modules/` は `.gitignore` で除外済みなので残してもよい
