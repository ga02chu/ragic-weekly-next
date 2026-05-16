import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { password } = await request.json().catch(() => ({ password: '' }))
  const expected = process.env.SITE_PASSWORD
  const token = process.env.SITE_AUTH_TOKEN

  if (!expected || !token) {
    return NextResponse.json({ error: '伺服器未設定密碼' }, { status: 500 })
  }

  if (password !== expected) {
    return NextResponse.json({ error: '密碼錯誤' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('site_auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 天
  })
  return res
}
