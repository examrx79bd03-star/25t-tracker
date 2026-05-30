# migrate-uids.mjs

family-map のアカウント分離問題（旧 anonymous uid → 新 uid マイグレーション）復旧用スクリプト。
2026-05-28 のぐっち事故対応で作成。

## 前提
- Node.js v18 以上（動作確認: v24.14.1）
- `service-account.json` をこのフォルダ（`C:\AppDev\family-map\_scripts\`）に配置
  - Firebase Console → 歯車（プロジェクト設定）→ サービスアカウント → 新しい秘密鍵を生成 → ダウンロードした JSON を `service-account.json` にリネームして配置
- ⚠️ `service-account.json` は `.gitignore` で除外済み。**絶対に commit しない**

## 設定値（スクリプト先頭にハードコード）
```
FAMILY_ID = 'VNWMGUF94G'
NEW_UID   = '53iGdytYPvXtq4OJ0RxjEQ5MPuB2'
OLD_UIDS  = [6 件]
PROFILE_TO_KEEP = 'ow9QBuVYisXtafiAWKus4kGZYXl2'
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
   - PWA を使っている場合は再追加
2. 自分が作成した過去予定の「作成者」表示が、現在の名前（プロフィール `ねぇねぇと呼ばれる人 🌻`）になっていることを確認
3. 設定 → デバッグ情報で `currentUid` と `legacyUid` が一致していることを確認
4. 妻に家族コード `VNWMGUF94G` を共有し、初回参加してもらう

## 後片付け
- `service-account.json` を削除（または別の安全な場所に保管）
- `_scripts/node_modules/` は `.gitignore` で除外済みなので残してもよい
