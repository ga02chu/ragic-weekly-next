export async function POST(request) {
  const { logs, dateFrom, dateTo } = await request.json()
  if (!logs) return Response.json({ error: 'Missing logs' }, { status: 400 })

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `你是一位餐飲顧問，請以老闆視角分析以下各分店值班主管日誌，用繁體中文輸出。

日期區間：${dateFrom} ～ ${dateTo}

${logs}

請用以下格式輸出（直接輸出純文字，不要加 markdown # 符號）：

📊 本期總結
（2-3句話概述本期整體狀況）

⚠️ 需要關注的問題
（按分類列出：客訴問題、食材問題、營運問題等，每點說明哪家店、什麼問題）

✅ 值得肯定的表現
（列出本期各店優良表現或值得繼續推行的事項）

🎯 老闆建議行動
（3-5點具體可執行的改善建議）`
        }]
      })
    })
    const data = await res.json()
    if (data.error) return Response.json({ error: data.error.message }, { status: 500 })
    return Response.json({ text: data.content?.[0]?.text || '' })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
