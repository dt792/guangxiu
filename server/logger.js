// 统一控制台日志格式：`2026-09-10 12:00:00 [scope] message`
// scope 约定：server（启动/HTTP）、worker（本地 AI worker）、cloud（阿里云百炼）
const ts = () => new Date().toLocaleString('sv-SE');

export const log = (scope, msg) => console.log(`${ts()} [${scope}] ${msg}`);
export const logErr = (scope, msg) => console.error(`${ts()} [${scope}] ${msg}`);

// 耗时格式化：12.3s
export const elapsed = (t0) => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

// 截断超长文本（错误详情 / 提示词），避免刷屏
export const short = (s, n = 200) => {
  const str = String(s);
  return str.length > n ? `${str.slice(0, n)}…` : str;
};
