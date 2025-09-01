/* src/shared/utils.ts */

/* =========================
 * 通用工具
 * ========================= */

/** 解析 API Keys：支持逗号/空白/分号分隔 */
export function parseApiKeys(text: string): string[] {
  return (text || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 确保列表中包含某地址（若存在不重复添加） */
export function ensureListWithAddress(list: string[], addr: string): { list: string[]; existed: boolean } {
  const existed = list.includes(addr);
  return { list: existed ? list : [...list, addr], existed };
}

/** 中间省略（前 head 后 tail） */
export function middleEllipsis(s: string, head = 6, tail = 4): string {
  if (!s) return "";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}...${s.slice(-tail)}`;
}

/** 时间戳（秒或毫秒）格式化为 YYYY-MM-DD HH:mm:ss */
export function formatTime(ts: number): string {
  const ms = ts > 1e12 ? ts : ts * 1000; // 兼容秒/毫秒
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

/** 十进制字符串按 decimals 缩放为带小数的人类可读数（避免浮点） */
export function scaleAmount(raw: string, decimals = 0): string {
  const sign = raw.startsWith("-") ? "-" : "";
  const digits = raw.replace(/^-/, "");
  if (decimals <= 0) return sign + digits;
  const pad = digits.padStart(decimals + 1, "0");
  const int = pad.slice(0, -decimals);
  const frac = pad.slice(-decimals).replace(/0+$/, "");
  return sign + (frac ? `${int}.${frac}` : int);
}

/** 组合去重 Key（更稳，不仅依赖哈希） */
export function makeCompositeKey(o: {
  transaction_id: string;
  from: string;
  to: string;
  value: string;
  decimals: number;
  symbol: string;
  block_timestamp: number;
  token_address?: string;
}): string {
  const { transaction_id, from, to, value, decimals, symbol, block_timestamp, token_address = "" } = o;
  return [transaction_id, from, to, value, decimals, symbol, block_timestamp, token_address].join("|");
}

/* =========================
 * TRON Base58Check 校验 & 自动校验
 * ========================= */

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < B58_ALPHABET.length; i++) m[B58_ALPHABET[i]] = i;
  return m;
})();

function base58Decode(s: string): Uint8Array | null {
  if (!s || /[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/.test(s)) return null;
  let num = 0n;
  const base = 58n;
  for (const ch of s) {
    const v = B58_MAP[ch];
    if (typeof v !== "number") return null;
    num = num * base + BigInt(v);
  }
  let bytes: number[] = [];
  while (num > 0n) {
    bytes.push(Number(num % 256n));
    num = num / 256n;
  }
  bytes.reverse();
  // 前导 '1' -> 0x00
  let pad = 0;
  for (const ch of s) {
    if (ch === "1") pad++;
    else break;
  }
  if (pad) bytes = new Array(pad).fill(0).concat(bytes);
  return new Uint8Array(bytes);
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(buf);
  }
  // 极少数环境没有 WebCrypto：退化为“仅形状校验”
  return new Uint8Array();
}

/** 严格 TRON 地址校验：T + 34位 Base58 + Base58Check + 版本 0x41 */
export async function isValidTronAddress(addr: string): Promise<boolean> {
  const s = (addr || "").trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)) return false;
  const dec = base58Decode(s);
  if (!dec || dec.length < 25) return false;
  const payload = dec.slice(0, dec.length - 4);
  const checksum = dec.slice(dec.length - 4);
  const h1 = await sha256(payload);
  if (h1.length === 0) return true; // 退化：无加密 API 时不做强校验
  const h2 = await sha256(h1);
  const expect = h2.slice(0, 4);
  if (payload[0] !== 0x41) return false; // 版本位（0x41）
  for (let i = 0; i < 4; i++) if (checksum[i] !== expect[i]) return false;
  return true;
}

/* —— 自动校验候选 —— */

function isBase58HeadOk(x: string): boolean {
  return x.startsWith("T") && /^[T1-9A-HJ-NP-Za-km-z]*$/.test(x);
}

/** 放宽中间态长度到 31..36，便于“两次插入/删除”从 32 → 34 等修复 */
function quickShapeOk(x: string): boolean {
  return isBase58HeadOk(x) && x.length >= 31 && x.length <= 36;
}

function uniqPush<T>(set: Set<T>, v: T) {
  if (!set.has(v)) set.add(v);
}

/** 简易编辑距离（用于候选排序） */
function editDistance(a: string, b: string): number {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[n][m];
}

/** 判断字符是否拥有“大小写对”，且两者都在 Base58 字母表中 */
function hasTwinCase(ch: string): boolean {
  const up = ch.toUpperCase();
  const lo = ch.toLowerCase();
  if (up === lo) return false; // 非字母
  return B58_ALPHABET.includes(up) && B58_ALPHABET.includes(lo);
}
function flipCase(ch: string): string {
  const up = ch.toUpperCase();
  const lo = ch.toLowerCase();
  if (up === lo) return ch;
  return ch === up ? lo : up;
}
function replaceAt(s: string, i: number, c: string): string {
  return s.slice(0, i) + c + s.slice(i + 1);
}

/**
 * 生成 TRON 候选（完善版）
 * - 新增：若输入本身已是“有效 TRON 地址”，直接返回 [输入本身]（用于“正确但想确认”的场景）
 * - 33 位：尾补一位快路
 * - 34 位但无效：末位替换、全位置单替换、大小写双位翻转
 * - BFS 兜底：编辑距离 ≤ 2（替换/插入/删除），长度 34 时允许全位置替换；偏短时插入全索引
 * - 结果排序：编辑距离优先，略奖励尾部相同
 */
export async function generateTronCandidates(input: string, limit = 120): Promise<string[]> {
  const s = (input || "").trim();

  // ✅ 早返回：输入已合法 → 把自身作为唯一候选返回
  try {
    if (await isValidTronAddress(s)) {
      return [s];
    }
  } catch {
    // 忽略校验异常，继续走候选流程
  }

  const suggestions = new Set<string>();
  const visited = new Set<string>([s]);

  async function tryCollect(t: string) {
    if (t.length === 34 && (await isValidTronAddress(t))) {
      uniqPush(suggestions, t);
    }
  }

  // 关注位置：非法位、尾窗、关键中位
  const badIdx: number[] = [];
  if (s.length) {
    if (s[0] !== "T") badIdx.push(0);
    for (let i = 1; i < s.length; i++) if (!B58_ALPHABET.includes(s[i])) badIdx.push(i);
  }
  const tailStart = Math.max(1, s.length - 6);
  const tailIdx = Array.from({ length: Math.max(0, s.length - tailStart) }, (_, k) => tailStart + k);
  const midIdxRaw = [Math.floor(s.length / 4), Math.floor(s.length / 2), Math.floor((3 * s.length) / 4)];
  const midIdx = midIdxRaw.filter((i) => i > 0 && i < s.length);

  /* ========= 快路 1：33 位 → 末尾补 1 位 ========= */
  if (s.length === 33 && s.startsWith("T") && /^[1-9A-HJ-NP-Za-km-z]{32}$/.test(s.slice(1))) {
    for (const c of B58_ALPHABET) {
      const t = s + c;
      if (visited.has(t)) continue;
      visited.add(t);
      await tryCollect(t);
      if (suggestions.size >= limit) return Array.from(suggestions);
    }
  }

  /* ========= 快路 2：34 位但无效 → 末位替换 + 全位置单替换 + 大小写修复 ========= */
  if (s.length === 34 && s.startsWith("T") && /^[1-9A-HJ-NP-Za-km-z]{33}$/.test(s.slice(1))) {
    // 2.1 末位替换
    for (const c of B58_ALPHABET) {
      if (c === s.at(-1)) continue;
      const t = replaceAt(s, 33, c);
      if (visited.has(t)) continue;
      visited.add(t);
      await tryCollect(t);
      if (suggestions.size >= limit) return Array.from(suggestions);
    }

    // 2.2 全位置单替换（优先：尾窗/非法位/关键位 → 覆盖 1..33）
    const prefer = Array.from(new Set([...tailIdx, ...badIdx, ...midIdx])).filter((i) => i > 0 && i < s.length);
    const allIdx = Array.from({ length: s.length - 1 }, (_, k) => k + 1);
    const order = [...new Set([...prefer, ...allIdx])];
    for (const i of order) {
      const curr = s[i];
      for (const c of B58_ALPHABET) {
        if (c === curr) continue;
        const t = replaceAt(s, i, c);
        if (visited.has(t)) continue;
        visited.add(t);
        await tryCollect(t);
        if (suggestions.size >= limit) return Array.from(suggestions);
      }
    }

    // 2.3 大小写专用修复：尾位翻转 / 中间位翻转 / 中间+尾位双翻转
    const last = s[33];
    const lastTwin = hasTwinCase(last) ? flipCase(last) : null;

    // 尾位翻转
    if (lastTwin) {
      const t = replaceAt(s, 33, lastTwin);
      if (!visited.has(t)) {
        visited.add(t);
        await tryCollect(t);
        if (suggestions.size >= limit) return Array.from(suggestions);
      }
    }

    // 中间位翻转
    const midLetterIdx = order.filter((i) => hasTwinCase(s[i]));
    for (const i of midLetterIdx) {
      const t = replaceAt(s, i, flipCase(s[i]));
      if (!visited.has(t)) {
        visited.add(t);
        await tryCollect(t);
        if (suggestions.size >= limit) return Array.from(suggestions);
      }
    }

    // 中间 + 尾位 双翻转
    if (lastTwin) {
      for (const i of midLetterIdx) {
        const t1 = replaceAt(s, i, flipCase(s[i]));
        const t2 = replaceAt(t1, 33, lastTwin);
        if (!visited.has(t2)) {
          visited.add(t2);
          await tryCollect(t2);
          if (suggestions.size >= limit) return Array.from(suggestions);
        }
      }
    }
  }

  /* ========= BFS 兜底（编辑距离 ≤ 2） ========= */
  type Node = { str: string; d: number };
  const q: Node[] = [{ str: s, d: 0 }];

  // 核心索引（优先级高）
  const core = Array.from(
    new Set<number>([0, ...badIdx, ...tailIdx, ...midIdx, s.length - 1, s.length].filter((i) => i >= 0))
  );

  // 替换位置：34 长度时 = 全位置 1..33，否则 = core
  const replacePositions =
    s.length === 34 ? Array.from(new Set([...core, ...Array.from({ length: s.length - 1 }, (_, k) => k + 1)])) : core;

  // 插入位置：当整体偏短（≤33）时，扩展到“所有索引”；否则用 core
  const insertPositions =
    s.length <= 33
      ? Array.from(new Set([...core, ...Array.from({ length: s.length + 1 }, (_, i) => i)]))
      : core;

  // 删除位置：使用 core（不删首位）
  const deletePositions = core;

  const MAX_EXPANSIONS = 8000;
  let expansions = 0;

  while (q.length && suggestions.size < limit && expansions < MAX_EXPANSIONS) {
    const { str, d } = q.shift()!;
    if (d >= 2) continue; // 编辑距离 ≤ 2

    // —— 替换 ——（34 长度时可全位置替换）
    for (const iRaw of replacePositions) {
      if (iRaw < str.length) {
        const alph = iRaw === 0 ? ["T"] : B58_ALPHABET.split("");
        for (const c of alph) {
          if (c === str[iRaw]) continue;
          const t = replaceAt(str, iRaw, c);
          if (!quickShapeOk(t)) continue;
          if (visited.has(t)) continue;
          visited.add(t);
          expansions++;
          if (t.length === 34) await tryCollect(t);
          q.push({ str: t, d: d + 1 });
          if (suggestions.size >= limit || expansions >= MAX_EXPANSIONS) break;
        }
      }
      if (suggestions.size >= limit || expansions >= MAX_EXPANSIONS) break;
    }
    if (suggestions.size >= limit || expansions >= MAX_EXPANSIONS) break;

    // —— 插入 ——（当偏短时使用全索引）
    if (str.length < 35) {
      for (const iRaw of insertPositions) {
        const alph = iRaw === 0 ? ["T"] : B58_ALPHABET.split("");
        for (const c of alph) {
          const cand = str.slice(0, iRaw) + c + str.slice(iRaw);
          if (!quickShapeOk(cand)) continue;
          if (visited.has(cand)) continue;
          visited.add(cand);
          expansions++;
          if (cand.length === 34) await tryCollect(cand);
          q.push({ str: cand, d: d + 1 });
          if (suggestions.size >= limit || expansions >= MAX_EXPANSIONS) break;
        }
        if (suggestions.size >= limit || expansions >= MAX_EXPANSIONS) break;
      }
    }
    if (suggestions.size >= limit || expansions >= MAX_EXPANSIONS) break;

    // —— 删除 ——（不删首位）
    if (str.length > 33) {
      for (const iRaw of deletePositions) {
        if (iRaw < str.length && iRaw > 0) {
          const cand = str.slice(0, iRaw) + str.slice(iRaw + 1);
          if (!quickShapeOk(cand)) continue;
          if (visited.has(cand)) continue;
          visited.add(cand);
          expansions++;
          if (cand.length === 34) await tryCollect(cand);
          q.push({ str: cand, d: d + 1 });
          if (suggestions.size >= limit || expansions >= MAX_EXPANSIONS) break;
        }
      }
    }
  }

  // 兜底：仍无结果且 33 位 → 纯尾补
  if (suggestions.size === 0 && s.length === 33 && isBase58HeadOk(s)) {
    for (const c of B58_ALPHABET) {
      const t = s + c;
      try {
        if (await isValidTronAddress(t)) { suggestions.add(t); }
      } catch {}
      if (suggestions.size) break;
    }
  }

  // —— 候选排序（稳定）：编辑距离优先，略奖励尾部相同 —— //
  const scored = Array.from(suggestions).map((cand) => {
    const dist = editDistance(s, cand);
    let tailScore = 0;
    const tail = s.slice(-6), tail2 = cand.slice(-6);
    for (let i = 0; i < 6; i++) if (tail[i] === tail2[i]) tailScore++;
    const score = dist * 10 - tailScore;
    return { cand, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((x) => x.cand);
}

/* =========================
 * ETH 校验 & 自动校验（轻量）
 * ========================= */

/** 仅格式校验（0x + 40 十六进制）。如需 EIP-55，可在此基础上扩展 Keccak 校验。 */
export function isValidEthAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test((addr || "").trim());
}

/** 占位：如需 EIP-55 可在此实现 Keccak 版大小写校验 */
export function toChecksumAddress(addr: string): string {
  return addr;
}

/**
 * 生成 ETH 候选（编辑距离 ≤ 2）
 * - ✅ 若输入本身合法，直接返回 [输入本身]
 * - 允许替换/插入/删除；目标长度固定为 42（0x + 40）
 */
export async function generateEthCandidates(input: string, limit = 60): Promise<string[]> {
  const raw = (input || "").trim();
  const s = raw.startsWith("0x") ? raw : "0x" + raw.replace(/^0x/i, "");

  // ✅ 早返回：输入已合法
  if (isValidEthAddress(s)) {
    return [s];
  }

  const HEX = "0123456789abcdefABCDEF";
  const good = (x: string) => /^0x[a-fA-F0-9]{1,40}$/.test(x); // 中间态：1..40
  const finalOk = (x: string) => /^0x[a-fA-F0-9]{40}$/.test(x);

  const out = new Set<string>();
  const visited = new Set<string>([s]);
  const pushIf = (x: string) => { if (finalOk(x)) out.add(x); };

  // 快路：长度 41（差 1 位）→ 末尾补一位
  if (/^0x[a-fA-F0-9]{39}$/.test(s)) {
    for (const c of HEX) { pushIf(s + c); if (out.size) break; }
    if (out.size) return Array.from(out).slice(0, limit);
  }
  // 形式保留：长度 42 但失败（基本不会触发）→ 替换末位
  if (/^0x[a-fA-F0-9]{40}$/.test(s) && !finalOk(s)) {
    for (const c of HEX) { pushIf(s.slice(0, 41) + c); if (out.size) break; }
    if (out.size) return Array.from(out).slice(0, limit);
  }

  // 关注位置：非法位、尾窗、关键中位
  const body = s.slice(2);
  const badIdx: number[] = [];
  for (let i = 0; i < body.length; i++) if (!HEX.includes(body[i])) badIdx.push(i + 2);
  const tailStart = Math.max(2, s.length - 6);
  const tailIdx = Array.from({ length: Math.max(0, s.length - tailStart) }, (_, k) => tailStart + k);
  const midRaw = [Math.floor(s.length / 4), Math.floor(s.length / 2), Math.floor((3 * s.length) / 4)];
  const midIdx = midRaw.filter((i) => i > 1 && i < s.length);
  const editPositions = Array.from(new Set<number>([2, ...badIdx, ...tailIdx, ...midIdx, s.length - 1, s.length]));

  type Node = { str: string; d: number };
  const q: Node[] = [{ str: s, d: 0 }];
  const MAX_EXP = 4000;
  let exp = 0;

  while (q.length && out.size < limit && exp < MAX_EXP) {
    const { str, d } = q.shift()!;
    if (d >= 2) continue;

    // 替换
    for (const iRaw of editPositions) {
      if (iRaw < str.length && iRaw >= 2) {
        const okHere = HEX.includes(str[iRaw]);
        const shouldWide = d === 0 && (badIdx.includes(iRaw) || tailIdx.includes(iRaw) || midIdx.includes(iRaw));
        if (shouldWide || !okHere) {
          for (const c of HEX) {
            if (c === str[iRaw]) continue;
            const t = str.slice(0, iRaw) + c + str.slice(iRaw + 1);
            if (!good(t) || visited.has(t)) continue;
            visited.add(t);
            exp++;
            if (finalOk(t)) pushIf(t);
            q.push({ str: t, d: d + 1 });
            if (out.size >= limit || exp >= MAX_EXP) break;
          }
        }
      }
      if (out.size >= limit || exp >= MAX_EXP) break;
    }
    if (out.size >= limit || exp >= MAX_EXP) break;

    // 插入
    if (str.length < 42) {
      for (const iRaw of editPositions) {
        if (iRaw < 2) continue;
        for (const c of HEX) {
          const t = str.slice(0, iRaw) + c + str.slice(iRaw);
          if (!good(t) || visited.has(t)) continue;
          visited.add(t);
          exp++;
          if (finalOk(t)) pushIf(t);
          q.push({ str: t, d: d + 1 });
          if (out.size >= limit || exp >= MAX_EXP) break;
        }
        if (out.size >= limit || exp >= MAX_EXP) break;
      }
    }
    if (out.size >= limit || exp >= MAX_EXP) break;

    // 删除
    if (str.length > 42) {
      for (const iRaw of editPositions) {
        if (iRaw < str.length && iRaw >= 2) {
          const t = str.slice(0, iRaw) + str.slice(iRaw + 1);
          if (good(t) && !visited.has(t)) {
            visited.add(t);
            exp++;
            if (finalOk(t)) pushIf(t);
            q.push({ str: t, d: d + 1 });
            if (out.size >= limit || exp >= MAX_EXP) break;
          }
        }
      }
    }
  }

  // 兜底：长度 41 → 纯尾补
  if (out.size === 0 && /^0x[a-fA-F0-9]{39}$/.test(s)) {
    for (const c of HEX) {
      const t = s + c;
      if (finalOk(t)) { out.add(t); break; }
    }
  }

  // 候选排序
  const scored = Array.from(out).map((cand) => ({ cand, score: editDistance(s, cand) }));
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((x) => x.cand);
}

/* ========== DEV 快速自检（不会影响生产） ========== */
if (import.meta?.env?.DEV) {
  // TRON 形状断言
  console.assert(/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test("TUrpa3h7bZFkmaL6pDHDaKxpc1V9ots1gm"), "TRON 基本形状断言失败");
  // ETH 形状断言
  console.assert(/^0x[a-fA-F0-9]{40}$/.test("0x4F23D5907a5cE83CD31e29Eb610e158fC1A9Ab38"), "ETH 基本形状断言失败");
}
