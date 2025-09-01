// src/components/ui/toaster.tsx
import * as React from "react";
import { Toaster as SonnerToaster } from "sonner";

/**
 * 保持原有 import 方式：import { Toaster } from "@/components/ui/toaster";
 * 统一在 AppShell 或 App 顶层放一个 <Toaster /> 即可。
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      expand={true}
      richColors={true}
      closeButton={true}
      toastOptions={{
        // 全局默认时长，可被每次调用传入的 duration 覆盖
        duration: 2000,
      }}
    />
  );
}
