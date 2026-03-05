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

  const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
  if (!PERPLEXITY_API_KEY) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'PERPLEXITY_API_KEY が設定されていません' }),
    };
  }

  const query = `
以下の2点について、最新情報をリサーチしてください（日本語で回答）。

1. 【美容サロン業界トレンドTop3】
   現在の日本の美容エステサロン業界で注目されているトレンドを3つ挙げてください。
   各トレンドに一言説明（30文字以内）を添えてください。

2. 【福岡エリア 美容・ライフスタイル 流行キーワードTop3】
   現在の福岡エリアで女性の間で流行している美容・ライフスタイルのキーワードを3つ挙げてください。

必ずこのJSONのみ返してください（説明や\`\`\`不要）：
{
  "industryTrends": [
    {"rank": 1, "title": "トレンド名", "desc": "説明30文字以内"},
    {"rank": 2, "title": "トレンド名", "desc": "説明30文字以内"},
    {"rank": 3, "title": "トレンド名", "desc": "説明30文字以内"}
  ],
  "fukuokaKeywords": [
    {"rank": 1, "keyword": "キーワード"},
    {"rank": 2, "keyword": "キーワード"},
    {"rank": 3, "keyword": "キーワード"}
  ],
  "fetchedAt": "${new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}"
}`;

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-sonar-small-128k-online', // ウェブ検索付きモデル
        messages: [
          {
            role: 'system',
            content: 'あなたは美容業界と日本のトレンドに詳しいリサーチャーです。必ず指定されたJSON形式のみで回答してください。',
          },
          {
            role: 'user',
            content: query,
          },
        ],
        temperature: 0.2,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json', ...CORS },
        body: JSON.stringify({ error: errData.error?.message || 'Perplexity APIエラー' }),
      };
    }

    const data = await response.json();
    const raw = data.choices[0]?.message?.content || '';
    const clean = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      // JSONパース失敗時はフォールバック
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...CORS },
        body: JSON.stringify({ rawText: raw, parseError: true }),
      };
    }

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
