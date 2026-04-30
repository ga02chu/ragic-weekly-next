export async function GET() {
  return Response.json({
    hasToken: !!process.env.RAGIC_TOKEN,
    hasPath: !!process.env.RAGIC_PATH,
  })
}
