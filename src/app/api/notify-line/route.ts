import { NextRequest, NextResponse } from 'next/server'

interface StoreDistEntry {
  cat: string
  totalH: number
  ftH: number
  ptH: number
  ftInnerH: number
  ftOuterH: number
  ptInnerH: number
  ptOuterH: number
}

interface NotifyBody {
  storeDist: StoreDistEntry[]
  period: { from: string; to: string }
  viewMode?: 'week' | 'month'
}

function fmtH(n: number): string {
  return Number(n).toFixed(2)
}

function formatStoreDistText(dist: StoreDistEntry[], period: { from: string; to: string }, viewMode: 'week' | 'month' = 'week'): string {
  const title = viewMode === 'week' ? '📊 人事成本週報 — 分店分攤時數' : '📊 人事成本月報 — 分店分攤時數'
  const lines: string[] = [
    title,
    `期間：${period.from} ~ ${period.to}`,
    '',
  ]
  let totalAll = 0
  for (const d of dist) {
    if (d.totalH <= 0) continue
    totalAll += d.totalH
    lines.push(`【${d.cat}】`)
    lines.push(`正職 ${fmtH(d.ftH)}H`)
    lines.push(`  ├ 內場 ${fmtH(d.ftInnerH)}`)
    lines.push(`  └ 外場 ${fmtH(d.ftOuterH)}`)
    lines.push(`工讀 ${fmtH(d.ptH)}H`)
    lines.push(`  ├ 內場 ${fmtH(d.ptInnerH)}`)
    lines.push(`  └ 外場 ${fmtH(d.ptOuterH)}`)
    lines.push(`總時數 ${fmtH(d.totalH)}H`)
    lines.push('')
  }
  lines.push(`📈 合計 ${fmtH(totalAll)}H`)
  return lines.join('\n')
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as NotifyBody | null
  if (!body?.storeDist || !Array.isArray(body.storeDist)) {
    return NextResponse.json({ error: 'Missing storeDist' }, { status: 400 })
  }
  // 週報推播改用「料秘書」店鋪 OA（GA秘書額度已滿）；
  // 兩個 company env 都有才切換，否則退回原本的 GA秘書設定。
  const useCompany =
    !!process.env.LINE_CHANNEL_ACCESS_TOKEN_COMPANY && !!process.env.WEEKLY_REPORT_GROUP_ID
  const token = useCompany
    ? process.env.LINE_CHANNEL_ACCESS_TOKEN_COMPANY
    : process.env.LINE_CHANNEL_ACCESS_TOKEN
  const groupId = useCompany
    ? process.env.WEEKLY_REPORT_GROUP_ID
    : process.env.LINE_GROUP_ID
  if (!token) {
    return NextResponse.json({ error: '未設定 LINE access token' }, { status: 500 })
  }
  if (!groupId) {
    return NextResponse.json({ error: '未設定週報群組（WEEKLY_REPORT_GROUP_ID / LINE_GROUP_ID）' }, { status: 500 })
  }

  const text = formatStoreDistText(body.storeDist, body.period, body.viewMode || 'week')

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: 'text', text }],
      }),
    })
    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json({ error: `LINE API: ${res.status} ${errText}` }, { status: 500 })
    }
    return NextResponse.json({ ok: true, sent: text.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown' }, { status: 500 })
  }
}
