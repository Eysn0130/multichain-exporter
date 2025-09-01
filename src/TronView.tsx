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
  // 队列与数据
  const [addresses, setAddresses] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
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
    setErrors([]);
  }
  function downloadExcel(): void {
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws1, "查询结果");
    if (errors.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(errors), "错误信息");
    XLSX.writeFile(wb, `TRON_查询结果_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.xlsx`);
  }
  function downloadCSV(): void {
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `TRON_查询结果_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // TRON 请求（游标分页：links.next / fingerprint）
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
        url.searchParams.set("fingerprint", fingerprint);
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

  // 批量 / 单地址 控制
  async function runAll(): Promise<void> {
    if (!addresses.length) return;
    setIsRunning(true);
    cancelRef.current.cancelled = false;
    setRows([]);
    setErrors([]);
    let cursor = 0;

    const worker = async () => {
      while (!cancelRef.current.cancelled) {
        const i = cursor++;
        if (i >= addresses.length) return;
        const addr = addresses[i];
        try {
          const part = await fetchTrc20ForAddress(addr);
          setRows((prev) => [...prev, ...part]);
          setAddrStatus((prev) => ({ ...prev, [addr]: { ...prev[addr], status: "done", count: part.length } }));
        } catch (e: any) {
          setErrors((es) => [...es, { address: addr, message: e?.message || "未知错误" }]);
          setAddrStatus((prev) => ({ ...prev, [addr]: { ...prev[addr], status: "error", message: String(e || "") } }));
        }
      }
    };
    const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
    await Promise.all(workers);
    setIsRunning(false);
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
    try {
      const part = await fetchTrc20ForAddress(addr);
      setRows((prev) => [...prev, ...part]);
      setAddrStatus((prev) => ({ ...prev, [addr]: { ...prev[addr], status: "done", count: part.length } }));
    } catch (e: any) {
      setErrors((es) => [...es, { address: addr, message: e?.message || "未知错误" }]);
      setAddrStatus((prev) => ({ ...prev, [addr]: { ...prev[addr], status: "error", message: String(e || "") } }));
    } finally {
      setIsRunning(false);
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
  }
  function clearAll(): void {
    setAddresses([]);
    setRows([]);
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

    // 本身已正确：按钮 2s 变“地址正确”，不展开候选
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

    // 本身正确：按钮 2s 成功，不显示“未找到候选…”
    if (cands.length > 0 && cands[0] === addr) {
      setRowAutoOK((prev) => ({ ...prev, [addr]: true }));
      setTimeout(() => setRowAutoOK((prev) => ({ ...prev, [addr]: false })), 2000);
      // ⭐ 删除 key，而不是设成 []，否则会显示“未找到候选…”
      setRowCandidates((prev) => {
        const n = { ...prev };
        delete n[addr];
        return n;
      });
      return;
    }

    setRowCandidates((prev) => ({ ...prev, [addr]: cands }));
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
                  disabled={!(allDone && rows.length > 0)}
                  onClick={downloadExcel}
                >
                  <Download className="mr-2 h-4 w-4" />
                  导出 Excel
                </Button>
                <Button
                  variant="outline"
                  className="rounded-2xl hover:ring-1 hover:ring-neutral-300"
                  disabled={!(allDone && rows.length > 0)}
                  onClick={downloadCSV}
                >
                  <Download className="mr-2 h-4 w-4" />
                  导出 CSV
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
                    const hasTried = typeof raw !== "undefined"; // 只有“尝试过且无结果”时才显示未找到候选
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

          {/* 底部：查询结果 */}
          <Card className="rounded-2xl shadow-sm mt-6">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold">查询结果（{rows.length} 条）</CardTitle>
                <span className="text-sm text-muted-foreground">· 预览首 1000 条</span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto max-h-[520px] rounded-2xl border">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-neutral-50 backdrop-blur">
                    <tr>
                      {["地址", "哈希", "转入地址", "转出地址", "数量", "代币", "时间"].map((h) => (
                        <th key={h} className="text-left p-2 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 1000).map((r, i) => (
                      <tr key={i} className="border-b last:border-none">
                        <td className="p-2 font-mono text-xs break-all">{r.地址}</td>
                        <td className="p-2 font-mono text-xs break-all">{r.哈希}</td>
                        <td className="p-2 font-mono text-xs break-all">{r.转入地址}</td>
                        <td className="p-2 font-mono text-xs break-all">{r.转出地址}</td>
                        <td className="p-2">{r.数量}</td>
                        <td className="p-2">{r.代币}</td>
                        <td className="p-2">{r.时间}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
