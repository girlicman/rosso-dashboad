const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
  const API_KEY    = process.env.CLOUDINARY_API_KEY;
  const API_SECRET = process.env.CLOUDINARY_API_SECRET;

  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Cloudinary環境変数が不足しています' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { imageData } = body;
  if (!imageData) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'imageData が必要です' }) };

  try {
    const timestamp   = Math.floor(Date.now() / 1000);
    const signature   = crypto.createHash('sha1').update(`timestamp=${timestamp}${API_SECRET}`).digest('hex');
    const base64Data  = imageData.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    const boundary  = `----FormBoundary${Date.now()}`;
    const buildField = (name, value) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;

    const bodyStart = Buffer.from([
      buildField('timestamp', timestamp),
      buildField('api_key', API_KEY),
      buildField('signature', signature),
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ].join(''), 'utf8');
    const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: Buffer.concat([bodyStart, imageBuffer, bodyEnd]),
      }
    );

    const text = await res.text();
    console.log('Cloudinary status:', res.status, '/ body:', text.slice(0, 300));

    if (!res.ok) {
      const e = JSON.parse(text || '{}');
      return { statusCode: res.status, headers: CORS, body: JSON.stringify({ error: e.error?.message || text }) };
    }

    const data = JSON.parse(text);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
      body: JSON.stringify({ url: data.secure_url }),
    };

  } catch (err) {
    console.error('upload error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
