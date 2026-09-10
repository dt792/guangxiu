// 临时校验：sys.json / users.db 结构是否与 server/store.js、server/users.js 期望一致
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const problems = [];
const ok = (msg) => console.log(`OK   ${msg}`);
const bad = (msg) => { problems.push(msg); console.log(`FAIL ${msg}`); };

// ---------- sys.json ----------
const sys = JSON.parse(fs.readFileSync('server/tmp/sys.json', 'utf8'));
for (const key of ['publics', 'users', 'image_infos', 'detections', 'tasks']) {
  if (!(key in sys)) bad(`sys.json 缺少顶层键 "${key}"`);
}
if (problems.length === 0) ok('sys.json 顶层键齐全: publics/users/image_infos/detections/tasks');

const COLLECTIONS = [
  'uploads', 'generated_statics', 'temp_generated_statics',
  'generated_dynamics', 'temp_generated_dynamics',
  'segmentations', 'temp_segmentations',
];

// 用户条目
let userChecked = 0;
for (const [uid, u] of Object.entries(sys.users ?? {})) {
  userChecked++;
  for (const key of ['id', 'name', ...COLLECTIONS]) {
    if (!(key in u)) bad(`users.${uid} 缺少字段 "${key}"`);
    else if (COLLECTIONS.includes(key) && !Array.isArray(u[key])) bad(`users.${uid}.${key} 不是数组`);
  }
  if (u.id !== uid) bad(`users.${uid} 的 id 字段 (${u.id}) 与键不一致`);
}
ok(`用户条目检查完成，共 ${userChecked} 个`);

// image_infos 条目
const INFO_FIELDS = ['id', 'src', 'thumbnail', 'name', 'is_star', 'rating', 'update_time'];
let missingFiles = 0;
for (const [iid, info] of Object.entries(sys.image_infos ?? {})) {
  for (const f of INFO_FIELDS) {
    if (!(f in info)) bad(`image_infos.${iid} 缺少字段 "${f}"`);
  }
  if (info.src && !fs.existsSync('server/' + info.src)) missingFiles++;
  if (info.thumbnail && !fs.existsSync('server/' + info.thumbnail)) missingFiles++;
}
ok(`image_infos 检查完成，共 ${Object.keys(sys.image_infos ?? {}).length} 条`);
if (missingFiles) bad(`${missingFiles} 个 src/thumbnail 指向的文件在 server/ 下不存在（图片文件没一起拷过来？）`);

// 用户集合引用的 id 必须存在于 image_infos
let dangling = 0;
for (const [uid, u] of Object.entries(sys.users ?? {})) {
  for (const c of COLLECTIONS) {
    for (const iid of u[c] ?? []) {
      if (!sys.image_infos[iid]) { dangling++; if (dangling <= 3) bad(`users.${uid}.${c} 引用了不存在的 image id: ${iid}`); }
    }
  }
}
if (dangling) bad(`共 ${dangling} 处悬空引用`);
else ok('用户集合 → image_infos 引用完整');

// detections 条目
const DET_FIELDS = ['d_id', 'id', 'image_id', 'is_star', 'name', 'x1', 'y1', 'x2', 'y2', 'top', 'left'];
let detImgMissing = 0;
for (const d of sys.detections ?? []) {
  for (const f of DET_FIELDS) {
    if (!(f in d)) bad(`detection ${d.d_id ?? '?'} 缺少字段 "${f}"`);
  }
  if (d.id && !sys.image_infos[d.id]) detImgMissing++;
}
ok(`detections 检查完成，共 ${(sys.detections ?? []).length} 条`);
if (detImgMissing) bad(`${detImgMissing} 条 detections 指向的 image id 不存在`);

// ---------- users.db ----------
const db = new DatabaseSync('server/users.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
ok(`users.db 表: ${tables.join(', ') || '(无)'}`);
for (const t of ['accounts', 'tokens']) {
  if (!tables.includes(t)) bad(`users.db 缺少表 "${t}"`);
}
if (tables.includes('accounts')) {
  const cols = db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name);
  for (const c of ['id', 'username', 'password_hash', 'user_id', 'created_at']) {
    if (!cols.includes(c)) bad(`accounts 表缺少列 "${c}"（实际: ${cols.join(', ')}）`);
  }
  const rows = db.prepare('SELECT username, user_id, substr(password_hash,1,20) ph FROM accounts LIMIT 5').all();
  ok(`accounts 共 ${db.prepare('SELECT COUNT(*) c FROM accounts').get().c} 行，示例: ${JSON.stringify(rows)}`);
  // accounts.user_id 应在 sys.json users 里有对应（登录后取数据用）
  for (const r of db.prepare('SELECT user_id FROM accounts').all()) {
    if (!sys.users?.[r.user_id]) bad(`accounts.user_id=${r.user_id} 在 sys.json users 中不存在（ensureUser 会自动建空用户，不致命）`);
  }
}
if (tables.includes('tokens')) {
  const cols = db.prepare('PRAGMA table_info(tokens)').all().map(c => c.name);
  for (const c of ['token', 'user_id', 'expire_at']) {
    if (!cols.includes(c)) bad(`tokens 表缺少列 "${c}"（实际: ${cols.join(', ')}）`);
  }
  ok(`tokens 共 ${db.prepare('SELECT COUNT(*) c FROM tokens').get().c} 行`);
}

console.log(problems.length ? `\n共发现 ${problems.length} 个问题` : '\n全部通过');
