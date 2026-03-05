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

  const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
  if (!TAVILY_API_KEY) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'TAVILY_API_KEY が設定されていません' }),
    };
  }

  // 3クエリを並列検索
  const QUERIES = [
    { label: '福岡エステトレンド',  query: '福岡 美容エステ トレンド' },
    { label: '美容エステ最新情報',  query: '美容エステ 最新トレンド 施術' },
    { label: 'SNS美容流行',        query: '美容 スキンケア 今週 流行 SNS インスタ' },
  ];

  const tavilySearch = ({ query }) =>
    fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        max_results: 5,
      }),
    });

  try {
    const responses = await Promise.all(QUERIES.map(tavilySearch));

    // いずれかがエラーなら最初のエラーを返す
    for (const res of responses) {
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return {
          statusCode: res.status,
          headers: { 'Content-Type': 'application/json', ...CORS },
          body: JSON.stringify({ error: errData.message || 'Tavily APIエラー' }),
        };
      }
    }

    const datasets = await Promise.all(responses.map(r => r.json()));

    // クエリごとにまとめて返す
    const sections = QUERIES.map(({ label }, i) => ({
      label,
      results: (datasets[i].results || []).map(item => ({
        title:   item.title || '',
        summary: (item.content || '').slice(0, 100),
        url:     item.url || '',
      })),
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
      body: JSON.stringify({ sections }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...CORS },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
