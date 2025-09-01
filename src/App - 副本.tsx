import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
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
  Loader2,
  CheckCircle2,
  XCircle,
  Link as LinkIcon,
  PlusCircle,
  Send,
  Copy,
} from "lucide-react";

// shadcn/ui 基础组件
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * 波场链批量查询助手（UI/UX 现代化改版）
 * 设计：简洁、高级、现代、留白合理；统一色彩系统、柔和阴影、2xl 圆角、响应式布局。
 * 技术栈：React + TailwindCSS + shadcn/ui + framer-motion（仅 UI 改造，不改动逻辑）。
 *
 * —— 功能概述（保持与原逻辑一致）——
 * - Excel 导入：A 列；A1=“待查钱包地址”
 * - 单地址查询：复用同一行显示状态；点击即进入“查询中”并更新进度
 * - 官方游标分页：meta.links.next / meta.fingerprint
 * - 并发控制（默认 3），全局 QPS 限速（默认 12/s）
 * - 401/429/403/5xx 退避；极小页进入“慢速模式”
 * - API Keys 多个轮换；无 Key/401 给出友好提示
 * - 导出 CSV/Excel（含错误 Sheet）
 */

// —— 小型“断言/测试”工具（保持不变） ——
function deepEqual(a: any, b: any) { return JSON.stringify(a) === JSON.stringify(b); }

// 解析 API Keys（保持逻辑，不改动）
export function parseApiKeys(text: string): string[] {
  if (!text) return [];
  return Array.from(new Set(text.split(/[\s,，;]+/).map(s => s.trim()).filter(Boolean)));
}

// 地址加入列表（保持逻辑，不改动）
export function ensureListWithAddress(list: string[], addr: string) {
  const trimmed = (addr || "").trim();
  if (!trimmed) return { list, added: false };
  if (list.includes(trimmed)) return { list, added: false };
  return { list: [...list, trimmed], added: true };
}

// 复合键（保持逻辑，不改动）
export function makeCompositeKey(ev: { transaction_id?: string; from?: string; to?: string; value?: string | number; decimals?: number; symbol?: string; block_timestamp?: number | string; token_address?: string; }) {
  const tx = String(ev.transaction_id || "");
  const from = String(ev.from || "");
  const to = String(ev.to || "");
  const raw = String(ev.value ?? "0");
  const dec = Number(ev.decimals || 0) || 0;
  const sym = String(ev.symbol || "");
  const ts = String(ev.block_timestamp || 0);
  const tokenAddr = String(ev.token_address || "");
  return [tx, from, to, raw, dec, sym, ts, tokenAddr].join("|");
}

// 自测（保持逻辑，不改动，仅输出到控制台）
function runSelfTests() {
  const cases = [
    { in: "a,b,c", out: ["a","b","c"] },
    { in: "a\nb\nc", out: ["a","b","c"] },
    { in: "a\tb, c", out: ["a","b","c"] },
    { in: " a , , b ,, c ", out: ["a","b","c"] },
    { in: "a，b，c", out: ["a","b","c"] },
    { in: "a; b; c", out: ["a","b","c"] },
    { in: "", out: [] },
    { in: "dup,dup\ndup", out: ["dup"] }
  ];
  let pass = 0; for (const t of cases) { const got = parseApiKeys(t.in); const ok = deepEqual(got, t.out); pass += ok?1:0; console[ok?"log":"error"](`parseApiKeys(${JSON.stringify(t.in)}) => ${JSON.stringify(got)} ${ok?"✓":`≠ ${JSON.stringify(t.out)}`}`); }
  const L: string[] = []; const s1 = ensureListWithAddress(L," Txxx "); const s2 = ensureListWithAddress(s1.list,"Txxx"); const s3 = ensureListWithAddress(s2.list,"Tyyy"); console.log(`ensureListWithAddress tests: ${deepEqual(s1,{list:["Txxx"],added:true}) && deepEqual(s2,{list:["Txxx"],added:false}) && deepEqual(s3,{list:["Txxx","Tyyy"],added:true}) ? 'all passed': 'FAILED'}`);
  const e1 = { transaction_id: "tx1", from: "A", to: "B", value: "100", decimals: 6, symbol: "USDT", block_timestamp: 1, token_address: "c1" };
  const e2 = { transaction_id: "tx1", from: "A", to: "B", value: "100", decimals: 6, symbol: "USDT", block_timestamp: 1, token_address: "c1" };
  const e3 = { transaction_id: "tx1", from: "A", to: "C", value: "100", decimals: 6, symbol: "USDT", block_timestamp: 1, token_address: "c1" };
  const e4 = { transaction_id: "tx1", from: "A", to: "B", value: "200", decimals: 6, symbol: "USDT", block_timestamp: 1, token_address: "c1" };
  const k1 = makeCompositeKey(e1), k2 = makeCompositeKey(e2), k3 = makeCompositeKey(e3), k4 = makeCompositeKey(e4);
  console.log(`makeCompositeKey tests: ${(k1===k2 && k1!==k3 && k1!==k4) ? 'all passed':'FAILED'}`);
}

export default function TronBatchInspector() {
  // —— 状态（保持不变） ——
  const [addresses, setAddresses] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [errors, setErrors] = useState<{ address: string; message: string }[]>([]);
  const [errorAlertVisible, setErrorAlertVisible] = useState(false);
  const errorTimerRef = useRef<number | null>(null);

  const [endpoint, setEndpoint] = useState("https://api.trongrid.io");
  const [contract, setContract] = useState("");
  const [concurrency, setConcurrency] = useState(3);
  const [timeoutMs, setTimeoutMs] = useState(15000);
  const [pauseMs, setPauseMs] = useState(220);
  const [qpsMax, setQpsMax] = useState(12);

  const [apiKeysText, setApiKeysText] = useState("");
  const apiKeys = useMemo(() => parseApiKeys(apiKeysText), [apiKeysText]);

  const [singleAddr, setSingleAddr] = useState("");
  const [needApiKey, setNeedApiKey] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ total: 0, done: 0, ok: 0, fail: 0 });

  const [addrStatus, setAddrStatus] = useState<Record<string, { status: "pending" | "running" | "done" | "error"; count: number; pages: number; message?: string }>>({});

  const runningCount = useMemo(() => Object.values(addrStatus).filter(s => s?.status === "running").length, [addrStatus]);

  // 全部完成：用于控制导出按钮可点击
  const finishedCount = useMemo(
    () => addresses.reduce((acc, a) => acc + ((addrStatus[a]?.status === 'done' || addrStatus[a]?.status === 'error') ? 1 : 0), 0),
    [addresses, addrStatus]
  );
  const allDone = useMemo(
    () => (addresses.length > 0 && finishedCount === addresses.length && !isRunning),
    [finishedCount, addresses, isRunning]
  );

  const cancelRef = useRef({ cancelled: false });

  useEffect(() => { runSelfTests(); }, []);

  // 错误提示自动隐藏：10s 后消失；新错误会重置计时
  useEffect(() => {
    if (errors.length > 0) {
      setErrorAlertVisible(true);
      if (errorTimerRef.current) { clearTimeout(errorTimerRef.current); }
      errorTimerRef.current = window.setTimeout(() => {
        setErrorAlertVisible(false);
        errorTimerRef.current = null;
      }, 10000);
    }
    return () => {
      if (errorTimerRef.current) { clearTimeout(errorTimerRef.current); errorTimerRef.current = null; }
    };
  }, [errors]);

  // —— 限速器（保持原逻辑） ——
  const rateRef = useRef<{ windowMs: number; hits: number[] }>({ windowMs: 1000, hits: [] });
  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
  async function acquireToken() {
    const now = Date.now();
    const { windowMs } = rateRef.current;
    rateRef.current.hits = rateRef.current.hits.filter(t => now - t < windowMs);
    if (rateRef.current.hits.length >= Math.max(1, qpsMax)) {
      const wait = windowMs - (now - rateRef.current.hits[0]);
      await sleep(Math.max(0, wait));
      return acquireToken();
    }
    rateRef.current.hits.push(Date.now());
  }

  // —— 工具（保持原逻辑） ——
  function pick<T>(arr: T[]): T | undefined { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined; }
  function formatTime(ts: number) { if (!ts) return ""; const d = new Date(ts); const yyyy=d.getFullYear(); const mm=String(d.getMonth()+1).padStart(2,"0"); const dd=String(d.getDate()).padStart(2,"0"); const hh=String(d.getHours()).padStart(2,"0"); const mi=String(d.getMinutes()).padStart(2,"0"); const ss=String(d.getSeconds()).padStart(2,"0"); return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`; }
  function scaleAmount(value: string, decimals: number) { if (!/^[0-9]+$/.test(value||"0")) return value||"0"; const s=(value||"0").replace(/^0+/,"")||"0"; if (decimals<=0) return s; if (s.length<=decimals) return `0.${"0".repeat(decimals-s.length)}${s}`.replace(/\.?0+$/,''); const i=s.length-decimals; return `${s.slice(0,i)}.${s.slice(i)}`.replace(/\.?0+$/,''); }

  // —— 文本可视化：地址中间省略 ——
  function middleEllipsis(str: string, head:number = 6, tail:number = 4) {
    const s = String(str || "");
    if (s.length <= head + tail + 3) return s;
    return `${s.slice(0, head)}…${s.slice(-tail)}`;
  }

  // —— Excel（保持原逻辑） ——
  function downloadTemplate() { const wb = XLSX.utils.book_new(); const data=[["待查钱包地址"],["TXXXXXXXXXXXXXXXXXXXXXXXX"],["TYYYYYYYYYYYYYYYYYYYYYYYY"]]; const ws=XLSX.utils.aoa_to_sheet(data); XLSX.utils.book_append_sheet(wb, ws, "模板"); XLSX.writeFile(wb, "TRON_批量查询模板.xlsx"); }
  async function handleFile(file: File) { const buf=await file.arrayBuffer(); const wb=XLSX.read(buf,{type:"array"}); const first=wb.Sheets[wb.SheetNames[0]]; const arr=XLSX.utils.sheet_to_json<any[]>(first,{header:1}); const out:string[]=[]; for (let i=0;i<arr.length;i++){ const cell=(arr[i]?.[0]??"").toString().trim(); if(!cell) continue; if(i===0 && (cell==="待查钱包地址" || cell.toLowerCase().includes("address"))) continue; out.push(cell);} const uniq=Array.from(new Set(out)); setAddresses(uniq); const st:Record<string,any>={}; uniq.forEach(a=>st[a]={status:"pending",count:0,pages:0}); setAddrStatus(st); setProgress({ total: uniq.length, done: 0, ok: 0, fail: 0 }); setRows([]); setErrors([]); }
  function downloadExcel(){ const wb=XLSX.utils.book_new(); const ws1=XLSX.utils.json_to_sheet(rows); XLSX.utils.book_append_sheet(wb, ws1, "查询结果"); if(errors.length) XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(errors),"错误信息"); XLSX.writeFile(wb,`TRON_查询结果_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.xlsx`); }
  function downloadCSV(){ const ws=XLSX.utils.json_to_sheet(rows); const csv=XLSX.utils.sheet_to_csv(ws); const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`TRON_查询结果_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`; a.click(); URL.revokeObjectURL(a.href); }

  // —— TronGrid 查询（保持原逻辑，UI不变） ——
  async function fetchTrc20ForAddress(addr: string) {
    const base = `${endpoint.replace(/\/$/, "")}/v1/accounts/${addr}/transactions/trc20`;
    const rowsOut: any[] = [];
    const seen = new Set<string>();
    let page = 0;

    const updateStatus = (patch: Partial<{ status: any; count: number; pages: number; message?: string }>) => {
      setAddrStatus((prev) => ({ ...prev, [addr]: { ...prev[addr], ...patch } }));
    };

    const qs = new URLSearchParams({ only_confirmed: "true", limit: "200", order_by: "block_timestamp,desc", search_internal: "false" });
    if (contract.trim()) qs.set("contract_address", contract.trim());
    const toAbs = (u: string) => (/^https?:\/\//i.test(u) ? u : `${endpoint.replace(/\/$/, "")}${u.startsWith("/")?u:"/"+u}`);

    let nextURL: string | null = `${base}?${qs.toString()}`;
    updateStatus({ status: "running" });

    while (!cancelRef.current.cancelled && nextURL) {
      page += 1;
      const key = pick(apiKeys) || "";
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let resp: Response | null = null;
      try {
        await acquireToken();
        resp = await fetch(nextURL, { method: "GET", headers: { "Content-Type": "application/json", "TRON-PRO-API-KEY": key, "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal });
      } catch { clearTimeout(timer); await sleep(800); continue; }
      clearTimeout(timer);

      if (!resp.ok) {
        if (resp.status === 401) { setNeedApiKey(true); const msg = "请输入有效的 API Key"; setErrors((es)=>[...es,{address:addr,message:msg}]); updateStatus({ status: "error", message: "", pages: page-1, count: rowsOut.length }); break; }
        const retryAfter = Number(resp.headers.get("retry-after"));
        if ([429,403,500,502,503,504].includes(resp.status)) { let wait=1200; if (Number.isFinite(retryAfter) && retryAfter!==0) wait=Math.max(1000,retryAfter*1000); else if (resp.status===403) wait=Math.max(wait,30000); await sleep(wait); continue; }
        const msg = `${resp.status} ${resp.statusText}`; setErrors((es)=>[...es,{address:addr,message:msg}]); updateStatus({ status: "error", message: msg, pages: page-1, count: rowsOut.length }); break;
      }

      let json: any = null; try { json = await resp.json(); } catch { await sleep(500); continue; }
      const data: any[] = Array.isArray(json?.data) ? json.data : [];
      if (!data.length) { updateStatus({ status: "done", pages: page-1, count: rowsOut.length }); break; }

      for (const it of data) {
        if (it?.type === "Approval") continue;
        const ti = it?.token_info || {}; const dec=Number(ti?.decimals||0)||0; const id=String(it?.transaction_id||"");
        const from=it?.from||""; const to=it?.to||""; const rawVal=String(it?.value??"0"); const symbol=ti?.symbol||""; const tokenAddr=ti?.address||""; const ts=Number(it?.block_timestamp||0);
        const compKey = makeCompositeKey({ transaction_id:id, from, to, value:rawVal, decimals:dec, symbol, block_timestamp:ts, token_address:tokenAddr });
        if (!seen.has(compKey)) { seen.add(compKey); rowsOut.push({ 地址:addr, 哈希:id, 转入地址:from, 转出地址:to, 数量:scaleAmount(rawVal,dec), 代币:symbol, 时间:formatTime(ts) }); }
      }

      const nextLink: string | undefined = json?.meta?.links?.next; const fingerprint: string | undefined = json?.meta?.fingerprint;
      if (nextLink) { nextURL = toAbs(nextLink); }
      else if (fingerprint) { const url = new URL(base); url.searchParams.set("only_confirmed","true"); url.searchParams.set("limit","200"); url.searchParams.set("order_by","block_timestamp,desc"); url.searchParams.set("search_internal","false"); url.searchParams.set("fingerprint",fingerprint); if (contract.trim()) url.searchParams.set("contract_address",contract.trim()); nextURL = url.toString(); }
      else { updateStatus({ status: "done", pages: page, count: rowsOut.length }); break; }

      updateStatus({ pages: page, count: rowsOut.length });
      const tinyPage = data.length <= 1; const slowBonus = tinyPage ? Math.max(pauseMs*5,2000) : pauseMs; await sleep(slowBonus);
    }

    return rowsOut;
  }

  // —— 并发批量/单地址（保持原逻辑） ——
  async function runAll() {
    if (!addresses.length) return;
    setIsRunning(true); cancelRef.current.cancelled = false; setProgress({ total: addresses.length, done: 0, ok: 0, fail: 0 }); setRows([]); setErrors([]);
    const outAll: any[] = []; let ok=0, fail=0; let cursor=0;
    const worker = async () => { while (!cancelRef.current.cancelled) { const myIndex=cursor++; if (myIndex>=addresses.length) return; const addr=addresses[myIndex]; try { const part=await fetchTrc20ForAddress(addr); outAll.push(...part); ok+=1; setRows(prev=>[...prev,...part]); setProgress(p=>({ ...p, done: p.done+1, ok })); } catch (e:any) { fail+=1; setErrors(es=>[...es,{address:addr,message:e?.message||"未知错误"}]); setAddrStatus(prev=>({ ...prev, [addr]: { ...prev[addr], status: "error", message: String(e||"") } })); setProgress(p=>({ ...p, done: p.done+1, fail })); } } };
    const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker()); await Promise.all(workers); setIsRunning(false);
  }

  async function runOne() {
    const addr = singleAddr.trim(); if (!addr) return;
    // 🚫 未填写 API Key：不加入地址列表，不更新进度，只给出统一错误提示
    if (apiKeys.length === 0) {
      setNeedApiKey(true);
      setActiveTab('keys');
      setErrors(prev => prev.some(e => e.message === '请输入有效的 API Key') ? prev : [...prev, { address: '', message: '请输入有效的 API Key' }]);
      return;
    }
    let added=false; setAddresses(prev=>{ const res=ensureListWithAddress(prev,addr); added=res.added; return res.list; });
    if (!addrStatus[addr]) { setAddrStatus(prev=>({ ...prev, [addr]: { status: "pending", count: 0, pages: 0 } })); }
    if (added) setProgress(p=>({ ...p, total: p.total + 1 }));

    setIsRunning(true); cancelRef.current.cancelled=false;
    try { const part=await fetchTrc20ForAddress(addr); setRows(prev=>[...prev,...part]); setAddrStatus(prev=>({ ...prev, [addr]: { ...prev[addr], status: "done", count: part.length } })); setProgress(p=>({ ...p, done: Math.min(p.total, p.done+1), ok: p.ok+1 })); }
    catch (e:any) { setErrors(es=>[...es,{address:addr,message:e?.message||"未知错误"}]); setAddrStatus(prev=>({ ...prev, [addr]: { ...prev[addr], status: "error", message: String(e||"") } })); setProgress(p=>({ ...p, done: Math.min(p.total, p.done+1), fail: p.fail+1 })); }
    finally { setIsRunning(false); }
  }

  function addSingleToList(){ const a=singleAddr.trim(); if(!a) return; if(!addresses.includes(a)){ const next=[...addresses,a]; setAddresses(next); setAddrStatus(prev=>({ ...prev, [a]: { status: "pending", count: 0, pages: 0 } })); setProgress(p=>({ ...p, total: next.length })); } setSingleAddr(""); }
  function stopAll(){ cancelRef.current.cancelled=true; setIsRunning(false); }
  function clearAll(){ setAddresses([]); setRows([]); setErrors([]); setAddrStatus({}); setProgress({ total: 0, done: 0, ok: 0, fail: 0 }); cancelRef.current.cancelled=false; setNeedApiKey(false); setErrorAlertVisible(false); if (errorTimerRef.current) { clearTimeout(errorTimerRef.current); errorTimerRef.current = null; } }

  // —— UI 组件（仅样式/交互升级，不改逻辑） ——
  const Stat = ({ label, value }: { label: string; value: any }) => (
    <Card className="rounded-2xl shadow-md border border-neutral-200/60 bg-white/80"><CardContent className="p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="text-xl font-semibold mt-1">{value}</div></CardContent></Card>
  );

  const ProgressBar = ({ value, running, total }: { value: number; running: number; total: number }) => {
    // 仅按已完成计算百分比，防止一直 100%
    const pct = total ? Math.round((value / total) * 100) : 0;
    return (
      <div className="space-y-1">
        <Progress value={pct} className="h-2" />
        <div className="text-xs text-muted-foreground">{pct}%（完成 {value} / 总数 {total}，进行中 {running}）</div>
      </div>
    );
  };

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(1200px_600px_at_20%_-10%,rgba(99,102,241,0.10),transparent),radial-gradient(1000px_480px_at_80%_0%,rgba(236,72,153,0.08),transparent)] bg-gradient-to-b from-neutral-50 to-neutral-100 text-foreground">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-7xl px-4 sm:px-6 py-8 sm:py-12">
        {/* 顶部 Header */}
        <Card className="rounded-2xl shadow-md border border-neutral-200/60 bg-white/80 backdrop-blur">
          <CardHeader className="pb-3">
            <CardTitle className="text-3xl font-bold tracking-tight">波场链批量查询助手</CardTitle>
            <CardDescription className="text-muted-foreground">Excel 批量 / 单地址查询 · 游标分页 · 并发与限速控制 · 导出 CSV/Excel</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
              <Input placeholder="输入单个 TRON 地址（如：T...）" value={singleAddr} onChange={(e) => setSingleAddr(e.target.value)} className="rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2"/>
              <Button variant="outline" className="rounded-2xl hover:ring-1 hover:ring-neutral-300" onClick={addSingleToList}><PlusCircle className="mr-2 h-4 w-4"/>加入批量</Button>
              <Button className="rounded-2xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white hover:from-indigo-500 hover:to-fuchsia-500" disabled={!singleAddr || isRunning} onClick={runOne}><Send className="mr-2 h-4 w-4"/>单地址查询</Button>
            </div>

            <Separator className="my-4" />

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" className="rounded-2xl hover:ring-1 hover:ring-neutral-300" onClick={downloadTemplate}><FileSpreadsheet className="mr-2 h-4 w-4"/>下载模板</Button>
              <input
                id="excel-upload"
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e)=>{ const f=e.target.files?.[0]; if(f) handleFile(f); e.currentTarget.value=""; }}
              />
              <Button variant="outline" className="rounded-2xl hover:ring-1 hover:ring-neutral-300" asChild>
                <label htmlFor="excel-upload" className="cursor-pointer inline-flex items-center">
                  <Upload className="mr-2 h-4 w-4"/>导入 Excel
                </label>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 统计与进度 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
          <Stat label="地址数" value={addresses.length} />
          <Stat label="已完成" value={`${finishedCount}/${addresses.length}`} />
          <Stat label="成功" value={progress.ok} />
          <Stat label="失败" value={progress.fail} />
        </div>

        {/* 主体区域：左侧参数/控制，右侧地址列表 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          {/* 左侧：参数 + 控制 */}
          <Card className="rounded-2xl shadow-md border border-neutral-200/60 bg-white/80 lg:col-span-2">
            <CardHeader className="pb-2 flex flex-row items-center gap-2">
              <Settings className="h-5 w-5"/>
              <CardTitle className="text-base font-semibold">查询参数</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <Tabs defaultValue="keys" className="w-full">
                <TabsList className="rounded-2xl bg-neutral-100/60 p-1">
                  <TabsTrigger value="params" className="rounded-xl text-neutral-600 data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm">参数</TabsTrigger>
                  <TabsTrigger value="keys" className="rounded-xl text-neutral-600 data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm">API Keys</TabsTrigger>
                </TabsList>
                <TabsContent value="params" className="pt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm text-muted-foreground">Endpoint</Label>
                      <Input className="mt-2 rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2" value={endpoint} onChange={(e)=>setEndpoint(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">TRC20 合约地址（可选，留空=全部）</Label>
                      <Input className="mt-2 rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2" value={contract} onChange={(e)=>setContract(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">并发数量（建议 2–4）</Label>
                      <div className="mt-2 flex items-center gap-2">
                        <Input type="number" min={1} max={20} className="w-28 rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2" value={concurrency} onChange={(e)=>setConcurrency(Math.max(1, Math.min(20, Number(e.target.value)||1)))} />
                        <div className="flex gap-2">
                          {[2,3,4].map(n => (
                            <Button key={n} variant={concurrency===n?"default":"outline"} className="rounded-xl" onClick={()=>setConcurrency(n)}>{n}</Button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">全局 QPS 上限（默认 12/s）</Label>
                      <Input type="number" min={1} max={20} className="mt-2 w-28 rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2" value={qpsMax} onChange={(e)=>setQpsMax(Math.max(1, Math.min(20, Number(e.target.value)||12)))} />
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">单次请求超时（毫秒）</Label>
                      <Input type="number" min={2000} max={60000} className="mt-2 rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2" value={timeoutMs} onChange={(e)=>setTimeoutMs(Math.max(2000, Math.min(60000, Number(e.target.value)||15000)))} />
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">每页间隔（毫秒）</Label>
                      <Input type="number" min={0} max={3000} className="mt-2 rounded-2xl focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2" value={pauseMs} onChange={(e)=>setPauseMs(Math.max(0, Math.min(3000, Number(e.target.value)||220)))} />
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="keys" className="pt-4">
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground inline-flex items-center gap-2"><KeyRound className="h-4 w-4"/>TronGrid API Keys（逗号/换行/分号分隔）</Label>
                    <Textarea className="rounded-2xl min-h-[96px]" placeholder="key1,key2
key3" value={apiKeysText} onChange={(e)=>{ setApiKeysText(e.target.value); if (e.target.value.trim().length>0) setNeedApiKey(false); }} />
                    <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
                      <LinkIcon className="h-3.5 w-3.5"/>
                      <a className="underline" href="https://www.trongrid.io/" target="_blank" rel="noreferrer">没有 Key？点击申请（TronGrid）</a>
                    </div>
                    {needApiKey && (
                      <Alert variant="destructive" className="rounded-2xl">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>需要 API Key</AlertTitle>
                        <AlertDescription>请输入有效的 API Key</AlertDescription>
                      </Alert>
                    )}
                    {!needApiKey && apiKeys.length === 0 && (
                      <Alert className="rounded-2xl">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>提示</AlertTitle>
                        <AlertDescription>未填写 API Key：请求更容易触发限速（403/429）且可能返回极慢，建议填入多个 Key 以轮换使用。</AlertDescription>
                      </Alert>
                    )}
                  </div>
                </TabsContent>
              </Tabs>

              <Separator />

              <div className="flex flex-wrap gap-3">
                {!isRunning ? (
                  <Button className="rounded-2xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white hover:from-indigo-500 hover:to-fuchsia-500" disabled={!addresses.length} onClick={runAll}><Play className="mr-2 h-4 w-4"/>开始批量查询</Button>
                ) : (
                  <Button variant="secondary" className="rounded-2xl bg-neutral-900 text-white hover:bg-neutral-800" onClick={stopAll}><Square className="mr-2 h-4 w-4"/>停止</Button>
                )}
                <Button variant="outline" className="rounded-2xl hover:ring-1 hover:ring-neutral-300" onClick={clearAll}><Trash2 className="mr-2 h-4 w-4"/>清空</Button>
                <Button variant="outline" className="rounded-2xl hover:ring-1 hover:ring-neutral-300" disabled={!(allDone && rows.length > 0)} onClick={downloadExcel}><Download className="mr-2 h-4 w-4"/>导出 Excel</Button>
                <Button variant="outline" className="rounded-2xl hover:ring-1 hover:ring-neutral-300" disabled={!(allDone && rows.length > 0)} onClick={downloadCSV}><Download className="mr-2 h-4 w-4"/>导出 CSV</Button>
              </div>

              <div className="pt-2"><ProgressBar value={finishedCount} running={runningCount} total={addresses.length} /></div>
            </CardContent>
          </Card>

          {/* 右侧：地址列表 */}
          <Card className="rounded-2xl shadow-md border border-neutral-200/60 bg-white/80">
            <CardHeader className="pb-3 flex flex-row items-center gap-2">
              <FileSpreadsheet className="h-4 w-4"/>
              <CardTitle className="text-base font-semibold">地址列表</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[360px] overflow-auto rounded-2xl border">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-neutral-50 backdrop-blur">
                    <tr>
                      <th className="text-left p-2 w-10">#</th>
                      <th className="text-left p-2">钱包地址</th>
                      <th className="text-left p-2">状态</th>
                      <th className="text-left p-2">记录数</th>
                      <th className="text-left p-2">页数</th>
                      <th className="text-left p-2">信息</th>
                    </tr>
                  </thead>
                  <tbody>
                    {addresses.map((a, idx) => {
                      const st = addrStatus[a] || { status: "pending", count: 0, pages: 0 };
                      return (
                        <tr key={a} className="border-b last:border-none">
                          <td className="p-2">{idx + 1}</td>
                          <td className="p-2 font-mono text-xs sm:text-[13px] break-all">{a}</td>
                          <td className="p-2">
                            {st.status === "pending" && <Badge variant="secondary" className="rounded-xl bg-neutral-200 text-neutral-700 hover:bg-neutral-200"><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin"/>待开始</Badge>}
                            {st.status === "running" && <Badge className="rounded-xl bg-amber-500 text-white hover:bg-amber-500"><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin"/>查询中</Badge>}
                            {st.status === "done" && <Badge className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-500"><CheckCircle2 className="mr-1 h-3.5 w-3.5"/>完成</Badge>}
                            {st.status === "error" && <Badge className="rounded-xl bg-rose-500 text-white hover:bg-rose-500"><XCircle className="mr-1 h-3.5 w-3.5"/>失败</Badge>}
                          </td>
                          <td className="p-2">{st.count ?? 0}</td>
                          <td className="p-2">{st.pages ?? 0}</td>
                          <td className="p-2 text-xs text-muted-foreground">{st.message || ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {errorAlertVisible && errors.length > 0 && (
                <Alert variant="destructive" className="mt-4 rounded-2xl">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>查询错误（{errors.length}）</AlertTitle>
                  <AlertDescription>
                    <div className="max-h-40 overflow-auto space-y-1">
                      {errors.map((e,i)=> {
                      const full = e.address ? `${e.address} — ${e.message}` : e.message;
                      return (
                        <div key={i} className="flex items-start justify-between gap-2 py-0.5">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="text-xs break-all cursor-help">{e.address ? (<><span className="font-mono">{middleEllipsis(e.address)}</span> — {e.message}</>) : e.message}</div>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[560px] break-all">
                                <div className="font-mono text-xs whitespace-pre-wrap break-all">{full}</div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => navigator.clipboard.writeText(full)}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      );
                    })}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 结果表 */}
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
                    {["地址","哈希","转入地址","转出地址","数量","代币","时间"].map(h => (
                      <th key={h} className="text-left p-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0,1000).map((r,i)=> (
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
      </motion.div>
    </div>
  );
}
