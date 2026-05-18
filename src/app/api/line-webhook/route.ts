import { NextRequest, NextResponse } from 'next/server'

// LINE webhook：當群組內有訊息時，回 Group ID 給使用者抄下來
// 設定方式：到 LINE Developers Console → Messaging API → Webhook URL 設成
//   https://你的網址/api/line-webhook
// 然後在群組裡隨便傳一句話，bot 會回 「📌 Group ID: ...」

interface LineSource { type?: string; groupId?: string; userId?: string }
interface LineMessage { type?: string; text?: string }
interface LineEvent { type?: string; replyToken?: string; source?: LineSource; message?: LineMessage }

async function replyMessage(replyToken: string, text: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  }).catch(() => { /* ignore */ })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { events?: LineEvent[] } | null
  if (!body?.events) return NextResponse.json({ ok: true })

  for (const ev of body.events) {
    if (ev.type !== 'message' || ev.message?.type !== 'text') continue
    const src = ev.source
    if (!src) continue
    const userText = (ev.message?.text || '').trim().toLowerCase()
    if (!ev.replyToken) continue

    if (src.type === 'group' && src.groupId) {
      // 只在使用者輸入 "id"、"groupid"、"group id" 時回應，避免一直洗版
      if (['id', 'groupid', 'group id', '群組id', '群組 id'].includes(userText)) {
        await replyMessage(ev.replyToken,
          `📌 Group ID（複製這串給 ga02）：\n${src.groupId}`)
      }
    } else if (src.type === 'user' && src.userId) {
      if (['id', 'userid', 'user id', 'my id'].includes(userText)) {
        await replyMessage(ev.replyToken, `📌 Your User ID:\n${src.userId}`)
      }
    }
  }

  return NextResponse.json({ ok: true })
}

// GET 用來測試 webhook URL 是否可達
export async function GET() {
  return NextResponse.json({ ok: true, hint: 'LINE webhook 端點正常。設定 webhook URL 後到群組裡傳訊息 "id" 來取得 Group ID' })
}
