export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path') || process.env.RAGIC_PATH
  const token = searchParams.get('token') || process.env.RAGIC_TOKEN
  const limit = searchParams.get('limit') || 3000

  if (!path || !token) {
    return Response.json({ error: `Missing: ${!path ? 'path' : 'token'}` }, { status: 400 })
  }

  try {
    const url = `https://ap7.ragic.com/${path}?api&limit=${limit}&APIKey=${token}`
    const res = await fetch(url)
    const text = await res.text()
    const data = JSON.parse(text)
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
