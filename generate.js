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

  const { menu, postType, tags, voice, extra, trendData, instagramAdvice, tone } = body;

  if (!menu) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'menu が必要です' }) };
  }

  // ─────────────────────────────────────────
  // トレンド・分析データをテキスト化
  // ─────────────────────────────────────────
  const trendSection = trendData?.sections?.length ? `
【最新トレンド情報（Tavily取得）】
${trendData.sections.map(sec =>
  `■ ${sec.label}：${sec.results.map(r => r.title).join('・')}`
).join('\n')}` : '';

  const instagramSection = instagramAdvice ? `
【Instagram分析アドバイス】
${instagramAdvice}` : '';

  const toneSection = tone ? `
【今回のトーン調整】
${tone}（前回の投稿から微調整）` : '';

  // ─────────────────────────────────────────
  // Sonnet：投稿文（1案）＋素材指示＋Canva編集指示
  // ─────────────────────────────────────────
  const postPrompt = `あなたは銀座ロッソ福岡店（REVIメーカー直営エステサロン）のインスタグラム担当者です。

【サロン情報】
- 店名：REVI 銀座ロッソ 福岡店（福岡のメーカーズエステサロン）
- 特徴：ハードピーリング・陶肌ピーリング専門、iPS細胞培養エクソソーム導入（京都大学・中山教授監修）
- 住所：福岡市中央区警固2丁目11-15
- 予約LINE：https://lin.ee/X8BC3Og

【今回の投稿情報】
- 施術メニュー：${menu}
- 投稿タイプ：${postType || 'AIが最適なタイプを判断してください'}
- ターゲット：${tags || '20〜30代女性'}
- お客様の声・メモ：${voice || 'なし'}
- 補足：${extra || 'なし'}
${trendSection}
${instagramSection}
${toneSection}

【文体・スタイルのルール（厳守）】
1. 絵文字は控えめに。使うとしても🤍を1〜2個まで。他の絵文字は使わない。
2. 短い行で改行を多用する（1行10〜20文字程度を目安に、こまめに改行）
3. お客様の声がある場合は「　」で引用する
4. 区切り線（――――――――――）を本文の区切りに使う
5. 投稿の末尾は「▶︎▶︎▶︎」で締める（その後に予約誘導文を1行）
6. ハッシュタグは5〜8個のみ。必ず含めるタグ：#銀座ROSSO福岡店 #福岡エステ。他は内容に合わせて選ぶ。
7. 丁寧だが堅くなりすぎない、上品で親しみやすいトーン

以下を全て含むJSONのみ返してください（前後に説明や\`\`\`不要）：
{
  "postType": "選んだ投稿タイプ名",
  "postTypeReason": "このタイプにした理由（2文以内・🤍1個まで）",
  "post": "投稿文本文",
  "materialAdvice": "撮ってほしい写真・素材の具体的な指示（2〜3項目）",
  "canvaAdvice": "Canvaでの編集指示（テンプレの使い方・レイアウト・文字・カラー）"
}`;

  // ─────────────────────────────────────────
  // Haiku：ストーリーズ（1案）
  // ─────────────────────────────────────────
  const storiesPrompt = `銀座ロッソ福岡店（REVIメーカー直営エステサロン）のインスタグラムストーリーズ用の短文を作成してください。

【条件】
- 施術メニュー：${menu}
- 投稿タイプ：${postType || '最適なタイプで'}
- 100文字以内（厳守）
- 絵文字：🤍を1個まで
- 行動喚起（CTA）を含める
- トーン：${tone || '上品で親しみやすく'}

JSONのみ返してください：
{"story": "ストーリーズ文"}`;

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
    // 投稿文（Sonnet）＋ストーリーズ（Haiku）を並列実行
    const [postRes, storiesRes] = await Promise.all([
      callAPI('claude-sonnet-4-5', postPrompt, 2000),
      callAPI('claude-haiku-4-5', storiesPrompt, 400),
    ]);

    for (const res of [postRes, storiesRes]) {
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return {
          statusCode: res.status,
          headers: { 'Content-Type': 'application/json', ...CORS },
          body: JSON.stringify({ error: e.error?.message || 'Anthropic APIエラー' }),
        };
      }
    }

    const [postData, storiesData] = await Promise.all([postRes.json(), storiesRes.json()]);

    // JSONパースを堅牢に
    const cleanJSON = (text = '') => {
      const match = text.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : null;
    };

    const postParsed    = cleanJSON(postData.content?.[0]?.text);
    const storiesParsed = cleanJSON(storiesData.content?.[0]?.text);

    if (!postParsed || !storiesParsed) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', ...CORS },
        body: JSON.stringify({ error: 'AIの返答の解析に失敗しました。再度お試しください。' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
      body: JSON.stringify({
        postType:       postParsed.postType,
        postTypeReason: postParsed.postTypeReason,
        post:           postParsed.post,
        materialAdvice: postParsed.materialAdvice,
        canvaAdvice:    postParsed.canvaAdvice,
        story:          storiesParsed.story,
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
