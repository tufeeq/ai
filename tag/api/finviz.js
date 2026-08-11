export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.FINVIZ_TOKEN;
  const template = process.env.FINVIZ_API_URL;
  if (!token) return res.status(503).json({ error: 'FINVIZ_TOKEN is not configured on Vercel' });
  if (!template) return res.status(503).json({ error: 'FINVIZ_API_URL is not configured on Vercel' });

  try {
    const target = template.replaceAll('{TOKEN}', encodeURIComponent(token));
    const upstream = await fetch(target, {
      headers: { 'Accept': 'text/csv,application/json,text/plain;q=0.9,*/*;q=0.8' },
      cache: 'no-store'
    });
    const body = await upstream.text();
    if (!upstream.ok) {
      return res.status(502).json({ error: 'Finviz upstream error', status: upstream.status, detail: body.slice(0, 300) });
    }
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/plain; charset=utf-8');
    return res.status(200).send(body);
  } catch (error) {
    return res.status(502).json({ error: 'Unable to reach Finviz', detail: String(error?.message || error) });
  }
}