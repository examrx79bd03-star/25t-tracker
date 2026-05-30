#!/usr/bin/env node
/**
 * migrate-uids.mjs
 *
 * family-map のアカウント分離問題（旧 anonymous uid → 新 uid マイグレーション）復旧用スクリプト。
 * 2026-05-28 のぐっち事故対応で作成。
 *
 * 使い方:
 *   node migrate-uids.mjs --dry-run     # 書き換え件数を確認
 *   node migrate-uids.mjs --live        # 本番実行（'yes' 確認プロンプト）
 *
 * 前提:
 *   - ./service-account.json に Firebase service account JSON を配置（.gitignore 済み）
 *   - npm install firebase-admin 済み
 */

import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import admin from 'firebase-admin';

// =====================================================================
// 設定値（ハードコード — 用途が一回限りの復旧スクリプトのため）
// =====================================================================
const FAMILY_ID = 'VNWMGUF94G';
const NEW_UID = 'Btk15JJ1n5VZIW8Rr5q2zCQusWW2';
const OLD_UIDS = [
  '53iGdytYPvXtq4OJ0RxjEQ5MPuB2',
];
const PROFILE_TO_KEEP = '53iGdytYPvXtq4OJ0RxjEQ5MPuB2';
const DATABASE_ID = '(default)'; // Firestore default DB（family-map-c5110）

const OLD_UID_SET = new Set(OLD_UIDS);

// =====================================================================
// 引数解析
// =====================================================================
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isLive = args.includes('--live');

if (!isDryRun && !isLive) {
  console.log('Usage:');
  console.log('  node migrate-uids.mjs --dry-run   # show planned changes');
  console.log('  node migrate-uids.mjs --live      # apply changes (with confirmation)');
  process.exit(0);
}
if (isDryRun && isLive) {
  console.error('ERROR: cannot specify both --dry-run and --live');
  process.exit(1);
}

const MODE = isLive ? 'LIVE' : 'DRY-RUN';

// =====================================================================
// Service Account 読み込み
// =====================================================================
const __dirname = dirname(fileURLToPath(import.meta.url));
const credPath = join(__dirname, 'service-account.json');

if (!existsSync(credPath)) {
  console.error(`ERROR: service-account.json not found at: ${credPath}`);
  console.error('Download it from Firebase Console -> Project Settings -> Service Accounts -> Generate new private key');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(credPath, 'utf8'));
} catch (err) {
  console.error('ERROR: failed to parse service-account.json:', err.message);
  process.exit(1);
}

// =====================================================================
// Firebase Admin 初期化
// =====================================================================
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});

const db = admin.firestore();
// (default) DB を明示的に使用（asia-northeast1 ではなく default location）
// 別 DB ID を使う場合は initializeFirestore({ databaseId: DATABASE_ID }) が必要

console.log(`[${MODE} MODE] ${isLive ? 'CHANGES WILL BE WRITTEN' : 'No changes will be written.'}`);
console.log(`Loaded service account for project: ${serviceAccount.project_id}`);
console.log(`Target family: ${FAMILY_ID}`);
console.log(`New uid: ${NEW_UID}`);
console.log(`Old uids (${OLD_UIDS.length}):`);
for (const u of OLD_UIDS) console.log(`  - ${u}`);
console.log('');

// =====================================================================
// LIVE モード時の確認プロンプト
// =====================================================================
async function confirmLive() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`>>> LIVE mode. Are you sure? Type 'yes' to confirm: `, (answer) => {
      rl.close();
      resolve(answer.trim() === 'yes');
    });
  });
}

// =====================================================================
// ヘルパー
// =====================================================================
function remapUid(uid) {
  return OLD_UID_SET.has(uid) ? NEW_UID : uid;
}

function dedupePreserveOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function commentsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}

// =====================================================================
// メイン処理
// =====================================================================
async function main() {
  if (isLive) {
    const ok = await confirmLive();
    if (!ok) {
      console.log('Aborted by user.');
      process.exit(0);
    }
    console.log('');
  }

  const familyRef = db.collection('families').doc(FAMILY_ID);

  // -------------------------------------------------------------------
  // 1. events
  // -------------------------------------------------------------------
  console.log('Scanning events...');
  const eventsSnap = await familyRef.collection('events').get();
  console.log(`  Total events in collection: ${eventsSnap.size}`);

  let eventsTouched = 0;
  for (const doc of eventsSnap.docs) {
    const data = doc.data();
    const touched = {};
    const changes = [];

    // createdBy
    if (typeof data.createdBy === 'string' && OLD_UID_SET.has(data.createdBy)) {
      touched.createdBy = NEW_UID;
      changes.push(`createdBy: ${data.createdBy} -> ${NEW_UID}`);
    }

    // members (array of uid)
    if (Array.isArray(data.members)) {
      const newMembers = data.members.map(remapUid);
      const deduped = dedupePreserveOrder(newMembers);
      if (!arraysEqual(deduped, data.members)) {
        touched.members = deduped;
        changes.push(`members: ${JSON.stringify(data.members)} -> ${JSON.stringify(deduped)}`);
      }
    }

    // comments (array of {userId, ...})
    if (Array.isArray(data.comments)) {
      const newComments = data.comments.map((c) => {
        if (c && typeof c === 'object' && typeof c.userId === 'string' && OLD_UID_SET.has(c.userId)) {
          return { ...c, userId: NEW_UID };
        }
        return c;
      });
      if (!commentsEqual(newComments, data.comments)) {
        touched.comments = newComments;
        const changedCount = newComments.filter((c, i) => JSON.stringify(c) !== JSON.stringify(data.comments[i])).length;
        changes.push(`comments: ${changedCount} entry(ies) remapped`);
      }
    }

    // activities (array of {userId, ...} 想定。Firestore 内で同形なら同じ扱い)
    if (Array.isArray(data.activities)) {
      const newActivities = data.activities.map((a) => {
        if (a && typeof a === 'object' && typeof a.userId === 'string' && OLD_UID_SET.has(a.userId)) {
          return { ...a, userId: NEW_UID };
        }
        return a;
      });
      if (!commentsEqual(newActivities, data.activities)) {
        touched.activities = newActivities;
        const changedCount = newActivities.filter((a, i) => JSON.stringify(a) !== JSON.stringify(data.activities[i])).length;
        changes.push(`activities: ${changedCount} entry(ies) remapped`);
      }
    }

    if (Object.keys(touched).length > 0) {
      eventsTouched++;
      console.log(`  [${MODE}] event ${doc.id}:`);
      for (const c of changes) console.log(`      ${c}`);
      if (isLive) {
        try {
          await doc.ref.update(touched);
        } catch (err) {
          console.error(`  ERROR updating event ${doc.id}:`, err.message);
          throw err;
        }
      }
    }
  }
  console.log(`  Events to update: ${eventsTouched}`);
  console.log('');

  // -------------------------------------------------------------------
  // 2. pins
  // -------------------------------------------------------------------
  console.log('Scanning pins...');
  const pinsSnap = await familyRef.collection('pins').get();
  console.log(`  Total pins in collection: ${pinsSnap.size}`);

  let pinsTouched = 0;
  for (const doc of pinsSnap.docs) {
    const data = doc.data();
    const touched = {};
    const changes = [];

    if (typeof data.createdBy === 'string' && OLD_UID_SET.has(data.createdBy)) {
      touched.createdBy = NEW_UID;
      changes.push(`createdBy: ${data.createdBy} -> ${NEW_UID}`);
    }

    if (Object.keys(touched).length > 0) {
      pinsTouched++;
      console.log(`  [${MODE}] pin ${doc.id}:`);
      for (const c of changes) console.log(`      ${c}`);
      if (isLive) {
        try {
          await doc.ref.update(touched);
        } catch (err) {
          console.error(`  ERROR updating pin ${doc.id}:`, err.message);
          throw err;
        }
      }
    }
  }
  console.log(`  Pins to update: ${pinsTouched}`);
  console.log('');

  // -------------------------------------------------------------------
  // 3. プロフィール統合
  // -------------------------------------------------------------------
  console.log('Profile merge:');
  const srcRef = familyRef.collection('members').doc(PROFILE_TO_KEEP);
  const dstRef = familyRef.collection('members').doc(NEW_UID);
  const srcSnap = await srcRef.get();

  let profileMerged = false;
  if (!srcSnap.exists) {
    console.log(`  WARN: source profile members/${PROFILE_TO_KEEP} does not exist — skipping merge.`);
  } else {
    const src = srcSnap.data();
    const dstSnap = await dstRef.get();
    const targetIsNew = !dstSnap.exists;

    const newProfile = {
      displayName: src.displayName ?? null,
      avatar: src.avatar ?? null,
      createdAt: src.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: Date.now(),
      legacyUid: NEW_UID,
    };

    console.log(`  Source: members/${PROFILE_TO_KEEP}`);
    console.log(`    displayName: ${JSON.stringify(src.displayName)}`);
    console.log(`    avatar: ${JSON.stringify(src.avatar)}`);
    console.log(`  Target: members/${NEW_UID} (${targetIsNew ? 'NEW' : 'OVERWRITE existing'})`);
    console.log(`  [${MODE}] write profile to members/${NEW_UID}`);

    if (isLive) {
      try {
        await dstRef.set(newProfile, { merge: false });
        profileMerged = true;
      } catch (err) {
        console.error(`  ERROR writing target profile:`, err.message);
        throw err;
      }
    } else {
      profileMerged = true; // dry-run でも "予定" としてカウント
    }
  }
  console.log('');

  // -------------------------------------------------------------------
  // 4. 旧 members 削除
  // -------------------------------------------------------------------
  console.log('Old members deletion:');
  let membersDeleted = 0;
  for (const oldUid of OLD_UIDS) {
    const ref = familyRef.collection('members').doc(oldUid);
    const snap = await ref.get();
    if (snap.exists) {
      console.log(`  [${MODE}] delete members/${oldUid}`);
      if (isLive) {
        try {
          await ref.delete();
        } catch (err) {
          console.error(`  ERROR deleting members/${oldUid}:`, err.message);
          throw err;
        }
      }
      membersDeleted++;
    } else {
      console.log(`  (skip) members/${oldUid} does not exist`);
    }
  }
  console.log(`  Members to delete: ${membersDeleted}`);
  console.log('');

  // -------------------------------------------------------------------
  // サマリー
  // -------------------------------------------------------------------
  console.log('====================================================================');
  console.log(`[${MODE}] Summary:`);
  console.log(`  Events updated     : ${eventsTouched}`);
  console.log(`  Pins updated       : ${pinsTouched}`);
  console.log(`  Profile merged     : ${profileMerged ? 'YES' : 'NO'}`);
  console.log(`  Old members deleted: ${membersDeleted}`);
  console.log('====================================================================');

  if (!isLive) {
    console.log('');
    console.log('Dry-run complete. Run with --live to apply changes.');
  } else {
    console.log('');
    console.log('LIVE migration complete.');
  }
}

main().catch((err) => {
  console.error('');
  console.error('============== FATAL ERROR ==============');
  console.error(err && err.stack ? err.stack : err);
  console.error('=========================================');
  process.exit(1);
});
