// Auth routes (same endpoints as before).
import { Router } from 'express';

import * as users from '../users.js';
import { sysInfo } from '../store.js';

const router = Router();
const GUEST_TOKEN = 'GUEST';

// 管理员账号：与访客共用同一 user_id（“访客的管理员”）。
// 登录 Z 后操作的就是访客账号的数据，可向访客暂存区直传图片/视频。
export const ADMIN_USERNAME = 'Z';
const ADMIN_PASSWORD = '0';

function seedAdminAccount() {
  if (users.getAccountByUsername(ADMIN_USERNAME)) return;
  const guestId = Object.keys(sysInfo.data.users)[0] ?? sysInfo.createUser().id;
  users.createAccount(ADMIN_USERNAME, ADMIN_PASSWORD, guestId);
}
seedAdminAccount();

// 判断请求 token 是否属于管理员账号 Z
export function isAdminToken(token) {
  const userId = token ? users.resolveToken(token) : null;
  const account = userId ? users.getAccountByUserId(userId) : null;
  return !!account && account.username === ADMIN_USERNAME;
}

export function getTokenFromRequest(req) {
  const auth = req.headers.authorization ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return (req.headers['x-access-token'] ?? '').trim();
}

router.get('/first_user_id', (req, res) => {
  const token = getTokenFromRequest(req);
  if (token && token !== GUEST_TOKEN) {
    const userId = users.resolveToken(token);
    if (userId) return res.json(userId);
  }
  // 全新部署（无任何用户）时自动创建访客账号，
  // 否则返回空字符串会导致前端 user_id 为空、后续 CRUD 全部悬空
  const guest = Object.keys(sysInfo.data.users)[0] ?? sysInfo.createUser().id;
  res.json(guest);
});

router.post('/register', (req, res) => {
  const username = (req.body?.username ?? '').trim();
  const password = req.body?.password ?? '';
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (username.length < 2 || username.length > 20) {
    return res.status(400).json({ error: '用户名长度需为2-20个字符' });
  }
  if (password.length < 6) return res.status(400).json({ error: '密码长度不能少于6位' });
  if (users.getAccountByUsername(username)) {
    return res.status(409).json({ error: '用户名已存在' });
  }
  const userInfo = sysInfo.createUser();
  if (!users.createAccount(username, password, userInfo.id)) {
    return res.status(409).json({ error: '用户名已存在' });
  }
  res.json({ token: users.issueToken(userInfo.id), username, user_id: userInfo.id });
});

router.post('/login', (req, res) => {
  const username = (req.body?.username ?? '').trim();
  const password = req.body?.password ?? '';
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  const account = users.verifyPasswordByUsername(username, password);
  if (!account) return res.status(401).json({ error: '用户名或密码错误' });
  res.json({ token: users.issueToken(account.user_id), username, user_id: account.user_id });
});

router.post('/logout', (req, res) => {
  const token = getTokenFromRequest(req);
  if (token) users.revokeToken(token);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const token = getTokenFromRequest(req);
  const userId = token ? users.resolveToken(token) : null;
  if (!userId) return res.status(401).json({ error: '未登录' });
  res.json({ token, user_id: userId });
});

export default router;
