import { NextResponse, type NextRequest } from 'next/server'

// 簡易密碼閘：驗證 cookie `site_auth` === env SITE_AUTH_TOKEN
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 不擋 /login 頁面與 /api/login（讓人能進去輸密碼）
  if (pathname === '/login' || pathname.startsWith('/api/login')) {
    return NextResponse.next()
  }

  const token = request.cookies.get('site_auth')?.value
  const expected = process.env.SITE_AUTH_TOKEN

  if (!expected || token !== expected) {
    const url = new URL('/login', request.url)
    if (pathname !== '/') url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)'],
}
