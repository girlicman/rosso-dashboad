const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY が設定されていません' }),
    };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { menu, voice, extra, trendData, instagramAdvice } = body;

  if (!menu) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'menu が必要です' }) };
  }

  const trendSection = trendData?.sections?.length ? `
【最新トレンド情報】
${trendData.sections.map(sec =>
  `■ ${sec.label}：${sec.results.map(r => r.title).join('・')}`
).join('\n')}` : '';

  const instagramSection = instagramAdvice ? `
【Instagram分析アドバイス】
${instagramAdvice}` : '';

  const prompt = `あなたは美容エステサロン（銀座ロッソ福岡店）のSNSマーケターです。

【今回の施術メニュー】${menu}
【お客様の声・メモ】${voice || 'なし'}
【補足】${extra || 'なし'}
${trendSection}
${instagramSection}

上記の情報をもとに、今週のInstagram投稿に向けた提案をしてください。

JSONのみ返してください（説明・\`\`\`不要）：
{
  "postType": "今週おすすめの投稿タイプ（例：専門知識・教育型）",
  "postTypeReason": "このタイプにした理由（2文以内・上品で親しみやすく・🤍1個まで）",
  "materialAdvice": "撮ってほしい写真・素材の具体的な指示（改行区切りで2〜3項目）",
  "canvaAdvice": "Canvaでの編集指示（テンプレの使い方・レイアウト・文字・カラーを具体的に）"
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // 素材指示はHaikuでコスト削減
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return {
        statusCode: res.status,
        headers: { 'Content-Type': 'application/json', ...CORS },
        body: JSON.stringify({ error: e.error?.message || 'Anthropic APIエラー' }),
      };
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text?.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...CORS },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
