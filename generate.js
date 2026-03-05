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

  const { prompt, storiesPrompt } = body;
  if (!prompt) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'prompt が必要です' }) };
  }

  const callAPI = (model, content, maxTokens) =>
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content }],
      }),
    });

  try {
    // 投稿文（Sonnet）とストーリーズ（Haiku）を並列実行 → コスト・速度を最適化
    const reqs = [callAPI('claude-sonnet-4-20250514', prompt, 3000)];
    if (storiesPrompt) {
      reqs.push(callAPI('claude-haiku-4-5-20251001', storiesPrompt, 600));
    }

    const rawResponses = await Promise.all(reqs);

    for (const res of rawResponses) {
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return {
          statusCode: res.status,
          headers: { 'Content-Type': 'application/json', ...CORS },
          body: JSON.stringify({ error: e.error?.message || 'Anthropic APIエラー' }),
        };
      }
    }

    const [postsData, storiesData] = await Promise.all(rawResponses.map(r => r.json()));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
      body: JSON.stringify({ posts: postsData, stories: storiesData || null }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...CORS },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
