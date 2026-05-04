// netlify/functions/analyze.js
// Netlify Serverless Function — proxy seguro para a API da Anthropic

exports.handler = async function(event, context) {

  // CORS headers para iOS Safari
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Preflight OPTIONS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Use POST.' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY nao configurada.' }) };
  }

  // Netlify pode base64-encodar o body quando vem de Blob/XHR do iOS
  let rawBody = event.body || '';
  if (event.isBase64Encoded) {
    rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    return {
      statusCode: 400, headers: corsHeaders,
      body: JSON.stringify({ error: 'Body invalido: ' + e.message + ' | raw: ' + rawBody.slice(0, 80) })
    };
  }

  const { imageBase64, mediaType } = body;
  if (!imageBase64) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'imageBase64 obrigatorio.' }) };
  }

  const PROMPT = `Você é um treinador de tênis especialista e analista de biomecânica. Analise este quadro de vídeo.

Retorne APENAS um objeto JSON puro (sem markdown, sem texto extra, sem \`\`\`):
{"player_detected":true,"ball_detected":false,"stroke_type":"forehand","phase":"preparation","body_position":"descrição","coaching_note":"observação em português","score":8,"racquet_angle":90,"wrist_angle":160,"hip_rotation":45,"knee_bend":140,"head_stability":8}

stroke_type: forehand|backhand|serve|volley|overhead|movement|unknown|none
phase: preparation|backswing|contact|follow_through|recovery|idle
Ângulos e head_stability podem ser null se não visíveis.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: PROMPT }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, headers: corsHeaders,
               body: JSON.stringify({ error: data?.error?.message || 'Erro Anthropic.' }) };
    }

    const text = data.content?.find(b => b.type === 'text')?.text || '{}';
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return { statusCode: 500, headers: corsHeaders,
               body: JSON.stringify({ error: 'IA nao retornou JSON.', raw: text.slice(0, 100) }) };
    }

    const parsed = JSON.parse(text.slice(start, end + 1));
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(parsed) };

  } catch (err) {
    return { statusCode: 500, headers: corsHeaders,
             body: JSON.stringify({ error: 'Erro interno: ' + err.message }) };
  }
};
