// src/oklink.ts
// 说明：纯前端解析 OKLink 地址页与 token-transfer 子页中内嵌的 appState JSON。
// 要求：vite 代理里有 /oklink -> https://www.oklink.com （changeOrigin: true, secure: false）

export type OklinkSummary = {
  address: string | null;
  entity_tag: string | null;                          // 单个实体标签（tagMaps.entityTag）
  entity_tags: { text?: string; type?: string }[];    // 列表（tagStore.entityTags）
  risk_tags: string[];                                // 风险标签（字符串）
  property_tags: string[];                            // 属性标签（字符串）
  is_contract: boolean | null;                        // 是否合约地址（tagMaps.isContract）
  total_usd_value: number | null;                     // totalUsdValue
  balance_trx: number | null;                         // balance (TRX)
  usdt_holding: number | null;                        // token-transfer 页中的 usdtHolding

  // 明细（addressDetaiInfo）
  first_entry_from_address: string | null;
  first_entry_timestamp: number | null;
  first_entry_amount: number | null;
  first_entry_tx_hash: string | null;

  total_tx_amount: number | null;
  first_tx_timestamp: number | null;
  first_tx_hash: string | null;
  last_tx_timestamp: number | null;
  last_tx_hash: string | null;
};

function normTagList(items: any): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => (typeof it === "string" ? it : (it?.text || it?.name || it?.label || "")))
    .filter(Boolean);
}

async function fetchHtml(path: string): Promise<string> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `/oklink${path}${sep}_ts=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`OKLink fetch failed: ${res.status}`);
  return res.text();
}

function parseAppState(html: string): any {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const el = doc.querySelector<HTMLScriptElement>('script#appState[type="application/json"]');
  if (!el || !el.textContent) throw new Error("OKLink appState not found");
  return JSON.parse(el.textContent);
}

async function fetchMainState(address: string, lang: "" | "zh-hans" = "zh-hans"): Promise<any> {
  try {
    const html = await fetchHtml(`/${lang}/tron/address/${address}`);
    return parseAppState(html);
  } catch {
    // 失败则回退英文路径
    const html = await fetchHtml(`/tron/address/${address}`);
    return parseAppState(html);
  }
}

async function fetchTokenState(address: string, lang: "" | "zh-hans" = "zh-hans"): Promise<any> {
  try {
    const html = await fetchHtml(`/${lang}/tron/address/${address}/token-transfer`);
    return parseAppState(html);
  } catch {
    // 失败则回退英文路径
    const html = await fetchHtml(`/tron/address/${address}/token-transfer`);
    return parseAppState(html);
  }
}

export async function fetchSlimSummary(address: string, lang: "" | "zh-hans" = "zh-hans"): Promise<OklinkSummary> {
  const [main, token] = await Promise.all([
    fetchMainState(address, lang),
    fetchTokenState(address, lang),
  ]);

  const ps = main?.appContext?.initialProps?.store?.pageState;
  const info = ps?.infoStore?.state ?? {};
  const tags = ps?.tagStore ?? {};
  const tagMaps = tags?.tagMaps ?? {};
  const entTags = Array.isArray(tags?.entityTags) ? tags.entityTags : [];
  const riskTags = Array.isArray(tags?.riskTags) ? tags.riskTags : [];
  const propTags = Array.isArray(tags?.propertyTags) ? tags.propertyTags : [];
  const detail = info?.addressDetaiInfo ?? {};

  const usdtHolding =
    token?.appContext?.initialProps?.store?.pageState?.infoStore?.state?.usdtHolding ?? null;

  return {
    address: info.address ?? null,
    entity_tag: tagMaps.entityTag ?? null,
    entity_tags: entTags,
    risk_tags: normTagList(riskTags),
    property_tags: normTagList(propTags),
    is_contract: typeof tagMaps.isContract === "boolean" ? tagMaps.isContract : null,
    total_usd_value: info.totalUsdValue ?? null,
    balance_trx: info.balance ?? null,
    usdt_holding: usdtHolding,

    first_entry_from_address: detail.firstEntryFromAddress ?? null,
    first_entry_timestamp: detail.firstEntryTimestamp ?? null,
    first_entry_amount: detail.firstEntryAmount ?? null,
    first_entry_tx_hash: detail.firstEntryTxHash ?? null,

    total_tx_amount: detail.totalTxAmount ?? null,
    first_tx_timestamp: detail.firstTxTimestamp ?? null,
    first_tx_hash: detail.firstTxHash ?? null,
    last_tx_timestamp: detail.lastTxTimestamp ?? null,
    last_tx_hash: detail.lastTxHash ?? null,
  };
}
