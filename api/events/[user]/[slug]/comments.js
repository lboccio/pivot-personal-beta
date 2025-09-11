// Comments API for an event
// Stores comments in Vercel KV (Upstash Redis REST) under key: chat:<user>/<slug>

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { user, slug } = req.query || {};
  if (!user || !slug) return res.status(400).json({ error: 'Missing user or slug' });
  const key = `chat:${user}/${slug}`;

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  if (!KV_URL || !KV_TOKEN) {
    return res.status(501).json({ error: 'KV not configured' });
  }

  async function kvGetArray() {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    if (!r.ok) return [];
    const data = await r.json();
    const raw = data?.result;
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  async function kvSetArray(arr) {
    const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ value: JSON.stringify(arr) })
    });
    if (!r.ok) {
      try {
        const text = await r.text();
        return { ok: false, detail: text };
      } catch {
        return { ok: false };
      }
    }
    return { ok: true };
  }

  try {
    if (req.method === 'GET') {
      const comments = await kvGetArray();
      // Return only the most recent 200 to bound payload
      const recent = comments.slice(-200);
      return res.status(200).json({ comments: recent });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
      const auth = (req.headers['authorization'] || '').trim();
      let authedUser = null;
      if (auth.toLowerCase().startsWith('bearer ')) {
        const token = auth.slice(7).trim();
        authedUser = await verifyGoogleIdToken(token);
      }
      let name = (body.name || '').toString().trim().slice(0, 64);
      let text = (body.text || '').toString().trim().slice(0, 1000);
      if (!text) return res.status(400).json({ error: 'Text required' });
      if (authedUser?.name) name = authedUser.name;
      if (!name) name = 'guest';
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2, 8);
      const ts = Date.now();
      const mentions = Array.from(new Set((text.match(/(^|\s)@([a-z0-9_\-]+)/ig) || []).map(m => m.trim().replace(/^@/, '').toLowerCase())));
      const comment = { id, ts, name, text, mentions };
      if (authedUser) {
        comment.user = { id: authedUser.sub, email: authedUser.email, name: authedUser.name, picture: authedUser.picture };
      }

      // Naive append with read-modify-write
      const arr = await kvGetArray();
      arr.push(comment);
      // Trim to last 500 comments to bound storage
      const trimmed = arr.slice(-500);
import { verifyGoogleIdToken } from '../../../_lib/verifyGoogle';
      const result = await kvSetArray(trimmed);
      if (!result.ok) return res.status(502).json({ error: 'KV set failed', message: result.detail || undefined });
      return res.status(201).json({ comment });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', message: e?.message || String(e) });
  }
}
