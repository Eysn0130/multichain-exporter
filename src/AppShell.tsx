// AppShell.tsx
import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import TronView from "./TronView";
import EthView from "./EthView";
import { Network, CircuitBoard, KeyRound, BookOpen, HelpCircle, X, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

/**
 * AppShell（含移动端 50% 缩放自适应）
 * - 自动检测手机浏览器：iOS/Android UA、coarse pointer + 小屏宽度
 * - 移动端开启 50% 缩放（双保险）：
 *   1) 动态设置 <meta name="viewport" initial-scale=0.5>（优先）
 *   2) 为容器应用 CSS zoom: 0.5（fallback），并保留桌面端 100%
 * - 同时保留此前的高级视觉样式与 Tabs 美化
 */
export default function AppShell() {
  const [showHint, setShowHint] = React.useState(true);
  const [tab, setTab] = React.useState<"tron" | "eth">("tron");
  const [isMobile, setIsMobile] = React.useState(false);
  const originalViewportRef = React.useRef<string | null>(null);

  // —— 设备检测：手机浏览器即判定为移动端
  const detectMobile = React.useCallback(() => {
    if (typeof window === "undefined") return false;
    const ua = (navigator.userAgent || navigator.vendor || "").toLowerCase();
    const isPhoneUA = /iphone|ipod|android.*mobile|windows phone|blackberry/.test(ua);
    const isPadUA = /ipad|android(?!.*mobile)/.test(ua); // 平板也可按需缩放，这里默认不缩放
    const coarse = window.matchMedia?.("(pointer:coarse)").matches ?? false;
    const small = window.matchMedia?.("(max-width: 768px)").matches ?? window.innerWidth <= 768;
    // 只对“手机”生效：UA 命中手机 或（粗指针+小屏）
    return isPhoneUA || (!isPadUA && coarse && small);
  }, []);

  // —— 首次与窗口/方向变化时重新判定
  React.useEffect(() => {
    const recompute = () => setIsMobile(detectMobile());
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("orientationchange", recompute);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("orientationchange", recompute);
    };
  }, [detectMobile]);

  // —— 根据 isMobile 动态设置 viewport（并保存/恢复原值）
  React.useEffect(() => {
    const ensureViewport = () => {
      let meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "viewport";
        document.head.appendChild(meta);
      }
      return meta;
    };

    const meta = ensureViewport();
    if (isMobile) {
      if (originalViewportRef.current === null) {
        originalViewportRef.current = meta.getAttribute("content") || "width=device-width, initial-scale=1";
      }
      // 50% 缩放，锁定缩放，避免双指误放大
      meta.setAttribute(
        "content",
        "width=device-width, initial-scale=0.5, maximum-scale=0.5, user-scalable=no, viewport-fit=cover"
      );
    } else if (originalViewportRef.current !== null) {
      meta.setAttribute("content", originalViewportRef.current);
      originalViewportRef.current = null;
    }
  }, [isMobile]);

  const chainBadge = (
    <div className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white/80 px-3 py-1 text-xs text-neutral-700 shadow-sm">
      {tab === "tron" ? (
        <>
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
            <path d="M3.2 3.5l17.2 3.6-8.8 13.5L3.2 3.5z" fill="#EF4444" opacity=".95" />
          </svg>
          <span className="font-medium">TRON</span>
          <span className="text-neutral-300">·</span>
          <span>TRC20</span>
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
            <path d="M12 2l6.5 9.6L12 9.6 5.5 11.6 12 2z" fill="#6B7280" />
            <path d="M12 22l6.5-9.6L12 14.5 5.5 12.4 12 22z" fill="#9CA3AF" />
          </svg>
          <span className="font-medium">Ethereum</span>
          <span className="text-neutral-300">·</span>
          <span>ERC-20</span>
        </>
      )}
    </div>
  );

  // —— Fallback：为整个页面根容器施加 CSS zoom: 0.5（部分浏览器不支持 viewport 缩放时仍生效）
  const rootScaleStyle = isMobile
    ? ({
        zoom: 0.5, // 大多数移动浏览器可生效（非标准）
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-neutral-50 via-neutral-50 to-neutral-100"
      style={rootScaleStyle}
      data-mobile={isMobile ? "true" : "false"}
    >
      {/* ===== 顶部 ===== */}
      <header className="relative w-full border-b border-neutral-200/60 bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50 overflow-hidden">
        {/* 顶部渐变高亮线 */}
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-sky-600" />

        {/* 背景网格纹理（极淡） */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #000 1px, transparent 1px), linear-gradient(to bottom, #000 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />

        {/* 柔和氛围光 */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-14 left-10 h-36 w-36 rounded-full bg-indigo-400/25 blur-3xl" />
          <div className="absolute -bottom-16 right-12 h-40 w-40 rounded-full bg-fuchsia-400/25 blur-3xl" />
        </div>

        {/* Header 内容 */}
        <div className="relative mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            {/* 品牌与能力区 */}
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500 flex items-center gap-1.5">
                <Network className="h-3.5 w-3.5 opacity-70" />
                链上取证 · Multi-chain
              </div>

              <motion.h1
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
                className="mt-1 text-2xl md:text-3xl font-bold leading-tight"
              >
                <span className="bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-sky-600 bg-clip-text text-transparent">
                  多链地址批量查询与导出助手
                </span>
              </motion.h1>

              <p className="mt-2 text-sm text-neutral-600">
                交易 · 转账 · Excel 批量 / 单地址 · 游标分页 · 并发与限速 · 一键导出
              </p>

              {/* 能力胶囊 */}
              <div className="mt-3 flex flex-wrap gap-2">
                {["Excel 批量", "单地址", "游标分页", "并发 & 限速", "一键导出"].map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full border border-neutral-200 bg-white/80 px-3 py-1 text-[12px] text-neutral-700 shadow-sm"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-3 text-[12px] text-neutral-500">本地导出 · 不保存查询数据 · 适配公安执法取证流程</div>
            </div>

            {/* 链种徽章 + 快捷操作 */}
            <div className="flex w-full items-end justify-between gap-3 md:w-auto md:justify-end md:gap-4">
              {/* 链种徽章 */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-white/80 backdrop-blur px-3 py-1 text-xs font-medium shadow-sm">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                    <path d="M3.2 3.5l17.2 3.6-8.8 13.5L3.2 3.5z" fill="#EF4444" opacity=".95"></path>
                  </svg>
                  <span className="ml-1">TRON</span>
                  <span className="text-neutral-300">·</span>
                  <span>TRC20</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-xl border border-neutral-200 bg-white/60 backdrop-blur px-3 py-1 text-xs font-medium text-neutral-700">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                    <path d="M12 2l6.5 9.6L12 9.6 5.5 11.6 12 2z" fill="#6B7280"></path>
                    <path d="M12 22l6.5-9.6L12 14.5 5.5 12.4 12 22z" fill="#9CA3AF"></path>
                  </svg>
                  <span className="ml-1">Ethereum</span>
                  <span className="text-neutral-300">·</span>
                  <span>ERC-20</span>
                </span>
              </div>

              {/* 快捷操作 */}
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" className="h-8 rounded-xl text-xs">
                  <a href="https://www.trongrid.io/" target="_blank" rel="noreferrer">
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                    申请 TronGrid Key
                  </a>
                </Button>
                <Button asChild variant="secondary" className="h-8 rounded-xl text-xs bg-neutral-900 text-white hover:bg-neutral-800">
                  <a href="#help" rel="noreferrer">
                    <HelpCircle className="mr-1.5 h-3.5 w-3.5" />
                    使用说明
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ===== 主体 ===== */}
      <main className="mx-auto max-w-7xl p-4 md:p-8">
        {/* 可关闭提示条（最佳实践） */}
        {showHint && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
            <div className="flex items-center gap-2">
              <CircuitBoard className="h-3.5 w-3.5" />
              <span>建议并发设置 2–4，QPS ≤ 12/s；如遇 429/403，请降低速率或添加更多 API Keys。</span>
            </div>
            <button
              className="rounded-md p-1 hover:bg-amber-100"
              aria-label="关闭提示"
              onClick={() => setShowHint(false)}
              title="关闭"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* 渐变描边 + 玻璃卡片容器 */}
        <div className="relative rounded-3xl p-[1.5px] bg-[conic-gradient(from_180deg_at_50%_50%,rgba(99,102,241,.35),rgba(236,72,153,.25),rgba(56,189,248,.3),rgba(99,102,241,.35))]">
          <div className="rounded-[calc(1.5rem-1.5px)] bg-white/90 shadow-xl border border-neutral-200/60 overflow-hidden">
            {/* 顶部信息条：当前选择 */}
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200/60 bg-neutral-50/70 px-4 py-2 md:px-6">
              <div className="flex items-center gap-2 text-xs text-neutral-600">
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">当前选择：</span>
                {chainBadge}
              </div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                高并发 · 低耦合 · 可导出
              </div>
            </div>

            {/* 主卡片内容 */}
            <Card className="rounded-none border-0 shadow-none bg-transparent">
              <CardHeader className="pb-1">
                <CardTitle className="text-lg md:text-xl font-semibold text-neutral-900">
                  选择区块链与查询方式
                </CardTitle>
                <CardDescription className="text-neutral-500">
                  在下方选择 <span className="font-medium text-neutral-700">波场链</span> 或{" "}
                  <span className="font-medium text-neutral-700">以太坊</span>，支持单地址与 Excel 批量查询、结果导出与限速控制。
                </CardDescription>
              </CardHeader>

              <CardContent className="pt-4">
                {/* 粘性 TabBar */}
                <div className="sticky top-4 z-20">
                  <div className="flex items-center justify-center">
                    <Tabs value={tab} onValueChange={(v) => setTab(v as "tron" | "eth")} className="w-full">
                      {/* TabsList / TabsTrigger（卡片化） */}
                      <TabsList
                        className="
                          grid w-full max-w-2xl grid-cols-1 sm:grid-cols-2 gap-2
                          rounded-2xl bg-neutral-100/70 p-2 shadow-sm
                        "
                      >
                        {/* TRON 选择卡 */}
                        <TabsTrigger
                          value="tron"
                          aria-label="切换到 波场链 TRON · TRC20"
                          className="
                            group relative overflow-hidden rounded-xl border bg-white/80 backdrop-blur
                            px-3 py-2 text-left transition-all
                            hover:bg-white data-[state=active]:scale-[1.02]
                            data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:border-transparent
                          "
                        >
                          <div
                            className="
                              pointer-events-none absolute inset-0 opacity-0
                              group-data-[state=active]:opacity-100
                              bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-sky-600
                            "
                          />
                          <div
                            className="
                              pointer-events-none absolute -bottom-3 left-6 right-6 h-8 rounded-full
                              opacity-0 blur-xl group-data-[state=active]:opacity-100
                              bg-white/35
                            "
                          />
                          <div className="relative flex items-center gap-3">
                            <span
                              className="
                                inline-flex h-9 w-9 items-center justify-center rounded-lg
                                ring-1 ring-inset ring-white/40 shadow-sm
                                bg-gradient-to-br from-rose-500 to-amber-500 text-white
                                group-data-[state=active]:bg-white/15
                              "
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                                <path d="M3.2 3.5l17.2 3.6-8.8 13.5L3.2 3.5z" fill="currentColor" opacity=".95" />
                              </svg>
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[15px] font-semibold leading-tight text-neutral-900 group-data-[state=active]:text-white">
                                波场链
                              </span>
                              <span className="mt-0.5 block text-[11px] leading-none tracking-wide text-neutral-500 group-data-[state=active]:text-white/90">
                                TRON · TRC20
                              </span>
                            </span>
                            <span
                              className="
                                ml-auto hidden sm:inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]
                                text-neutral-600 border-neutral-200
                                group-data-[state=active]:border-white/40 group-data-[state=active]:text-white
                              "
                            >
                              高速
                            </span>
                          </div>
                        </TabsTrigger>

                        {/* Ethereum 选择卡 */}
                        <TabsTrigger
                          value="eth"
                          aria-label="切换到 以太坊 Ethereum · ERC20/交易"
                          className="
                            group relative overflow-hidden rounded-xl border bg-white/80 backdrop-blur
                            px-3 py-2 text-left transition-all
                            hover:bg-white data-[state=active]:scale-[1.02]
                            data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:border-transparent
                          "
                        >
                          <div
                            className="
                              pointer-events-none absolute inset-0 opacity-0
                              group-data-[state=active]:opacity-100
                              bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-sky-600
                            "
                          />
                          <div
                            className="
                              pointer-events-none absolute -bottom-3 left-6 right-6 h-8 rounded-full
                              opacity-0 blur-xl group-data-[state=active]:opacity-100
                              bg-white/35
                            "
                          />
                          <div className="relative flex items-center gap-3">
                            <span
                              className="
                                inline-flex h-9 w-9 items-center justify-center rounded-lg
                                ring-1 ring-inset ring-neutral-300/60 shadow-sm
                                bg-gradient-to-br from-neutral-600 to-neutral-400 text-white
                                group-data-[state=active]:bg-white/15
                              "
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                                <path d="M12 2l6.5 9.6L12 9.6 5.5 11.6 12 2z" fill="currentColor" />
                                <path d="M12 22l6.5-9.6L12 14.5 5.5 12.4 12 22z" fill="currentColor" opacity=".55" />
                              </svg>
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[15px] font-semibold leading-tight text-neutral-900 group-data-[state=active]:text-white">
                                以太坊
                              </span>
                              <span className="mt-0.5 block text-[11px] leading-none tracking-wide text-neutral-500 group-data-[state=active]:text-white/90">
                                Ethereum · ERC-20/交易
                              </span>
                            </span>
                            <span
                              className="
                                ml-auto hidden sm:inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]
                                text-neutral-600 border-neutral-200
                                group-data-[state=active]:border-white/40 group-data-[state=active]:text-white
                              "
                            >
                              主流
                            </span>
                          </div>
                        </TabsTrigger>
                      </TabsList>

                      {/* 内容区域与业务组件 */}
                      <TabsContent value="tron" className="pt-6">
                        <TronView />
                      </TabsContent>

                      <TabsContent value="eth" className="pt-6">
                        <EthView />
                      </TabsContent>
                    </Tabs>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* 使用说明锚点（可按需扩展实际内容） */}
        <section id="usage" className="sr-only" aria-label="使用说明">
          这里可以放置简要的参数说明与最佳实践。
        </section>

        {/* 底部 */}
        <footer id="help" className="mt-6 text-center text-xs text-neutral-500">
          若无 TronGrid API Key，可前往
          <a
            className="mx-1 underline decoration-dotted underline-offset-2 hover:text-neutral-700"
            href="https://www.trongrid.io/"
            target="_blank"
            rel="noreferrer"
          >
            TronGrid 官网
          </a>
          申请；遇到问题请查看「使用说明」或联系管理员。
        </footer>
      </main>
    </div>
  );
}
