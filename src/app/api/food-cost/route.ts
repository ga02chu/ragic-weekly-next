import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const FIELDS_PURCHASE = {
  date: '進貨日期時間',
  store: '採購分店',
  vendor: '廠商名稱',
  amount: '合計金額',
  orderNo: '進貨單號',
}
const FIELDS_INVENTORY = {
  date: '盤點日期',
  store: '倉庫分店',
  vendor: '廠商名稱',
  amount: '合計金額',
}
const FIELDS_ITEM = {
  orderNo: '進貨單號',
  vendor: '廠商',
  name: '商品名稱',
  amount: '本次進貨金額',
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

async function fetchRagic(path: string, token: string, limit = 5000, force = false) {
  const url = `https://ap7.ragic.com/${path}?api&limit=${limit}&subtables=0&APIKey=${token}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 50_000)
  try {
    const res = await fetch(url, force
      ? { signal: ctrl.signal, cache: 'no-store' }
      : { signal: ctrl.signal, next: { revalidate: 300 } })
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
  const force = searchParams.has('_') || searchParams.get('refresh') === '1'

  const token = process.env.RAGIC_TOKEN
  const purchasePath = process.env.RAGIC_PATH_PURCHASES
  const inventoryPath = process.env.RAGIC_PATH_INVENTORY
  const itemsPath = process.env.RAGIC_PATH_PURCHASE_ITEMS

  if (!token || !purchasePath || !inventoryPath) {
    return NextResponse.json({ error: 'Missing RAGIC_TOKEN / RAGIC_PATH_PURCHASES / RAGIC_PATH_INVENTORY' }, { status: 500 })
  }

  try {
    const [purchaseRows, inventoryRows, itemRows] = await Promise.all([
      fetchRagic(purchasePath, token, 5000, force),
      fetchRagic(inventoryPath, token, 5000, force),
      itemsPath ? fetchRagic(itemsPath, token, 8000, force) : Promise.resolve([] as RagicRow[]),
    ])

    if (!purchaseRows.length && !inventoryRows.length) {
      return NextResponse.json({ error: 'Ragic 端回傳空資料或逾時，請稍後重試' }, { status: 504 })
    }

    // 進貨細項：以「進貨單號」為 key，累加員工餐金額
    const staffMealByOrder: Record<string, number> = {}
    const totalLineByOrder: Record<string, number> = {}
    let staffMealTotalAll = 0
    itemRows.forEach(r => {
      const orderNo = String(r[FIELDS_ITEM.orderNo] || '')
      if (!orderNo) return
      const amt = toNum(r[FIELDS_ITEM.amount])
      totalLineByOrder[orderNo] = (totalLineByOrder[orderNo] || 0) + amt
      const name = String(r[FIELDS_ITEM.name] || '')
      if (name.includes('員工餐')) {
        staffMealByOrder[orderNo] = (staffMealByOrder[orderNo] || 0) + amt
        staffMealTotalAll += amt
      }
    })

    const purchases = purchaseRows.map(r => {
      const orderNo = String(r[FIELDS_PURCHASE.orderNo] || '')
      const total = toNum(r[FIELDS_PURCHASE.amount])
      const staffMeal = staffMealByOrder[orderNo] || 0
      const lineTotal = totalLineByOrder[orderNo] || 0
      // 「整單就是員工餐」判定：員工餐金額 ≥ 該單品項總和的 99%（容錯）
      const isStaffOnly = staffMeal > 0 && lineTotal > 0 && staffMeal / lineTotal >= 0.99
      return {
        date: parseDate(r[FIELDS_PURCHASE.date]),
        store: String(r[FIELDS_PURCHASE.store] || ''),
        vendor: String(r[FIELDS_PURCHASE.vendor] || ''),
        amount: total,
        orderNo,
        staffMeal,
        isStaffOnly,
      }
    }).filter(p => p.date && p.vendor)

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
      counts: { purchases: purchases.length, inventory: inventory.length, items: itemRows.length },
      staffMealTotalAll,
    })
    // 強制刷新時不要快取；正常情況 CDN 快取 5 分鐘
    if (force) {
      res.headers.set('Cache-Control', 'no-store, max-age=0')
    } else {
      res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300')
    }
    return res
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
