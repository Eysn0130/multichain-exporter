import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import TronView from "./TronView";
import EthView from "./EthView";

/**
 * 应用外壳：
 * - 统一顶层布局与视觉风格（留白、圆角 2xl、柔和阴影）
 * - Tab 切换：波场链（TRON · TRC20）/ 以太坊（Ethereum · 交易 & ERC-20）
 * - 标题与副标题：与“单地址查询”按钮同色系，强化当前选择感
 */
export default function AppShell() {
  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-neutral-50 via-neutral-50 to-neutral-100">
      <header className="w-full border-b border-neutral-200/60 bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50">
        <div className="mx-auto max-w-7xl px-4 py-4 md:px-8 md:py-5">
          <h1 className="text-xl font-bold tracking-tight text-neutral-900 md:text-2xl">
            多链地址批量查询与导出助手
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            波场链 TRON · TRC20 ｜ 以太坊 Ethereum · 交易 & ERC-20 · Excel 批量 / 单地址 · 并发与限速 · 导出
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 md:p-8">
        <Card className="rounded-2xl shadow-lg border border-neutral-200/70 bg-white/90">
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
            <Tabs defaultValue="tron" className="w-full">
              <div className="flex items-center justify-center">
                <TabsList className="grid w-full max-w-xl grid-cols-2 rounded-2xl bg-neutral-100/80 p-1">
                  <TabsTrigger
                    value="tron"
                    className="rounded-xl border bg-white text-neutral-800 transition-colors data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-600 data-[state=active]:to-fuchsia-600 data-[state=active]:text-white data-[state=active]:border-transparent"
                    aria-label="切换到 波场链 TRON · TRC20"
                  >
                    <div className="flex flex-col items-center px-2 py-1">
                      <span className="font-semibold">波场链</span>
                      <span className="text-xs/5 opacity-90">TRON · TRC20</span>
                    </div>
                  </TabsTrigger>
                  <TabsTrigger
                    value="eth"
                    className="rounded-xl border bg-white text-neutral-800 transition-colors data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-600 data-[state=active]:to-fuchsia-600 data-[state=active]:text-white data-[state=active]:border-transparent"
                    aria-label="切换到 以太坊 Ethereum · ERC20/交易"
                  >
                    <div className="flex flex-col items-center px-2 py-1">
                      <span className="font-semibold">以太坊</span>
                      <span className="text-xs/5 opacity-90">Ethereum · ERC20/交易</span>
                    </div>
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="tron" className="pt-6">
                <TronView />
              </TabsContent>

              <TabsContent value="eth" className="pt-6">
                <EthView />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <footer className="mt-6 text-center text-xs text-neutral-500">
          若无 TronGrid API Key，可前往
          <a
            className="mx-1 underline decoration-dotted underline-offset-2 hover:text-neutral-700"
            href="https://www.trongrid.io/"
            target="_blank"
            rel="noreferrer"
          >
            TronGrid 官网
          </a>
          申请。
        </footer>
      </main>
    </div>
  );
}
