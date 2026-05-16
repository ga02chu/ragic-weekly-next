import { NextRequest, NextResponse } from 'next/server'

// Vercel function 最長執行 60 秒（hobby plan 上限）
export const maxDuration = 60

const FIELDS_PURCHASE = {
  date: '進貨日期時間',
  store: '採購分店',
  vendor: '廠商名稱',
  amount: '合計金額',
}
const FIELDS_INVENTORY = {
  date: '盤點日期',
  store: '倉庫分店',
  vendor: '廠商名稱',
  amount: '合計金額',
}

interface RagicRow { [k: string]: unknown }

function parseDate(v: unknown): string {
  const s = String(v || '').trim()
  const m = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  if (!m) return ''
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  const n = parseFloat(String(v || '').replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}

async function fetchRagic(path: string, token: string, limit = 5000) {
  // subtables=0 → 不回傳商品明細子表，大幅縮小 payload
  // limit=N → 取最近 N 筆
  const url = `https://ap7.ragic.com/${path}?api&limit=${limit}&subtables=0&APIKey=${token}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, next: { revalidate: 300 } })
    if (!res.ok) return []
    const text = await res.text()
    const data = JSON.parse(text) as Record<string, RagicRow>
    return Object.values(data).filter(r => typeof r === 'object' && r !== null && !Array.isArray(r))
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') || ''
  const to = searchParams.get('to') || ''

  const token = process.env.RAGIC_TOKEN
  const purchasePath = process.env.RAGIC_PATH_PURCHASES
  const inventoryPath = process.env.RAGIC_PATH_INVENTORY

  if (!token || !purchasePath || !inventoryPath) {
    return NextResponse.json({ error: 'Missing RAGIC_TOKEN / RAGIC_PATH_PURCHASES / RAGIC_PATH_INVENTORY' }, { status: 500 })
  }

  try {
    const [purchaseRows, inventoryRows] = await Promise.all([
      fetchRagic(purchasePath, token),
      fetchRagic(inventoryPath, token),
    ])

    if (!purchaseRows.length && !inventoryRows.length) {
      return NextResponse.json({ error: 'Ragic 端回傳空資料或逾時，請稍後重試' }, { status: 504 })
    }

    const purchases = purchaseRows.map(r => ({
      date: parseDate(r[FIELDS_PURCHASE.date]),
      store: String(r[FIELDS_PURCHASE.store] || ''),
      vendor: String(r[FIELDS_PURCHASE.vendor] || ''),
      amount: toNum(r[FIELDS_PURCHASE.amount]),
    })).filter(p => p.date && p.vendor)

    const inventory = inventoryRows.map(r => ({
      date: parseDate(r[FIELDS_INVENTORY.date]),
      store: String(r[FIELDS_INVENTORY.store] || ''),
      vendor: String(r[FIELDS_INVENTORY.vendor] || ''),
      amount: toNum(r[FIELDS_INVENTORY.amount]),
    })).filter(p => p.date && p.vendor)

    const filtPurchases = (from && to)
      ? purchases.filter(p => p.date >= from && p.date <= to)
      : purchases

    const res = NextResponse.json({
      purchases: filtPurchases,
      inventory,
      stores: Array.from(new Set([
        ...purchases.map(p => p.store),
        ...inventory.map(p => p.store),
      ].filter(Boolean))).sort(),
      vendors: Array.from(new Set([
        ...purchases.map(p => p.vendor),
        ...inventory.map(p => p.vendor),
      ].filter(Boolean))).sort(),
      counts: { purchases: purchases.length, inventory: inventory.length },
    })
    res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300')
    return res
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
