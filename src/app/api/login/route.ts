import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseServer } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { email = '', password = '' } = body as { email?: string; password?: string }

  const sitePassword = process.env.SITE_PASSWORD
  const token = process.env.SITE_AUTH_TOKEN

  if (!token) {
    return NextResponse.json({ error: '伺服器未設定 SITE_AUTH_TOKEN' }, { status: 500 })
  }

  // 方式 A：共用通行密碼（夥伴）
  if (!email && sitePassword && password === sitePassword) {
    return setAuthCookie(token)
  }

  // 方式 B：Supabase 帳號密碼（個人）
  if (email && password) {
    try {
      const supabase = await createSupabaseServer()
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (!error && data.user) {
        return setAuthCookie(token)
      }
    } catch {
      // fall through
    }
  }

  return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 })
}

function setAuthCookie(token: string) {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('site_auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
  return res
}
