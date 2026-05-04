// netlify/functions/analyze.js
// Netlify Serverless Function — proxy seguro para a API da Anthropic
// A chave da API fica APENAS no servidor (variável de ambiente do Netlify)
// nunca exposta no browser ou no código frontend.

exports.handler = async function(event, context) {

  // Apenas POST é permitido
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método não permitido. Use POST.' })
    };
  }

  // Verificar se a chave da API está configurada no Netlify
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada nas variáveis de ambiente do Netlify.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Body inválido. Envie JSON.' })
    };
  }

  const { imageBase64, mediaType } = body;

  if (!imageBase64) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Campo imageBase64 é obrigatório.' })
    };
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
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType || 'image/jpeg',
                data: imageBase64
              }
            },
            {
              type: 'text',
              text: PROMPT
            }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: data?.error?.message || 'Erro na API da Anthropic.' })
      };
    }

    // Extrair o texto da resposta
    const text = data.content?.find(b => b.type === 'text')?.text || '{}';

    // Extrair JSON robusto — pega tudo entre { e }
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Resposta da IA não contém JSON válido.', raw: text.slice(0, 100) })
      };
    }

    const parsed = JSON.parse(text.slice(start, end + 1));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Erro interno: ' + err.message })
    };
  }
};
