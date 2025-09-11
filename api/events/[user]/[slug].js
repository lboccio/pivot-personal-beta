// Minimal serverless API for event storage
// Backed by Vercel KV (Upstash Redis REST). Configure these env vars in Vercel:
// - KV_REST_API_URL
// - KV_REST_API_TOKEN

export default async function handler(req, res) {
  // Basic CORS for safety; same-origin frontend shouldn't need it
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { user, slug } = req.query || {};
  if (!user || !slug) return res.status(400).json({ error: 'Missing user or slug' });
  const key = `event:${user}/${slug}`;

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  if (!KV_URL || !KV_TOKEN) {
    return res.status(501).json({ error: 'KV not configured' });
  }

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const data = await r.json();
      const val = data?.result;
      if (!val) return res.status(404).json({ error: 'Not found' });
      try {
        const obj = JSON.parse(val);
        return res.status(200).json(obj);
      } catch {
        return res.status(200).json({ raw: val });
      }
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      // Optionally validate payload minimal shape
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = {}; }
      const toStore = JSON.stringify(parsed);
      const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ value: toStore })
      });
      if (!r.ok) {
        const txt = await r.text();
        return res.status(502).json({ error: 'KV set failed', detail: txt });
      }
      return res.status(204).end();
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', message: e?.message || String(e) });
  }
}

