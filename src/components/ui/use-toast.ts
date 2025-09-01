// src/components/ui/use-toast.ts
import { toast as sonner } from "sonner";

export type ToastVariant = "default" | "destructive";

export interface ToastOptions {
  title?: string;
  description?: string;
  duration?: number; // ms
  variant?: ToastVariant;
}

/**
 * 与 shadcn 的 useToast 保持相同的使用方式：
 * const { toast } = useToast();
 * toast({ title: "...", description: "...", duration: 2000 });
 */
export function useToast() {
  function toast(opts: ToastOptions) {
    const { title, description, duration = 2000, variant = "default" } = opts || {};
    const msg = title ?? (description ?? "");

    if (variant === "destructive") {
      sonner.error(msg, { description, duration });
    } else {
      // 用 success 让成功态为绿色；如需普通灰色可换成 sonner(msg, {...})
      sonner.success(msg, { description, duration });
    }
  }

  return { toast };
}

// 如果你项目里其他地方会直接 import { toast } from "@/components/ui/use-toast"
// 也顺便导出一个具名别名（可选）。
export const toast = (opts: ToastOptions) => useToast().toast(opts);
