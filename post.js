const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
  const BUSINESS_ID  = process.env.INSTAGRAM_BUSINESS_ID;

  if (!ACCESS_TOKEN || !BUSINESS_ID) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Instagram環境変数が不足しています' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  // imageUrl: CloudinaryのURL, caption: 投稿文, scheduledTime: UNIXタイムスタンプ（任意）
  const { imageUrl, caption, scheduledTime } = body;
  console.log('受信:', { imageUrl: imageUrl?.slice(0, 60), captionLen: caption?.length, scheduledTime });

  if (!imageUrl || !caption) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'imageUrl と caption が必要です' }) };
  }

  try {
    // ① メディアコンテナ作成
    const mediaParams = new URLSearchParams({
      image_url:    imageUrl,
      caption:      caption,
      access_token: ACCESS_TOKEN,
    });

    if (scheduledTime) {
      mediaParams.append('published', 'false');
      mediaParams.append('scheduled_publish_time', String(scheduledTime));
    }

    const mediaRes = await fetch(
      `https://graph.facebook.com/v19.0/${BUSINESS_ID}/media`,
      { method: 'POST', body: mediaParams }
    );

    const mediaText = await mediaRes.text();
    console.log('Instagram media status:', mediaRes.status, '/ body:', mediaText.slice(0, 300));

    if (!mediaRes.ok) {
      const e = JSON.parse(mediaText || '{}');
      return { statusCode: mediaRes.status, headers: CORS, body: JSON.stringify({ error: e.error?.message || mediaText }) };
    }

    const { id: creationId } = JSON.parse(mediaText);

    // 予約の場合はここで終了（publishしない）
    if (scheduledTime) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...CORS },
        body: JSON.stringify({ success: true, type: 'scheduled', creationId, message: '予約投稿を設定しました🤍' }),
      };
    }

    // ② 即時公開
    const publishRes = await fetch(
      `https://graph.facebook.com/v19.0/${BUSINESS_ID}/media_publish`,
      { method: 'POST', body: new URLSearchParams({ creation_id: creationId, access_token: ACCESS_TOKEN }) }
    );

    const publishText = await publishRes.text();
    console.log('Instagram publish status:', publishRes.status, '/ body:', publishText.slice(0, 300));

    if (!publishRes.ok) {
      const e = JSON.parse(publishText || '{}');
      return { statusCode: publishRes.status, headers: CORS, body: JSON.stringify({ error: e.error?.message || publishText }) };
    }

    const { id: postId } = JSON.parse(publishText);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
      body: JSON.stringify({ success: true, type: 'published', postId, message: 'Instagramに投稿しました🤍' }),
    };

  } catch (err) {
    console.error('post error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
