export interface Env {
  N8N_WEBHOOK_URL: string;        // Secret in Cloudflare Pages
  CLIENT_AUTH_KV: KVNamespace;    // KV-Binding: key = client_api_id, value = { api_key }
}

// einfache Origin-Whitelist (kannst du bei Bedarf erweitern)
const ALLOWED_ORIGINS = new Set<string>([
  'https://pages.endora.io',
  'https://cloud.endora.io',
]);

// Rate-Limiter-Konfiguration
const RATE_LIMIT_WINDOW_SECONDS = 60; // Zeitfenster
const RATE_LIMIT_MAX_REQUESTS = 60;   // max. Requests pro Client im Zeitfenster

async function isRateLimited(env: Env, clientApiId: string): Promise<boolean> {
  const key = `rate:${clientApiId}`;

  const currentStr = await env.CLIENT_AUTH_KV.get(key);
  const current = currentStr ? parseInt(currentStr, 10) || 0 : 0;

  if (current >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  // Counter + TTL setzen
  await env.CLIENT_AUTH_KV.put(key, String(current + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  });

  return false;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const url = new URL(request.url);

  // 1) Origin check (optional, aber empfohlen)
  const origin = request.headers.get('origin') || '';
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(
      JSON.stringify({ error: 'Origin not allowed' }),
      {
        status: 403,
        headers: { 'content-type': 'application/json' },
      },
    );
  }

  // 2) client_api_id aus Query oder Header holen
  const clientApiId =
    url.searchParams.get('client') ||
    request.headers.get('x-client-id') ||
    '';

  if (!clientApiId) {
    return new Response(
      JSON.stringify({ error: 'Missing client identifier' }),
      {
        status: 400,
        headers: { 'content-type': 'application/json' },
      },
    );
  }

  // 3) Rate-Limiter
  if (await isRateLimited(env, clientApiId)) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded' }),
      {
        status: 429,
        headers: { 'content-type': 'application/json' },
      },
    );
  }

  // 4) api_key aus KV holen
  const kvEntry = await env.CLIENT_AUTH_KV.get(clientApiId, { type: 'json' });

  if (!kvEntry || typeof kvEntry !== 'object' || !('api_key' in kvEntry)) {
    return new Response(
      JSON.stringify({ error: 'Unknown client' }),
      {
        status: 401,
        headers: { 'content-type': 'application/json' },
      },
    );
  }

  const apiKey = (kvEntry as { api_key: string }).api_key;

  // 5) Request-Body 1:1 übernehmen
  const body = await request.arrayBuffer();

  // 6) an n8n-Webhook weiterleiten
  const res = await fetch(env.N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'content-type':
        request.headers.get('content-type') || 'application/json',
      'authorization': `Bearer ${apiKey}`,
      'x-client-id': clientApiId,       // geht mit zu n8n
    },
    body,
  });

  // 7) Antwort von n8n normalisieren → immer { reply: "..." } zurückgeben (universell)
  const ct = res.headers.get('content-type') || '';
  const status = res.status;

  // immer erst Text lesen (funktioniert für JSON + Plain Text)
  const raw = await res.text();

  let data: any = null;
  if (ct.includes('application/json')) {
    try { data = JSON.parse(raw); } catch (_) { data = null; }
  } else {
    // trotzdem versuchen (n8n kann JSON ohne sauberen CT schicken)
    try { data = JSON.parse(raw); } catch (_) { data = null; }
  }

  // n8n liefert oft Arrays: [{ output: "..." }] → erstes Element nehmen
  if (Array.isArray(data)) data = data.length ? data[0] : null;

  const reply =
    (data && (data.reply || data.output || data.answer || data.message || data.text)) ||
    (raw && raw.trim() ? raw.trim() : 'Okay, got it.');

  return new Response(
    JSON.stringify({ reply }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
};
