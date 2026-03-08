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

  const ACCESS_TOKEN     = process.env.INSTAGRAM_ACCESS_TOKEN;
  const BUSINESS_ID      = process.env.INSTAGRAM_BUSINESS_ID;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!ACCESS_TOKEN || !BUSINESS_ID || !ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: '環境変数が不足しています' }),
    };
  }

  try {
    // ─────────────────────────────────────────
    // ① 過去10投稿を取得
    // ─────────────────────────────────────────
    const mediaRes = await fetch(
      `https://graph.facebook.com/v19.0/${BUSINESS_ID}/media` +
      `?fields=id,caption,media_type,timestamp` +
      `&limit=10` +
      `&access_token=${ACCESS_TOKEN}`
    );

    if (!mediaRes.ok) {
      const e = await mediaRes.json().catch(() => ({}));
      return {
        statusCode: mediaRes.status,
        headers: CORS,
        body: JSON.stringify({ error: e.error?.message || 'Instagram APIエラー（メディア取得）' }),
      };
    }

    const mediaData = await mediaRes.json();
    const posts = mediaData.data || [];

    if (!posts.length) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...CORS },
        body: JSON.stringify({ advice: '過去の投稿データがまだありません。投稿を始めましょう🤍' }),
      };
    }

    // ─────────────────────────────────────────
    // ② 各投稿のインサイト（いいね・保存・リーチ）を取得
    // ─────────────────────────────────────────
    const insightResults = await Promise.allSettled(
      posts.map(post =>
        fetch(
          `https://graph.facebook.com/v19.0/${post.id}/insights` +
          `?metric=likes,saved,reach,impressions` +
          `&access_token=${ACCESS_TOKEN}`
        ).then(r => r.json())
      )
    );

    // 投稿データとインサイトを結合
    const enrichedPosts = posts.map((post, i) => {
      const result = insightResults[i];
      const metrics = {};

      if (result.status === 'fulfilled' && result.value?.data) {
        result.value.data.forEach(m => {
          metrics[m.name] = m.values?.[0]?.value ?? 0;
        });
      }

      return {
        id:         post.id,
        timestamp:  post.timestamp,
        media_type: post.media_type,
        caption:    (post.caption || '').slice(0, 100),
        likes:      metrics.likes      ?? 0,
        saved:      metrics.saved      ?? 0,
        reach:      metrics.reach      ?? 0,
        impressions: metrics.impressions ?? 0,
      };
    });

    // ─────────────────────────────────────────
    // ③ Claude Haiku で一言アドバイスを生成
    // ─────────────────────────────────────────
    const analysisPrompt = `あなたは美容エステサロンのSNSマーケターです。
以下は銀座ロッソ福岡店の直近10投稿のInstagramデータです。

${enrichedPosts.map((p, i) => `
【投稿${i + 1}】
- 日時：${new Date(p.timestamp).toLocaleDateString('ja-JP')}
- タイプ：${p.media_type}
- いいね：${p.likes} / 保存：${p.saved} / リーチ：${p.reach}
- キャプション冒頭：${p.caption}
`).join('')}

このデータを分析して、次の投稿に向けた**一言アドバイス**を日本語で出してください。

【条件】
- 3文以内でコンパクトに
- 数字を1つだけ使って根拠を示す
- 次のアクションが明確になる内容
- 絵文字は🤍を1個まで
- 上品で親しみやすいトーン

JSONのみ返してください：
{"advice":"アドバイス文"}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // コスト削減のためHaiku
        max_tokens: 300,
        messages: [{ role: 'user', content: analysisPrompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.[0]?.text?.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
      body: JSON.stringify({
        advice: parsed.advice,
        // デバッグ用に生データも返す（本番では削除可）
        raw: enrichedPosts,
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...CORS },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
