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

  const CLOUD_NAME    = process.env.CLOUDINARY_CLOUD_NAME;
  const API_KEY       = process.env.CLOUDINARY_API_KEY;
  const API_SECRET    = process.env.CLOUDINARY_API_SECRET;
  const ACCESS_TOKEN  = process.env.INSTAGRAM_ACCESS_TOKEN;
  const BUSINESS_ID   = process.env.INSTAGRAM_BUSINESS_ID;

  if (!CLOUD_NAME || !API_KEY || !API_SECRET || !ACCESS_TOKEN || !BUSINESS_ID) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: '環境変数が不足しています' }),
    };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  // imageData: base64文字列（data:image/jpeg;base64,xxx）
  // caption: 投稿文
  // scheduledTime: 予約投稿のUNIXタイムスタンプ（省略時は即時投稿）
  const { imageData, caption, scheduledTime } = body;

  if (!imageData || !caption) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'imageData と caption が必要です' }),
    };
  }

  try {
    // ─────────────────────────────────────────
    // ① Cloudinary に画像をアップロード → URL取得
    // ─────────────────────────────────────────
    const timestamp = Math.floor(Date.now() / 1000);

    // 署名を生成（Cloudinary必須）
    const crypto = require('crypto');
    const signatureStr = `timestamp=${timestamp}${API_SECRET}`;
    const signature = crypto.createHash('sha1').update(signatureStr).digest('hex');

    const formData = new URLSearchParams();
    formData.append('file', imageData);
    formData.append('timestamp', timestamp);
    formData.append('api_key', API_KEY);
    formData.append('signature', signature);

    const cloudinaryRes = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );

    if (!cloudinaryRes.ok) {
      const e = await cloudinaryRes.json().catch(() => ({}));
      return {
        statusCode: cloudinaryRes.status,
        headers: CORS,
        body: JSON.stringify({ error: e.error?.message || 'Cloudinaryアップロードエラー' }),
      };
    }

    const cloudinaryData = await cloudinaryRes.json();
    const imageUrl = cloudinaryData.secure_url;

    // ─────────────────────────────────────────
    // ② Instagram にメディアコンテナを作成
    // ─────────────────────────────────────────
    const mediaParams = new URLSearchParams({
      image_url:    imageUrl,
      caption:      caption,
      access_token: ACCESS_TOKEN,
    });

    // 予約投稿の場合
    if (scheduledTime) {
      mediaParams.append('published', 'false');
      // Instagram APIはUNIXタイムスタンプ（整数）を要求
      mediaParams.append('scheduled_publish_time', String(scheduledTime));
    }

    const mediaContainerRes = await fetch(
      `https://graph.facebook.com/v19.0/${BUSINESS_ID}/media`,
      {
        method: 'POST',
        body: mediaParams,
      }
    );

    if (!mediaContainerRes.ok) {
      const e = await mediaContainerRes.json().catch(() => ({}));
      return {
        statusCode: mediaContainerRes.status,
        headers: CORS,
        body: JSON.stringify({ error: e.error?.message || 'Instagramメディア作成エラー' }),
      };
    }

    const mediaContainerData = await mediaContainerRes.json();
    const creationId = mediaContainerData.id;

    // ─────────────────────────────────────────
    // ③ 投稿を公開（即時 or 予約）
    // ─────────────────────────────────────────
    const publishParams = new URLSearchParams({
      creation_id:  creationId,
      access_token: ACCESS_TOKEN,
    });

    // 予約投稿の場合はpublishせずにコンテナIDだけ返す
    if (scheduledTime) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...CORS },
        body: JSON.stringify({
          success: true,
          type: 'scheduled',
          creationId,
          imageUrl,
          message: `予約投稿を設定しました`,
        }),
      };
    }

    const publishRes = await fetch(
      `https://graph.facebook.com/v19.0/${BUSINESS_ID}/media_publish`,
      {
        method: 'POST',
        body: publishParams,
      }
    );

    if (!publishRes.ok) {
      const e = await publishRes.json().catch(() => ({}));
      return {
        statusCode: publishRes.status,
        headers: CORS,
        body: JSON.stringify({ error: e.error?.message || 'Instagram投稿エラー' }),
      };
    }

    const publishData = await publishRes.json();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
      body: JSON.stringify({
        success: true,
        type: 'published',
        postId: publishData.id,
        imageUrl,
        message: 'Instagramに投稿しました！',
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
