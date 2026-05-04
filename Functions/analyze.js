// functions/analyze.js
// Netlify Serverless Function — usa https nativo do Node.js (compativel com Node 14+)

const https = require('https');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const PROMPT = 'Voce e um treinador de tenis especialista. Analise este quadro de video de tenis.\n\nRetorne APENAS um objeto JSON puro (sem markdown, sem texto extra, sem backticks):\n{"player_detected":true,"ball_detected":false,"stroke_type":"forehand","phase":"preparation","body_position":"descricao","coaching_note":"observacao em portugues","score":8,"racquet_angle":90,"wrist_angle":160,"hip_rotation":45,"knee_bend":140,"head_stability":8}\n\nstroke_type: forehand|backhand|serve|volley|overhead|movement|unknown|none\nphase: preparation|backswing|contact|follow_through|recovery|idle\nAngulos podem ser null se nao visiveis.';

function callAnthropic(apiKey, imageBase64) {
  return new Promise(function(resolve, reject) {
    var payload = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: PROMPT }
        ]
      }]
    });

    var options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    };

    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error('Resposta invalida: ' + data.slice(0,100))); }
      });
    });

    req.on('error', function(e) { reject(e); });
    req.setTimeout(60000, function() { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

exports.handler = async function(event) {

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Use POST.' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY nao configurada.' }) };
  }

  let rawBody = event.body || '';
  if (event.isBase64Encoded) {
    rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch(e) {
    return {
      statusCode: 400, headers: CORS,
      body: JSON.stringify({ error: 'JSON invalido: ' + e.message + ' | recebido: ' + rawBody.slice(0,80) })
    };
  }

  const { imageBase64 } = parsed;
  if (!imageBase64) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'imageBase64 obrigatorio.' }) };
  }

  try {
    var result = await callAnthropic(apiKey, imageBase64);

    if (result.status >= 400) {
      return {
        statusCode: result.status, headers: CORS,
        body: JSON.stringify({ error: (result.body && result.body.error && result.body.error.message) || 'Erro Anthropic ' + result.status })
      };
    }

    var text = '';
    var content = (result.body && result.body.content) || [];
    for (var i = 0; i < content.length; i++) {
      if (content[i].type === 'text') { text = content[i].text; break; }
    }

    var start = text.indexOf('{');
    var end   = text.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'IA nao retornou JSON', raw: text.slice(0,100) }) };
    }

    var analysis = JSON.parse(text.slice(start, end + 1));
    return { statusCode: 200, headers: CORS, body: JSON.stringify(analysis) };

  } catch(err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Erro: ' + err.message }) };
  }
};
