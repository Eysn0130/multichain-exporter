import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  FileSpreadsheet,
  Play,
  Square,
  Trash2,
  Download,
  Settings,
  KeyRound,
  AlertTriangle,
  Link as LinkIcon,
  PlusCircle,
  Send,
  Wand2,
  CheckCircle2,
  XCircle,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

import {
  parseApiKeys,
  ensureListWithAddress,
  middleEllipsis,
  formatTime,
  scaleAmount,
  makeCompositeKey,
  isValidTronAddress,
  generateTronCandidates,
} from "@/shared/utils";

type AddrState = "pending" | "running" | "done" | "error";
type ValidState = "unknown" | "checking" | "valid" | "invalid";

/* ============== 输入即时校验 + 右侧状态图标 ============== */
function useDebouncedAsyncValidator<V>(
  value: V,
  validate: (v: V) => Promise<boolean> | boolean,
  delay = 250
) {
  const [valid, setValid] = React.useState<"idle" | "valid" | "invalid">("idle");
  React.useEffect(() => {
    if (!value) {
      setValid("idle");
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const ok = await validate(value);
        if (!alive) return;
        setValid(ok ? "valid" : "invalid");
      } catch {
        if (!alive) return;
        setValid("invalid");
      }
    }, delay);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [value, validate, delay]);

  return valid;
}

function ValidatedInput(props: {
  id?: string;
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  validate: (v: string) => Promise<boolean> | boolean;
  onValidityChange?: (ok: boolean) => void;
}) {
  const { id, value, onChange, placeholder, disabled, className, validate, onValidityChange } = props;
  const valid = useDebouncedAsyncValidator(value, validate, 250);

  React.useEffect(() => {
    if (!onValidityChange) return;
    if (valid === "idle") return;
    onValidityChange(valid === "valid");
  }, [valid, onValidityChange]);

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        className={`pr-10 ${className ?? ""}`}
      />
      {valid === "valid" && value ? (
        <CheckCircle2
          className="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5 text-emerald-500"
          aria-label="地址正确"
        />
      ) : null}
      {valid === "invalid" && value ? (
        <XCircle
          className="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5 text-rose-500"
          aria-label="地址错误"
        />
      ) : null}
    </div>
  );
}
/* ========================================================= */

export default function TronView() {
  // ============== USDT 合约常量与类型 ==============
  const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // TRC20 USDT

  type AccountStatRow = {
    地址: string;
    标签: string;
    余额USDT: string; // 原始（导出用）
    首次交易时间: string;
    最近交易时间: string;
    最近流出时间: string;
    流入金额USDT: string; // 原始字符串
    流入笔数: number;
    流入地址数: number;
    流出金额USDT: string; // 原始字符串
    流出笔数: number;
    流出地址数: number;
  };

  // ========= 展示层工具（仅前端渲染，导出不变） =========
  function middleEllipsisFixed(s: string, head = 7, tail = 6) {
    if (!s) return "";
    if (s.length <= head + tail) return s;
    return `${s.slice(0, head)}...${s.slice(-tail)}`;
  }
  /** 展示层金额格式化（保留两位小数 + 万/亿），导出不变 */
  function formatHumanAmount2(raw: string | number): string {
    const n = Number(raw ?? 0);
    if (!Number.isFinite(n)) return String(raw ?? "");
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
    if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(2)}万`;
    return `${sign}${abs.toFixed(2)}`;
  }
  /** 时间单元：日期/时间分行 & 居中（导出不变） */
  function TimeCell({ value }: { value: string }) {
    if (!value || value === "-") return <div className="text-center">-</div>;
    const [d, t] = String(value).split(" ");
    return (
      <div className="text-center leading-tight">
        <div>{d || value}</div>
        {t ? <div>{t}</div> : null}
      </div>
    );
  }
  /** 地址单元（账户情况用）：前7后6 + 悬浮完整 + 可复制（横排气泡） */
  function AddressCell({ addr }: { addr: string }) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const copyAddr = async () => {
      try {
        await navigator.clipboard.writeText(addr);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      } catch {}
    };
    return (
      <div
        className="relative inline-block"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => { setOpen(false); setCopied(false); }}
      >
        <span className="font-mono text-xs">{middleEllipsisFixed(addr, 7, 6)}</span>
        {open && (
          <div className="absolute left-1/2 -translate-x-1/2 z-30" style={{ top: "115%" }}>
            <div className="rounded-md border bg-white shadow-lg px-2 py-1 flex items-center gap-2 whitespace-nowrap max-w-[520px]">
              <span className="font-mono text-xs">{addr}</span>
              <button
                onClick={copyAddr}
                className={`ml-1 h-6 w-6 inline-flex items-center justify-center rounded-md ${copied ? "bg-emerald-500 text-white" : "hover:bg-neutral-100"}`}
                title="复制地址"
              >
                {copied ? (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M20 6L9 17l-5-5" strokeWidth="2" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
              {copied ? <span className="text-xs text-emerald-600">已复制</span> : null}
            </div>
          </div>
        )}
      </div>
    );
  }

  // 队列与数据
  const [addresses, setAddresses] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);          // Transfers（保持原有）
  const [txRows, setTxRows] = useState<any[]>([]);      // Transactions（新增）
  const [errors, setErrors] = useState<{ address: string; message: string }[]>([]);
  const [errorAlertVisible, setErrorAlertVisible] = useState(false);
  const errorTimerRef = useRef<number | null>(null);

  // 参数
  const [endpoint, setEndpoint] = useState("https://api.trongrid.io");
  const [contract, setContract] = useState("");
  const [concurrency, setConcurrency] = useState(3);
  const [timeoutMs, setTimeoutMs] = useState(15000);
  const [pauseMs, setPauseMs] = useState(220);
  const [qpsMax, setQpsMax] = useState(12);

  // API Keys
  const [apiKeysText, setApiKeysText] = useState("");
  const apiKeys = useMemo(() => parseApiKeys(apiKeysText), [apiKeysText]);
  const [needApiKey, setNeedApiKey] = useState(false);

  // 单地址输入（用于即时校验与自动校验）
  const [singleInput, setSingleInput] = useState("");

  // 运行状态
  const [isRunning, setIsRunning] = useState(false);
  const [addrStatus, setAddrStatus] = useState<
    Record<string, { status: AddrState; count: number; pages: number; message?: string }>
  >({});
  const [validMap, setValidMap] = useState<Record<string, ValidState>>({});
  const [inputCandidates, setInputCandidates] = useState<string[]>([]);
  const [inputSuggestOpen, setInputSuggestOpen] = useState(false);
  const [rowCandidates, setRowCandidates] = useState<Record<string, string[] | undefined>>({});

  // 自动校验按钮 2s 成功态
  const [inputAutoOK, setInputAutoOK] = useState(false);
  const [rowAutoOK, setRowAutoOK] = useState<Record<string, boolean>>({});

  // 账户情况（USDT）
  const [acctStats, setAcctStats] = useState<AccountStatRow[]>([]);
  const [acctStatStatus, setAcctStatStatus] = useState<Record<string, AddrState>>({});
  const [acctStatErrors, setAcctStatErrors] = useState<{ address: string; message: string }[]>([]);
  const [isAcctRunning, setIsAcctRunning] = useState(false);

  const runningCount = useMemo(
    () => Object.values(addrStatus).filter((s) => s?.status === "running").length,
    [addrStatus]
  );
  const finishedCount = useMemo(
    () =>
      addresses.reduce(
        (acc, a) => acc + ((addrStatus[a]?.status === "done" || addrStatus[a]?.status === "error") ? 1 : 0),
        0
      ),
    [addresses, addrStatus]
  );
  const allDone = useMemo(
    () => addresses.length > 0 && finishedCount === addresses.length && !isRunning,
    [finishedCount, addresses, isRunning]
  );

  const cancelRef = useRef({ cancelled: false });

  // 错误提示 10s 自动消失
  useEffect(() => {
    if (errors.length > 0) {
      setErrorAlertVisible(true);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = window.setTimeout(() => {
        setErrorAlertVisible(false);
        errorTimerRef.current = null;
      }, 10000);
    }
    return () => {
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
    };
  }, [errors]);

  // 简单 QPS 控制
  const rateRef = useRef<{ windowMs: number; hits: number[] }>({ windowMs: 1000, hits: [] });
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
  async function acquireToken(): Promise<void> {
    const now = Date.now();
    const { windowMs } = rateRef.current;
    rateRef.current.hits = rateRef.current.hits.filter((t) => now - t < windowMs);
    if (rateRef.current.hits.length >= Math.max(1, qpsMax)) {
      const wait = windowMs - (now - rateRef.current.hits[0]);
      await sleep(Math.max(0, wait));
      return acquireToken();
    }
    rateRef.current.hits.push(Date.now());
  }
  function pick<T>(arr: T[]): T | undefined {
    return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
  }

  // Excel 模板 / 导入 / 导出
  function downloadTemplate(): void {
    const wb = XLSX.utils.book_new();
    const data = [["待查钱包地址"], ["TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"], ["TYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY"]];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "模板");
    XLSX.writeFile(wb, "TRON_批量查询模板.xlsx");
  }
  async function handleFile(file: File): Promise<void> {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const first = wb.Sheets[wb.SheetNames[0]];
    const arr = XLSX.utils.sheet_to_json<any[]>(first, { header: 1 });
    const out: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      const cell = (arr[i]?.[0] ?? "").toString().trim();
      if (!cell) continue;
      if (i === 0 && (cell === "待查钱包地址" || cell.toLowerCase().includes("address"))) continue;
      out.push(cell);
    }
    const uniq = Array.from(new Set(out));
    setAddresses(uniq);
    const st: Record<string, any> = {};
    const vm: Record<string, ValidState> = {};
    uniq.forEach((a) => {
      st[a] = { status: "pending", count: 0, pages: 0 };
      vm[a] = "checking";
    });
    setAddrStatus(st);
    setValidMap(vm);
    // 批量异步校验
    void validateMany(uniq);
    setRows([]);
    setTxRows([]);
    setErrors([]);
    // 清空账户情况
    clearAcctStats();
  }

  // === 导出：Excel（两个 sheet：转账Transfers / 交易Transactions） ===
  function downloadExcel(): void {
    const wb = XLSX.utils.book_new();

    const wsTransfers = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, wsTransfers, "转账Transfers");

    const wsTx = XLSX.utils.json_to_sheet(txRows);
    XLSX.utils.book_append_sheet(wb, wsTx, "交易Transactions");

    XLSX.writeFile(
      wb,
      `TRON_查询结果_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.xlsx`
    );
  }

  // === 导出：CSV（分别触发两个文件下载） ===
  function downloadCSV(): void {
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

    const ws1 = XLSX.utils.json_to_sheet(rows);
    const csv1 = XLSX.utils.sheet_to_csv(ws1);
    const blob1 = new Blob([csv1], { type: "text/csv;charset=utf-8;" });
    const a1 = document.createElement("a");
    a1.href = URL.createObjectURL(blob1);
    a1.download = `TRON_查询结果_转账Transfers_${ts}.csv`;
    a1.click();
    URL.revokeObjectURL(a1.href);

    const ws2 = XLSX.utils.json_to_sheet(txRows);
    const csv2 = XLSX.utils.sheet_to_csv(ws2);
    const blob2 = new Blob([csv2], { type: "text/csv;charset=utf-8;" });
    const a2 = document.createElement("a");
    a2.href = URL.createObjectURL(blob2);
    a2.download = `TRON_查询结果_交易Transactions_${ts}.csv`;
    a2.click();
    URL.revokeObjectURL(a2.href);
  }

  // ========== TRC20 转账（保持原逻辑） ==========
  async function fetchTrc20ForAddress(addr: string): Promise<any[]> {
    const base = `${endpoint.replace(/\/$/, "")}/v1/accounts/${addr}/transactions/trc20`;
    const rowsOut: any[] = [];
    const seen = new Set<string>();
    let page = 0;
    const updateStatus = (patch: Partial<{ status: any; count: number; pages: number; message?: string }>) => {
      setAddrStatus((prev) => ({ ...prev, [addr]: { ...prev[addr], ...patch } }));
    };
    const qs = new URLSearchParams({
      only_confirmed: "true",
      limit: "200",
      order_by: "block_timestamp,desc",
      search_internal: "false",
    });
    if (contract.trim()) qs.set("contract_address", contract.trim());
    const toAbs = (u: string) =>
      /^https?:\/\//i.test(u) ? u : `${endpoint.replace(/\/$/, "")}${u.startsWith("/") ? u : "/" + u}`;
    let nextURL: string | null = `${base}?${qs.toString()}`;
    updateStatus({ status: "running" });

    while (!cancelRef.current.cancelled && nextURL) {
      page += 1;
      const key = pick(apiKeys) || "";
      if (!key) {
        setNeedApiKey(true);
        const msg = "请输入有效的 API Key";
        setErrors((prev) => (prev.some((e) => e.message === msg) ? prev : [...prev, { address: "", message: msg }]));
        updateStatus({ status: "error", message: "", pages: page - 1, count: rowsOut.length });
        break;
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let resp: Response | null = null;
      try {
        await acquireToken();
        resp = await fetch(nextURL, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "TRON-PRO-API-KEY": key,
            "User-Agent": "Mozilla/5.0",
          },
          signal: ctrl.signal,
        });
      } catch {
        clearTimeout(timer);
        await sleep(800);
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (!resp.ok) {
        if (resp.status === 401) {
          setNeedApiKey(true);
          const msg = "请输入有效的 API Key";
          setErrors((es) => (es.some((x) => x.message === msg) ? es : [...es, { address: "", message: msg }]));
          updateStatus({ status: "error", message: "", pages: page - 1, count: rowsOut.length });
          break;
        }
        const retryAfter = Number(resp.headers.get("retry-after"));
        if ([429, 403, 500, 502, 503, 504].includes(resp.status)) {
          let wait = 1200;
          if (Number.isFinite(retryAfter) && retryAfter !== 0) wait = Math.max(1000, retryAfter * 1000);
          else if (resp.status === 403) wait = Math.max(wait, 30000);
          await sleep(wait);
          continue;
        }
        const msg = `${resp.status} ${resp.statusText}`;
        setErrors((es) => [...es, { address: addr, message: msg }]);
        updateStatus({ status: "error", message: msg, pages: page - 1, count: rowsOut.length });
        break;
      }

      let json: any = null;
      try {
        json = await resp.json();
      } catch {
        await sleep(500);
        continue;
      }

      const data: any[] = Array.isArray(json?.data) ? json.data : [];
      if (!data.length) {
        updateStatus({ status: "done", pages: page - 1, count: rowsOut.length });
        break;
      }

      for (const it of data) {
        if (it?.type === "Approval") continue;
        const ti = it?.token_info || {};
        const dec = Number(ti?.decimals || 0) || 0;
        const id = String(it?.transaction_id || "");
        const from = it?.from || "";
        const to = it?.to || "";
        const rawVal = String(it?.value ?? "0");
        const symbol = ti?.symbol || "";
        const tokenAddr = ti?.address || "";
        const ts = Number(it?.block_timestamp || 0);
        const compKey = makeCompositeKey({
          transaction_id: id,
          from,
          to,
          value: rawVal,
          decimals: dec,
          symbol,
          block_timestamp: ts,
          token_address: tokenAddr,
        });
        if (!seen.has(compKey)) {
          seen.add(compKey);
          rowsOut.push({
            地址: addr,
            哈希: id,
            转入地址: from,
            转出地址: to,
            数量: scaleAmount(rawVal, dec),
            代币: symbol,
            时间: formatTime(ts),
          });
        }
      }

      const nextLink: string | undefined = json?.meta?.links?.next;
      const fingerprint: string | undefined = json?.meta?.fingerprint;
      if (nextLink) {
        nextURL = toAbs(nextLink);
      } else if (fingerprint) {
        const url = new URL(base);
        url.searchParams.set("only_confirmed", "true");
        url.searchParams.set("limit", "200");
        url.searchParams.set("order_by", "block_timestamp,desc");
        url.searchParams.set("search_internal", "false");
        if (contract.trim()) url.searchParams.set("contract_address", contract.trim());
        nextURL = url.toString();
      } else {
        updateStatus({ status: "done", pages: page, count: rowsOut.length });
        break;
      }

      updateStatus({ pages: page, count: rowsOut.length });
      const tiny = data.length <= 1;
      await sleep(tiny ? Math.max(pauseMs * 5, 2000) : pauseMs);
    }

    return rowsOut;
  }

  // ========== 新增：账户“交易（Transactions）” ==========
  async function fetchTransactionsForAddress(addr: string): Promise<any[]> {
    const base = `${endpoint.replace(/\/$/, "")}/v1/accounts/${addr}/transactions`;
    const listOut: any[] = [];
    const seenTx = new Set<string>();
    let nextURL: string | null = `${base}?${new URLSearchParams({
      only_confirmed: "true",
      limit: "200",
      order_by: "block_timestamp,desc",
    }).toString()}`;

    const toAbs = (u: string) =>
      /^https?:\/\//i.test(u) ? u : `${endpoint.replace(/\/$/, "")}${u.startsWith("/") ? u : "/" + u}`;

    while (!cancelRef.current.cancelled && nextURL) {
      const key = pick(apiKeys) || "";
      if (!key) {
        setNeedApiKey(true);
        const msg = "请输入有效的 API Key";
        setErrors((prev) => (prev.some((e) => e.message === msg) ? prev : [...prev, { address: addr, message: msg }]));
        break;
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let resp: Response | null = null;

      try {
        await acquireToken();
        resp = await fetch(nextURL, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "TRON-PRO-API-KEY": key,
            "User-Agent": "Mozilla/5.0",
          },
          signal: ctrl.signal,
        });
      } catch {
        clearTimeout(timer);
        await sleep(600);
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (!resp.ok) {
        const retryAfter = Number(resp.headers.get("retry-after"));
        if ([429, 403, 500, 502, 503, 504].includes(resp.status)) {
          let wait = 1200;
          if (Number.isFinite(retryAfter) && retryAfter !== 0) wait = Math.max(1000, retryAfter * 1000);
          else if (resp.status === 403) wait = Math.max(wait, 30000);
          await sleep(wait);
          continue;
        }
        const msg = `TX ${resp.status} ${resp.statusText}`;
        setErrors((es) => [...es, { address: addr, message: msg }]);
        break;
      }

      let json: any = null;
      try {
        json = await resp.json();
      } catch {
        await sleep(300);
        continue;
      }

      const data: any[] = Array.isArray(json?.data) ? json.data : [];
      if (!data.length) break;

      for (const it of data) {
        const txid: string = String(it?.txID || it?.transaction_id || "");
        if (!txid || seenTx.has(txid)) continue;
        seenTx.add(txid);

        const ts = Number(it?.block_timestamp || 0);
        const ret = it?.ret?.[0]?.contractRet || "";
        const c0 = it?.raw_data?.contract?.[0] || {};
        const type: string =
          String(c0?.type || "") ||
          String(c0?.parameter?.type_url || "").split(".").pop() ||
          "";

        const val = c0?.parameter?.value || {};
        let from = val?.owner_address || "";
        let to = val?.to_address || val?.contract_address || "";
        let amountSun: string | number | undefined =
          val?.amount ?? val?.call_value ?? undefined;
        const amountTrx = amountSun != null ? scaleAmount(String(amountSun), 6) : "";

        listOut.push({
          地址: addr,
          哈希: txid,
          类型: type,
          发起地址: from,
          接收地址: to,
          金额TRX: amountTrx,
          状态: ret || "",
          时间: ts ? formatTime(ts) : "",
        });
      }

      const nextLink: string | undefined = json?.meta?.links?.next;
      const fingerprint: string | undefined = json?.meta?.fingerprint;
      if (nextLink) nextURL = toAbs(nextLink);
      else if (fingerprint) {
        const url = new URL(base);
        url.searchParams.set("only_confirmed", "true");
        url.searchParams.set("limit", "200");
        url.searchParams.set("order_by", "block_timestamp,desc");
        url.searchParams.set("fingerprint", fingerprint);
        nextURL = url.toString();
      } else {
        nextURL = null;
      }

      await sleep(pauseMs);
    }

    return listOut;
  }

  // ===== 格式化 USDT（BigInt 累计 → 字符串），用于账户情况内部计算 =====
  function formatUsdtFromRaw(raw: bigint, decimals = 6): string {
    const base = BigInt(10) ** BigInt(decimals);
    const sign = raw < 0n ? "-" : "";
    const abs = raw < 0n ? -raw : raw;
    const intPart = abs / base;
    const fracPart = abs % base;
    const fracStr = fracPart.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${sign}${intPart.toString()}${fracStr ? "." + fracStr : ""}`;
  }

  // ===== TRONSCAN 标签获取（尽力而为）=====
  async function fetchTronscanTag(addr: string): Promise<string> {
    const url = `https://apilist.tronscanapi.com/api/account/tag?address=${addr}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) return "";
      const data = await resp.json();
      if (Array.isArray(data?.tags) && data.tags.length) return String(data.tags[0]);
      if (Array.isArray(data?.data) && data.data.length) {
        const t = data.data[0];
        return String(t?.tag || t?.name || "");
      }
      if (typeof data?.data === "object" && data?.data) {
        return String(data.data?.tag || data.data?.name || "");
      }
      return "";
    } catch {
      return "";
    }
  }

  // ===== 聚合 USDT 账户情况（TronGrid 分页） =====
  async function fetchUsdtAccountStat(addr: string): Promise<AccountStatRow> {
    const base = `${endpoint.replace(/\/$/, "")}/v1/accounts/${addr}/transactions/trc20`;
    const qs = new URLSearchParams({
      only_confirmed: "true",
      limit: "200",
      order_by: "block_timestamp,desc",
      search_internal: "false",
      contract_address: USDT_CONTRACT,
    });

    const toAbs = (u: string) =>
      /^https?:\/\//i.test(u) ? u : `${endpoint.replace(/\/$/, "")}${u.startsWith("/") ? u : "/" + u}`;
    let nextURL: string | null = `${base}?${qs.toString()}`;

    let decimals = 6;
    let inRaw = 0n,
      outRaw = 0n;
    let inCount = 0,
      outCount = 0;
    const inAddrSet = new Set<string>();
    const outAddrSet = new Set<string>();
    let tsMin = Number.POSITIVE_INFINITY;
    let tsMax = 0;
    let lastOutTs = 0;

    setAcctStatStatus((prev) => ({ ...prev, [addr]: "running" as AddrState }));

    while (!cancelRef.current.cancelled && nextURL) {
      const key = pick(apiKeys) || "";
      if (!key) {
        setNeedApiKey(true);
        const msg = "请输入有效的 API Key";
        setAcctStatErrors((es) => (es.some((x) => x.message === msg) ? es : [...es, { address: addr, message: msg }]));
        setAcctStatStatus((prev) => ({ ...prev, [addr]: "error" }));
        break;
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let resp: Response | null = null;

      try {
        await acquireToken();
        resp = await fetch(nextURL, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "TRON-PRO-API-KEY": key,
            "User-Agent": "Mozilla/5.0",
          },
          signal: ctrl.signal,
        });
      } catch {
        clearTimeout(timer);
        await sleep(600);
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (!resp.ok) {
        const retryAfter = Number(resp.headers.get("retry-after"));
        if ([429, 403, 500, 502, 503, 504].includes(resp.status)) {
          let wait = 1200;
          if (Number.isFinite(retryAfter) && retryAfter !== 0) wait = Math.max(1000, retryAfter * 1000);
          else if (resp.status === 403) wait = Math.max(wait, 30000);
          await sleep(wait);
          continue;
        }
        const msg = `${resp.status} ${resp.statusText}`;
        setAcctStatErrors((es) => [...es, { address: addr, message: msg }]);
        setAcctStatStatus((prev) => ({ ...prev, [addr]: "error" }));
        break;
      }

      let json: any = null;
      try {
        json = await resp.json();
      } catch {
        await sleep(300);
        continue;
      }

      const list: any[] = Array.isArray(json?.data) ? json.data : [];
      if (!list.length) break;

      for (const it of list) {
        if (it?.type === "Approval") continue;
        const ti = it?.token_info || {};
        if (typeof ti?.decimals === "number") decimals = ti.decimals;
        const ts = Number(it?.block_timestamp || 0);
        if (ts > 0) {
          if (ts < tsMin) tsMin = ts;
          if (ts > tsMax) tsMax = ts;
        }
        const from = it?.from || "";
        const to = it?.to || "";
        const valRaw = BigInt(String(it?.value ?? "0"));
        if (to === addr) {
          inRaw += valRaw;
          inCount += 1;
          if (from) inAddrSet.add(from);
        }
        if (from === addr) {
          outRaw += valRaw;
          outCount += 1;
          if (to) outAddrSet.add(to);
          if (ts > lastOutTs) lastOutTs = ts;
        }
      }

      const nextLink: string | undefined = json?.meta?.links?.next;
      const fingerprint: string | undefined = json?.meta?.fingerprint;
      if (nextLink) nextURL = toAbs(nextLink);
      else if (fingerprint) {
        const url = new URL(base);
        url.searchParams.set("only_confirmed", "true");
        url.searchParams.set("limit", "200");
        url.searchParams.set("order_by", "block_timestamp,desc");
        url.searchParams.set("search_internal", "false");
        url.searchParams.set("contract_address", USDT_CONTRACT);
        url.searchParams.set("fingerprint", fingerprint);
        nextURL = url.toString();
      } else {
        nextURL = null;
      }
    }

    const tag = await fetchTronscanTag(addr).catch(() => "");

    const balanceRaw = inRaw - outRaw;
    const row: AccountStatRow = {
      地址: addr,
      标签: tag || "",
      余额USDT: formatUsdtFromRaw(balanceRaw, decimals),
      首次交易时间: Number.isFinite(tsMin) ? formatTime(tsMin) : "-",
      最近交易时间: tsMax > 0 ? formatTime(tsMax) : "-",
      最近流出时间: lastOutTs > 0 ? formatTime(lastOutTs) : "-",
      流入金额USDT: formatUsdtFromRaw(inRaw, decimals),
      流入笔数: inCount,
      流入地址数: inAddrSet.size,
      流出金额USDT: formatUsdtFromRaw(outRaw, decimals),
      流出笔数: outCount,
      流出地址数: outAddrSet.size,
    };

    setAcctStatStatus((prev) => ({ ...prev, [addr]: "done" as AddrState }));
    return row;
  }

  // 批量 / 单地址 控制（自动触发账户情况 + 交易）
  async function runAll(): Promise<void> {
    if (!addresses.length) return;

    // 账户情况：准备状态
    setIsAcctRunning(true);
    clearAcctStats();
    setAcctStatStatus((prev) => {
      const n: Record<string, AddrState> = { ...prev };
      addresses.forEach((a) => (n[a] = "pending"));
      return n;
    });

    setIsRunning(true);
    cancelRef.current.cancelled = false;

    // ✅ 批量前覆盖旧“查询结果”
    setRows([]);
    setTxRows([]);
    setErrors([]);

    let cursor = 0;

    const worker = async () => {
      while (!cancelRef.current.cancelled) {
        const i = cursor++;
        if (i >= addresses.length) return;
        const addr = addresses[i];
        try {
          // 1) 转账（TRC20）
          const part = await fetchTrc20ForAddress(addr);
          setRows((prev) => [...prev.filter((r) => r.地址 !== addr), ...part]);
          setAddrStatus((prev) => ({ ...prev, [addr]: { ...prev[addr], status: "done", count: part.length } }));

          // 2) 账户情况（USDT）
          const statRow = await fetchUsdtAccountStat(addr);
          setAcctStats((prev) => [...prev.filter((x) => x.地址 !== addr), statRow]);

          // 3) 交易（Transactions）
          const txPart = await fetchTransactionsForAddress(addr);
          setTxRows((prev) => [...prev.filter((r) => r.地址 !== addr), ...txPart]);
        } catch (e: any) {
          setErrors((es) => [...es, { address: addr, message: e?.message || "未知错误" }]);
          setAddrStatus((prev) => ({ ...prev, [addr]: { ...prev[addr], status: "error", message: String(e || "") } }));
          setAcctStatErrors((es) => [...es, { address: addr, message: e?.message || "未知错误" }]);
          setAcctStatStatus((prev) => ({ ...prev, [addr]: "error" }));
        }
      }
    };
    const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
    await Promise.all(workers);
    setIsRunning(false);
    setIsAcctRunning(false);
  }

  async function runOne(): Promise<void> {
    const addr = String(singleInput || "").trim();
    if (!addr) return;

    if (apiKeys.length === 0) {
      setNeedApiKey(true);
      const msg = "请输入有效的 API Key";
      setErrors((prev) => (prev.some((e) => e.message === msg) ? prev : [...prev, { address: "", message: msg }]));
      return;
    }

    setAddresses((prev) => {
      const res = ensureListWithAddress(prev, addr);
      if (!addrStatus[addr]) setAddrStatus((p) => ({ ...p, [addr]: { status: "pending", count: 0, pages: 0 } }));
      if (!validMap[addr]) setValidMap((p) => ({ ...p, [addr]: "checking" }));
      void (async () => {
        setValidMap((p) => ({ ...p, [addr]: "checking" }));
        const ok = await isValidTronAddress(addr);
        setValidMap((p) => ({ ...p, [addr]: ok ? "valid" : "invalid" }));
      })();
      return res.list;
    });

    setIsRunning(true);
    // 单地址触发前：清理该地址相关旧数据（覆盖模式）
    setIsAcctRunning(true);
    setAcctStatStatus((prev) => ({ ...prev, [addr]: "pending" }));
    setAcctStats((prev) => prev.filter((r) => r.地址 !== addr));
    setAcctStatErrors((prev) => prev.filter((e) => e.address !== addr));
    setRows((prev) => prev.filter((r) => r.地址 !== addr));
    setTxRows((prev) => prev.filter((r) => r.地址 !== addr));

    try {
      // 1) 转账（TRC20）
      const part = await fetchTrc20ForAddress(addr);
      setRows((prev) => [...prev.filter((r) => r.地址 !== addr), ...part]);
      setAddrStatus((prev) => ({ ...prev, [addr]: { ...prev[addr], status: "done", count: part.length } }));

      // 2) 账户情况（USDT）
      const statRow = await fetchUsdtAccountStat(addr);
      setAcctStats((prev) => [...prev.filter((x) => x.地址 !== addr), statRow]);

      // 3) 交易（Transactions）
      const txPart = await fetchTransactionsForAddress(addr);
      setTxRows((prev) => [...prev.filter((r) => r.地址 !== addr), ...txPart]);
    } catch (e: any) {
      setErrors((es) => [...es, { address: addr, message: e?.message || "未知错误" }]);
      setAddrStatus((prev) => ({ ...prev, [addr]: { ...prev[addr], status: "error", message: String(e || "") } }));
      setAcctStatErrors((es) => [...es, { address: addr, message: e?.message || "未知错误" }]);
      setAcctStatStatus((prev) => ({ ...prev, [addr]: "error" }));
    } finally {
      setIsRunning(false);
      setIsAcctRunning(false);
    }
  }

  function addSingleToList(): void {
    const a = singleInput?.trim();
    if (!a) return;
    if (!addresses.includes(a)) {
      const next = [...addresses, a];
      setAddresses(next);
      setAddrStatus((prev) => ({ ...prev, [a]: { status: "pending", count: 0, pages: 0 } }));
      setValidMap((prev) => ({ ...prev, [a]: "checking" }));
      void (async () => {
        const ok = await isValidTronAddress(a);
        setValidMap((p) => ({ ...p, [a]: ok ? "valid" : "invalid" }));
      })();
    }
    setSingleInput("");
  }

  function stopAll(): void {
    cancelRef.current.cancelled = true;
    setIsRunning(false);
    setIsAcctRunning(false);
  }
  function clearAll(): void {
    setAddresses([]);
    setRows([]);
    setTxRows([]);
    setErrors([]);
    setAddrStatus({});
    setValidMap({});
    setRowCandidates({});
    setInputCandidates([]);
    setInputSuggestOpen(false);
    setSingleInput("");
    cancelRef.current.cancelled = false;
    setNeedApiKey(false);
    setErrorAlertVisible(false);
    clearAcctStats();
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }
  function deleteAddress(addr: string): void {
    setAddresses((prev) => prev.filter((a) => a !== addr));
    setAddrStatus((prev) => {
      const { [addr]: _removed, ...rest } = prev as any;
      return rest as any;
    });
    setValidMap((prev) => {
      const { [addr]: _removed, ...rest } = prev as any;
      return rest as any;
    });
    setRowCandidates((prev) => {
      const { [addr]: _c, ...r } = prev as any;
      return r as any;
    });
    // 清掉该地址账户情况 & 查询数据
    setAcctStats((prev) => prev.filter((r) => r.地址 !== addr));
    setAcctStatErrors((prev) => prev.filter((e) => e.address !== addr));
    setAcctStatStatus((prev) => {
      const { [addr]: _rm, ...rest } = prev as any;
      return rest as any;
    });
    setRows((prev) => prev.filter((r) => r.地址 !== addr));
    setTxRows((prev) => prev.filter((r) => r.地址 !== addr));
  }
  function replaceAddress(oldAddr: string, newAddr: string): void {
    if (!oldAddr || !newAddr || oldAddr === newAddr) return;
    setAddresses((prev) => {
      const idx = prev.indexOf(oldAddr);
      if (idx === -1) return prev;
      const next = [...prev];
      if (!next.includes(newAddr)) next[idx] = newAddr;
      else next.splice(idx, 1);
      return next;
    });
    setAddrStatus((prev) => {
      const { [oldAddr]: oldState, ...rest } = prev as any;
      return { ...rest, [newAddr]: oldState || { status: "pending", count: 0, pages: 0 } } as any;
    });
    void (async () => {
      const ok = await isValidTronAddress(newAddr);
      setValidMap((prev) => ({ ...prev, [newAddr]: ok ? "valid" : "invalid" }));
    })();
    setRowCandidates((prev) => {
      const n = { ...prev };
      delete n[oldAddr];
      delete n[newAddr];
      return n;
    });
    // 迁移/清理各表
    setAcctStats((prev) => prev.filter((r) => r.地址 !== oldAddr));
    setAcctStatErrors((prev) => prev.filter((e) => e.address !== oldAddr));
    setAcctStatStatus((prev) => {
      const { [oldAddr]: oldS, ...rest } = prev as any;
      return { ...rest, [newAddr]: oldS || "pending" } as any;
    });
    setRows((prev) => prev.filter((r) => r.地址 !== oldAddr));
    setTxRows((prev) => prev.filter((r) => r.地址 !== oldAddr));
  }

  async function validateMany(addrs: string[]) {
    const vm: Record<string, ValidState> = {};
    for (const a of addrs) {
      const ok = await isValidTronAddress(a);
      vm[a] = ok ? "valid" : "invalid";
    }
    setValidMap((prev) => ({ ...prev, ...vm }));
  }

  // 自动校验（候选）—— 输入框
  async function autoSuggestForInput() {
    const val = (singleInput || "").trim();
    if (!val) return;
    const candidates = await generateTronCandidates(val, 120);

    if (candidates.length > 0 && candidates[0] === val) {
      setInputAutoOK(true);
      setTimeout(() => setInputAutoOK(false), 2000);
      setInputCandidates([]);
      setInputSuggestOpen(false);
      return;
    }

    setInputCandidates(candidates);
    setInputSuggestOpen(true);
  }
  function acceptInputCandidate(c: string) {
    setSingleInput(c);
    setInputSuggestOpen(false);
  }

  // 自动校验（候选）—— 行
  async function autoSuggestForRow(addr: string) {
    const cands = await generateTronCandidates(addr, 120);
    if (cands.length > 0 && cands[0] === addr) {
      setRowAutoOK((prev) => ({ ...prev, [addr]: true }));
      setTimeout(() => setRowAutoOK((prev) => ({ ...prev, [addr]: false })), 2000);
      setRowCandidates((prev) => {
        const n = { ...prev };
        delete n[addr];
        return n;
      });
      return;
    }
    setRowCandidates((prev) => ({ ...prev, [addr]: cands }));
  }

  // 账户情况：独立按钮（保留）
  async function runAcctStats(): Promise<void> {
    if (!addresses.length) return;
    if (apiKeys.length === 0) {
      setNeedApiKey(true);
      const msg = "请输入有效的 API Key";
      setAcctStatErrors((es) => (es.some((x) => x.message === msg) ? es : [...es, { address: "", message: msg }]));
      return;
    }
    setIsAcctRunning(true);
    cancelRef.current.cancelled = false;
    // 覆盖旧统计
    setAcctStats([]);
    setAcctStatErrors([]);
    setAcctStatStatus((prev) => {
      const next: Record<string, AddrState> = { ...prev };
      addresses.forEach((a) => (next[a] = "pending"));
      return next;
    });

    let idx = 0;
    const worker = async () => {
      while (!cancelRef.current.cancelled) {
        const i = idx++;
        if (i >= addresses.length) return;
        const a = addresses[i];
        try {
          const row = await fetchUsdtAccountStat(a);
          // 覆盖该地址旧统计
          setAcctStats((prev) => [...prev.filter((x) => x.地址 !== a), row]);
        } catch (e: any) {
          setAcctStatErrors((es) => [...es, { address: a, message: e?.message || "未知错误" }]);
          setAcctStatStatus((prev) => ({ ...prev, [a]: "error" as AddrState }));
        }
      }
    };
    const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
    await Promise.all(workers);
    setIsAcctRunning(false);
  }

  function clearAcctStats(): void {
    setAcctStats([]);
    setAcctStatErrors([]);
    setAcctStatStatus({});
  }

  function downloadAcctExcel(): void {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(acctStats), "账户情况USDT");
    if (acctStatErrors.length)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(acctStatErrors), "账户情况错误");
    XLSX.writeFile(wb, `TRON_账户情况USDT_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.xlsx`);
  }
  function downloadAcctCSV(): void {
    const ws = XLSX.utils.json_to_sheet(acctStats);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `TRON_账户情况USDT_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // 状态徽章
  const StatusBadge = ({ state }: { state: AddrState }) => {
    const base = "rounded-full px-2 h-6 inline-flex items-center gap-1 text-xs";
    if (state === "pending")
      return (
        <span className={`${base} bg-neutral-200 text-neutral-700`}>
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity=".35" />
            <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" fill="none" />
          </svg>
          待开始
        </span>
      );
    if (state === "running")
      return (
        <span className={`${base} bg-amber-500 text-white`}>
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity=".35" />
            <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" fill="none" />
          </svg>
          查询中
        </span>
      );
    if (state === "done") return <span className={`${base} bg-emerald-500 text-white`}>完成</span>;
    return <span className={`${base} bg-rose-500 text-white`}>失败</span>;
  };
  const ValidBadge = ({ v }: { v: ValidState }) => {
    const base = "rounded-full px-2 h-6 inline-flex items-center text-xs";
    if (v === "valid") return <span className={`${base} bg-emerald-500/10 text-emerald-700 border border-emerald-200`}>正确</span>;
    if (v === "invalid") return <span className={`${base} bg-rose-500/10 text-rose-700 border border-rose-200`}>错误</span>;
    if (v === "checking") return <span className={`${base} bg-neutral-200 text-neutral-700`}>校验中…</span>;
    return <span className={`${base} bg-neutral-100 text-neutral-600`}>未知</span>;
  };

  // UI
  return (
    <div className="p-4 md:p-6">
      <Card className="rounded-2xl shadow-lg border border-neutral-200/70 bg-white/90">
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl font-bold">波场链 TRON · TRC20</CardTitle>
          <CardDescription className="text-muted-foreground">
            TRC20 转账 · Excel 批量 / 单地址 · 游标分页 · 并发 & 限速 · 导出
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* 顶部：单地址输入 + 操作 + 自动校验 */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2">
            <ValidatedInput
              id="tron-single"
              value={singleInput}
              onChange={(e) => setSingleInput(e.target.value)}
              placeholder="输入单个 TRON 地址（T...）"
              validate={isValidTronAddress}
              className="rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2"
            />
            <Button variant="outline" className="rounded-2xl hover:ring-1 hover:ring-neutral-300" onClick={addSingleToList}>
              <PlusCircle className="mr-2 h-4 w-4" />
              加入批量
            </Button>

            {/* 按钮：自动校验（正确时变“地址正确”，2s 后恢复） */}
            <Button
              variant={inputAutoOK ? "default" : "outline"}
              className={`rounded-2xl ${inputAutoOK ? "bg-emerald-500 text-white hover:bg-emerald-500" : "hover:ring-1 hover:ring-neutral-300"}`}
              onClick={() => void autoSuggestForInput()}
              disabled={inputAutoOK}
              title="基于 1-2 步编辑生成候选"
            >
              <Wand2 className="mr-2 h-4 w-4" />
              {inputAutoOK ? "地址正确" : "自动校验"}
            </Button>

            <Button
              className="rounded-2xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white hover:from-indigo-500 hover:to-fuchsia-500"
              onClick={() => void runOne()}
            >
              <Send className="mr-2 h-4 w-4" />
              单地址查询
            </Button>
          </div>

          {/* 输入候选面板（只有“尝试且未正确”时才展开） */}
          {inputSuggestOpen && (
            <div className="mt-2 rounded-xl border bg-white/90 p-2 text-sm">
              <div className="text-xs text-neutral-500 mb-1">候选地址（点击使用）：</div>
              {inputCandidates.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {inputCandidates.map((c) => (
                    <button
                      key={c}
                      onClick={() => acceptInputCandidate(c)}
                      className="px-2 py-1 rounded-md border hover:bg-neutral-50 font-mono text-xs"
                      title={c}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-neutral-500">未找到候选，请检查是否存在缺位/多位或非法字符。</div>
              )}
            </div>
          )}

          {/* 模板/导入 */}
          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="outline" className="rounded-2xl hover:ring-1 hover:ring-neutral-300" onClick={downloadTemplate}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              下载模板
            </Button>
            <input
              id="tron-excel-upload"
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.currentTarget.value = "";
              }}
            />
            <Button variant="outline" className="rounded-2xl hover:ring-1 hover:ring-neutral-300" asChild>
              <label htmlFor="tron-excel-upload" className="cursor-pointer inline-flex items-center">
                <Upload className="mr-2 h-4 w-4" />
                导入 Excel
              </label>
            </Button>
          </div>

          <Separator className="my-4" />

          {/* 统计 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="地址数" value={addresses.length} />
            <Stat label="已完成" value={`${finishedCount}/${addresses.length}`} />
            <Stat label="进行中" value={runningCount} />
            <Stat label="错误" value={errors.length} />
          </div>

          {/* 查询参数 */}
          <Card className="rounded-2xl shadow-md border border-neutral-200/60 bg-white/80 mt-6">
            <CardHeader className="pb-2 flex flex-row items-center gap-2">
              <Settings className="h-5 w-5" />
              <CardTitle className="text-base font-semibold">查询参数</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <Tabs defaultValue="keys" className="w-full">
                <TabsList className="rounded-2xl bg-neutral-100/60 p-1 flex flex-wrap gap-2">
                  <TabsTrigger
                    value="keys"
                    className="rounded-xl border bg-white text-neutral-800 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-600 data-[state=active]:to-fuchsia-600 data-[state=active]:text-white data-[state=active]:border-transparent"
                  >
                    API Keys
                  </TabsTrigger>
                  <TabsTrigger
                    value="params"
                    className="rounded-xl border bg-white text-neutral-800 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-600 data-[state=active]:to-fuchsia-600 data-[state=active]:text-white data-[state=active]:border-transparent"
                  >
                    参数
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="params" className="pt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm text-muted-foreground">Endpoint</Label>
                      <Input
                        className="mt-2 rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2"
                        value={endpoint}
                        onChange={(e) => setEndpoint(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">TRC20 合约地址（可选）</Label>
                      <Input
                        className="mt-2 rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2"
                        value={contract}
                        onChange={(e) => setContract(e.target.value)}
                        placeholder="留空=全部 TRC20 代币"
                      />
                    </div>

                    <div>
                      <Label className="text-sm text-muted-foreground">并发数量（建议 2–4）</Label>
                      <div className="mt-2 flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={20}
                          className="w-28 rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2"
                          value={concurrency}
                          onChange={(e) => setConcurrency(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                        />
                        <div className="flex gap-2">
                          {[2, 3, 4].map((n) => {
                            const active = concurrency === n;
                            return (
                              <Button
                                key={n}
                                variant={active ? "default" : "outline"}
                                className={`rounded-xl ${
                                  active
                                    ? "bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white hover:from-indigo-500 hover:to-fuchsia-500"
                                    : ""
                                }`}
                                onClick={() => setConcurrency(n)}
                              >
                                {n}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm text-muted-foreground">全局 QPS 上限（默认 12/s）</Label>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        className="mt-2 w-28 rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2"
                        value={qpsMax}
                        onChange={(e) => setQpsMax(Math.max(1, Math.min(20, Number(e.target.value) || 12)))}
                      />
                    </div>

                    <div>
                      <Label className="text-sm text-muted-foreground">单次请求超时（毫秒）</Label>
                      <Input
                        type="number"
                        min={2000}
                        max={60000}
                        className="mt-2 rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2"
                        value={timeoutMs}
                        onChange={(e) => setTimeoutMs(Math.max(2000, Math.min(60000, Number(e.target.value) || 15000)))}
                      />
                    </div>

                    <div>
                      <Label className="text-sm text-muted-foreground">每页间隔（毫秒）</Label>
                      <Input
                        type="number"
                        min={0}
                        max={3000}
                        className="mt-2 rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2"
                        value={pauseMs}
                        onChange={(e) => setPauseMs(Math.max(0, Math.min(3000, Number(e.target.value) || 220)))}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="keys" className="pt-4">
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground inline-flex items-center gap-2">
                      <KeyRound className="h-4 w-4" />
                      TronGrid API Keys（逗号/换行/分号分隔）
                    </Label>
                    <Textarea
                      className="rounded-2xl min-h-[96px]"
                      placeholder="key1,key2\nkey3"
                      value={apiKeysText}
                      onChange={(e) => {
                        setApiKeysText(e.target.value);
                        if (e.target.value.trim().length > 0) setNeedApiKey(false);
                      }}
                    />
                    <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
                      <LinkIcon className="h-3.5 w-3.5" />
                      <a className="underline" href="https://www.trongrid.io/" target="_blank" rel="noreferrer">
                        没有 Key？点击申请（TronGrid）
                      </a>
                    </div>
                    {needApiKey && (
                      <Alert variant="destructive" className="rounded-2xl">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>需要 API Key</AlertTitle>
                        <AlertDescription>请输入有效的 API Key</AlertDescription>
                      </Alert>
                    )}
                  </div>
                </TabsContent>
              </Tabs>

              <Separator className="my-4" />

              <div className="flex flex-wrap gap-3">
                {!isRunning ? (
                  <Button
                    className="rounded-2xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white hover:from-indigo-500 hover:to-fuchsia-500"
                    disabled={!addresses.length}
                    onClick={() => void runAll()}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    开始批量查询
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    className="rounded-2xl bg-neutral-900 text-white hover:bg-neutral-800"
                    onClick={stopAll}
                  >
                    <Square className="mr-2 h-4 w-4" />
                    停止
                  </Button>
                )}
                <Button variant="outline" className="rounded-2xl hover:ring-1 hover:ring-neutral-300" onClick={clearAll}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  清空
                </Button>
                <Button
                  variant="outline"
                  className="rounded-2xl hover:ring-1 hover:ring-neutral-300"
                  disabled={!(allDone && (rows.length > 0 || txRows.length > 0))}
                  onClick={downloadExcel}
                >
                  <Download className="mr-2 h-4 w-4" />
                  导出 Excel
                </Button>
                <Button
                  variant="outline"
                  className="rounded-2xl hover:ring-1 hover:ring-neutral-300"
                  disabled={!(allDone && (rows.length > 0 || txRows.length > 0))}
                  onClick={downloadCSV}
                >
                  <Download className="mr-2 h-4 w-4" />
                  导出 CSV（2个文件）
                </Button>
              </div>

              <div className="pt-2">
                <ProgressBar value={finishedCount} running={runningCount} total={addresses.length} />
              </div>
            </CardContent>
          </Card>

          {/* 中间：地址列表（带校验与自动校验） */}
          <Card className="rounded-2xl shadow-md border border-neutral-200/60 bg-white/80 mt-6">
            <CardHeader className="pb-3 flex flex-row items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              <CardTitle className="text-base font-semibold">地址列表</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-4">
              <div className="h-[360px] overflow-auto space-y-2 pr-1">
                {addresses.length === 0 ? (
                  <div className="text-sm text-neutral-500 px-2 py-8 text-center">
                    暂无地址，请在上方输入单地址或导入 Excel 模板
                  </div>
                ) : (
                  addresses.map((a, idx) => {
                    const st = addrStatus[a] || { status: "pending", count: 0, pages: 0 };
                    const v = validMap[a] || "checking";
                    const raw = rowCandidates[a];
                    const hasTried = typeof raw !== "undefined";
                    const cands = Array.isArray(raw) ? raw : [];
                    const ok2s = !!rowAutoOK[a];
                    return (
                      <div
                        key={a}
                        className="rounded-xl border border-neutral-200/70 bg-white/90 hover:shadow-sm transition-shadow p-3"
                      >
                        <div className="flex items-center gap-3">
                          <div className="text-xs text-neutral-500 w-6 text-center shrink-0">{idx + 1}</div>

                          {/* 地址（完整显示） */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-sm break-all">{a}</span>

                              {/* 右侧：校验 + 状态 + 记录 + 页数 */}
                              <div className="ml-auto flex items-center gap-2 shrink-0">
                                <ValidBadge v={v} />
                                <StatusBadge state={(st?.status || "pending") as AddrState} />
                                <span className="text-xs text-neutral-600 rounded-full bg-neutral-100 px-2 py-0.5">
                                  记录 {st?.count ?? 0}
                                </span>
                                <span className="text-xs text-neutral-600 rounded-full bg-neutral-100 px-2 py-0.5">
                                  页数 {st?.pages ?? 0}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* 操作 */}
                          <div className="flex items-center gap-1">
                            <button
                              className={`h-8 px-2 inline-flex items-center justify-center rounded-md border text-xs ${
                                ok2s
                                  ? "bg-emerald-500 text-white border-emerald-500 cursor-not-allowed"
                                  : "hover:bg-neutral-50"
                              }`}
                              title="自动校验候选"
                              disabled={ok2s}
                              onClick={() => void autoSuggestForRow(a)}
                            >
                              <Wand2 className="h-3.5 w-3.5 mr-1" />
                              {ok2s ? "地址正确" : "自动校验"}
                            </button>
                            <button
                              className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-neutral-100"
                              title="复制地址"
                              onClick={() => navigator.clipboard.writeText(a)}
                            >
                              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            </button>
                            <button
                              className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-rose-50 text-rose-600"
                              title="删除"
                              onClick={() => deleteAddress(a)}
                            >
                              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* 候选面板（该行） */}
                        {cands.length > 0 ? (
                          <div className="mt-2 rounded-lg border bg-neutral-50/60 p-2">
                            <div className="text-xs text-neutral-500 mb-1">候选地址（点击替换该行）：</div>
                            <div className="flex flex-wrap gap-2">
                              {cands.map((c) => (
                                <button
                                  key={c}
                                  onClick={() => replaceAddress(a, c)}
                                  className="px-2 py-1 rounded-md border bg-white hover:bg-neutral-50 font-mono text-xs"
                                  title={c}
                                >
                                  {c}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : hasTried ? (
                          <div className="mt-2 text-xs text-neutral-500">
                            未找到候选，请检查是否存在缺位/多位或非法字符。
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>

              {errorAlertVisible && errors.length > 0 && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/70 p-3">
                  <div className="text-sm font-medium text-rose-700">查询错误（{errors.length}）</div>
                  <div className="mt-2 max-h-40 overflow-auto space-y-1">
                    {errors.map((e, i) => {
                      const full = e.address ? `${e.address} — ${e.message}` : e.message;
                      return (
                        <div key={i} className="flex items-start justify-between gap-2 py-0.5">
                          <div className="text-xs text-rose-700/90 break-all">
                            {e.address ? (
                              <>
                                <span className="font-mono">{middleEllipsis(e.address)}</span> — {e.message}
                              </>
                            ) : (
                              e.message
                            )}
                          </div>
                          <button
                            className="h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-rose-100 text-rose-700"
                            onClick={() => navigator.clipboard.writeText(full)}
                            title="复制错误"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ========== 账户情况（USDT） ========== */}
          <Card className="rounded-2xl shadow-md border border-neutral-200/60 bg-white/80 mt-6">
            <CardHeader className="pb-3 flex flex-row items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              <CardTitle className="text-base font-semibold">账户情况（USDT）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-3">
                {!isAcctRunning ? (
                  <Button
                    className="rounded-2xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white hover:from-indigo-500 hover:to-fuchsia-500"
                    disabled={!addresses.length}
                    onClick={() => void runAcctStats()}
                    title="按当前地址列表统计 USDT（TronGrid 分页聚合）"
                  >
                    <Play className="mr-2 h-4 w-4" />
                    统计账户情况（USDT）
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    className="rounded-2xl bg-neutral-900 text-white hover:bg-neutral-800"
                    onClick={stopAll}
                    title="终止任务（与上方停止共享同一取消标志）"
                  >
                    <Square className="mr-2 h-4 w-4" />
                    停止
                  </Button>
                )}
                <Button variant="outline" className="rounded-2xl hover:ring-1 hover:ring-neutral-300" onClick={clearAcctStats}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  清空
                </Button>
                <Button
                  variant="outline"
                  className="rounded-2xl hover:ring-1 hover:ring-neutral-300"
                  disabled={acctStats.length === 0}
                  onClick={downloadAcctExcel}
                >
                  <Download className="mr-2 h-4 w-4" />
                  导出 Excel
                </Button>
                <Button
                  variant="outline"
                  className="rounded-2xl hover:ring-1 hover:ring-neutral-300"
                  disabled={acctStats.length === 0}
                  onClick={downloadAcctCSV}
                >
                  <Download className="mr-2 h-4 w-4" />
                  导出 CSV
                </Button>
              </div>

              {/* 统计进度小结 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="账户统计条数" value={acctStats.length} />
                <Stat
                  label="正在统计"
                  value={Object.values(acctStatStatus).filter((s) => s === "running").length}
                />
                <Stat
                  label="已完成"
                  value={Object.values(acctStatStatus).filter((s) => s === "done").length}
                />
                <Stat label="错误" value={acctStatErrors.length} />
              </div>

              {/* 表格 */}
              <div className="overflow-auto max-h-[520px] rounded-2xl border">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-neutral-50 backdrop-blur">
                    <tr>
                      {[
                        "地址",
                        "标签",
                        "余额(USDT)",
                        "首次交易时间",
                        "最近交易时间",
                        "最近流出时间",
                        "流入金额(USDT)",
                        "流入笔数",
                        "流入地址数",
                        "流出金额(USDT)",
                        "流出笔数",
                        "流出地址数",
                      ].map((h) => (
                        <th key={h} className="text-left p-2 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {acctStats.map((r, i) => (
                      <tr key={r.地址 + i} className="border-b last:border-none">
                        {/* 地址：省略显示 + 悬浮完整 + 复制 */}
                        <td className="p-2">
                          <AddressCell addr={r.地址} />
                        </td>
                        <td className="p-2">{r.标签 || "-"}</td>
                        {/* 金额：万/亿，两位小数（展示层） */}
                        <td className="p-2">{formatHumanAmount2(r.余额USDT)}</td>
                        {/* 时间：换行居中（展示层） */}
                        <td className="p-2"><TimeCell value={r.首次交易时间} /></td>
                        <td className="p-2"><TimeCell value={r.最近交易时间} /></td>
                        <td className="p-2"><TimeCell value={r.最近流出时间} /></td>
                        {/* 金额/计数 */}
                        <td className="p-2">{formatHumanAmount2(r.流入金额USDT)}</td>
                        <td className="p-2">{r.流入笔数}</td>
                        <td className="p-2">{r.流入地址数}</td>
                        <td className="p-2">{formatHumanAmount2(r.流出金额USDT)}</td>
                        <td className="p-2">{r.流出笔数}</td>
                        <td className="p-2">{r.流出地址数}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 错误面板（账户情况） */}
              {acctStatErrors.length > 0 && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/70 p-3">
                  <div className="text-sm font-medium text-rose-700">账户情况错误（{acctStatErrors.length}）</div>
                  <div className="mt-2 max-h-40 overflow-auto space-y-1">
                    {acctStatErrors.map((e, i) => {
                      const full = e.address ? `${e.address} — ${e.message}` : e.message;
                      return (
                        <div key={i} className="flex items-start justify-between gap-2 py-0.5">
                          <div className="text-xs text-rose-700/90 break-all">
                            {e.address ? (
                              <>
                                <span className="font-mono">{middleEllipsis(e.address)}</span> — {e.message}
                              </>
                            ) : (
                              e.message
                            )}
                          </div>
                          <button
                            className="h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-rose-100 text-rose-700"
                            onClick={() => navigator.clipboard.writeText(full)}
                            title="复制错误"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 底部：查询结果（Tabs：转账 / 交易） */}
          <Card className="rounded-2xl shadow-sm mt-6">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold">查询结果</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="transfers" className="w-full">
                <TabsList className="rounded-2xl bg-neutral-100/60 p-1 flex gap-2 mb-3">
                  <TabsTrigger
                    value="transfers"
                    className="rounded-xl border bg-white text-neutral-800 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-600 data-[state=active]:to-fuchsia-600 data-[state=active]:text-white data-[state=active]:border-transparent"
                  >
                    转账 Transfers（{rows.length}）
                  </TabsTrigger>
                  <TabsTrigger
                    value="transactions"
                    className="rounded-xl border bg-white text-neutral-800 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-600 data-[state=active]:to-fuchsia-600 data-[state=active]:text-white data-[state=active]:border-transparent"
                  >
                    交易 Transactions（{txRows.length}）
                  </TabsTrigger>
                </TabsList>

                {/* Transfers 表 */}
                <TabsContent value="transfers">
                  <div className="overflow-auto max-h-[520px] rounded-2xl border">
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 bg-neutral-50 backdrop-blur">
                        <tr>
                          <th className="text-left p-2 whitespace-nowrap">地址</th>
                          <th className="text-left p-2 whitespace-nowrap w-[200px]">哈希</th>
                          <th className="text-left p-2 whitespace-nowrap">转入地址</th>
                          <th className="text-left p-2 whitespace-nowrap">转出地址</th>
                          <th className="text-left p-2 whitespace-nowrap">数量</th>
                          <th className="text-left p-2 whitespace-nowrap">代币</th>
                          <th className="text-left p-2 whitespace-nowrap w-[140px]">时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 1000).map((r, i) => (
                          <tr key={i} className="border-b last:border-none">
                            <td className="p-2 font-mono text-xs break-all">{r.地址}</td>
                            <td className="p-2 font-mono text-xs break-all w-[200px]">{r.哈希}</td>
                            <td className="p-2 font-mono text-xs break-all">{r.转入地址}</td>
                            <td className="p-2 font-mono text-xs break-all">{r.转出地址}</td>
                            {/* 数量：展示层万/亿+两位小数，导出不变 */}
                            <td className="p-2">{formatHumanAmount2(r.数量)}</td>
                            <td className="p-2">{r.代币}</td>
                            {/* 时间：展示层换行居中，列更宽 */}
                            <td className="p-2 w-[140px]"><TimeCell value={r.时间} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>

                {/* Transactions 表 */}
                <TabsContent value="transactions">
                  <div className="overflow-auto max-h-[520px] rounded-2xl border">
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 bg-neutral-50 backdrop-blur">
                        <tr>
                          {["地址", "哈希", "类型", "发起地址", "接收地址", "金额(TRX)", "状态", "时间"].map((h) => (
                            <th key={h} className="text-left p-2 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {txRows.slice(0, 1000).map((r, i) => (
                          <tr key={i} className="border-b last:border-none">
                            <td className="p-2 font-mono text-xs break-all">{r.地址}</td>
                            <td className="p-2 font-mono text-xs break-all">{r.哈希}</td>
                            <td className="p-2 whitespace-nowrap">{r.类型 || "-"}</td>
                            <td className="p-2 font-mono text-xs break-all">{r.发起地址 || "-"}</td>
                            <td className="p-2 font-mono text-xs break-all">{r.接收地址 || "-"}</td>
                            <td className="p-2">{r.金额TRX ? formatHumanAmount2(r.金额TRX) : "-"}</td>
                            <td className="p-2 whitespace-nowrap">{r.状态 || "-"}</td>
                            <td className="p-2"><TimeCell value={r.时间 || "-"} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <Card className="rounded-2xl shadow-md border border-neutral-200/60 bg-white/80">
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
function ProgressBar({ value, running, total }: { value: number; running: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <Progress value={pct} className="h-2" />
      <div className="text-xs text-muted-foreground">
        {pct}%（完成 {value} / 总数 {total}，进行中 {running}）
      </div>
    </div>
  );
}
