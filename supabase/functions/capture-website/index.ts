// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const maxSnapshotCharacters = 10_000_000;
const snapshotBucket = 'website-snapshots';

const isBlockedHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.local') ||
    /^127\./.test(normalized) ||
    /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) ||
    /^169\.254\./.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized) ||
    normalized === '::1'
  );
};

const validateUrl = (value: string) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only HTTP and HTTPS websites can be saved.');
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error('Private network addresses cannot be captured.');
  }
  return url;
};

const addDocumentBase = (html: string, pageUrl: string) => {
  const baseTag = `<base href="${pageUrl.replace(/"/g, '&quot;')}">`;
  const snapshotStyle = `<style id="website-cache-snapshot-style">
html, body { display: block !important; visibility: visible !important; opacity: 1 !important; }
body { min-height: 100vh !important; }
[hidden], [aria-hidden="true"] { display: initial !important; }
</style>`;

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (head) => `${head}${baseTag}${snapshotStyle}`);
  }

  return `${baseTag}${snapshotStyle}${html}`;
};

const createReaderSnapshot = (html: string, pageUrl: string) => {
  const article = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/i)?.[0];
  if (!article) return addDocumentBase(html, pageUrl);

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || 'Saved article';
  const baseUrl = pageUrl.replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="en">
  <head>
    <base href="${baseUrl}">
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      html { color-scheme: light; }
      body { max-width: 760px; margin: 0 auto; padding: 28px 20px 72px; color: #172b4d; background: #fff; font: 18px/1.7 Georgia, serif; }
      article, article * { box-sizing: border-box; max-width: 100%; }
      article { display: block !important; visibility: visible !important; opacity: 1 !important; }
      h1, h2, h3, h4 { color: #0f274a; font-family: system-ui, sans-serif; line-height: 1.25; margin: 1.8em 0 0.65em; }
      h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.2em; }
      p, li { overflow-wrap: break-word; } a { color: #1769d1; } img, video, iframe { height: auto; max-width: 100%; } pre { overflow-x: auto; padding: 14px; background: #f1f5fb; border-radius: 6px; } code { font: 0.9em ui-monospace, monospace; } blockquote { margin: 1.2em 0; padding-left: 1em; border-left: 3px solid #2f7df6; }
    </style>
  </head>
  <body>${article}</body>
</html>`;
};

const fetchPdf = async (initialUrl: string) => {
  let url = validateUrl(initialUrl);

  for (let redirectCount = 0; redirectCount < 6; redirectCount += 1) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WebsiteCacheSnapshot/1.0)',
        Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('The PDF link returned an invalid redirect.');
      url = validateUrl(new URL(location, url).href);
      continue;
    }

    if (!response.ok) throw new Error(`The PDF link returned status ${response.status}.`);
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/pdf')) {
      return null;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 20_000_000) throw new Error('The PDF is too large to save as a snapshot.');
    return bytes;
  }

  throw new Error('The PDF link redirected too many times.');
};

const fetchRenderedHtml = async (pageUrl: string) => {
  const token = Deno.env.get('BROWSERLESS_TOKEN');
  if (!token) return null;

  const response = await fetch(
    `https://production-sfo.browserless.io/content?token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: pageUrl,
        gotoOptions: { waitUntil: 'networkidle2', timeout: 45_000 },
        rejectResourceTypes: ['font', 'media'],
      }),
      signal: AbortSignal.timeout(55_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Browser rendering returned status ${response.status}.`);
  }

  const html = await response.text();
  if (!html || html.length > maxSnapshotCharacters) {
    throw new Error('The rendered webpage is too large to save as a snapshot.');
  }

  return html;
};

const fetchHtml = async (initialUrl: string) => {
  let url = validateUrl(initialUrl);

  for (let redirectCount = 0; redirectCount < 6; redirectCount += 1) {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('The website returned an invalid redirect.');
      url = validateUrl(new URL(location, url).href);
      continue;
    }

    if (!response.ok) {
      throw new Error(`The website returned status ${response.status}.`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error('Only HTML webpages can be captured.');
    }

    const html = await response.text();
    if (html.length > maxSnapshotCharacters) {
      throw new Error('The webpage is too large to save as a snapshot.');
    }
    return html.length > 350_000 ? createReaderSnapshot(html, url.href) : addDocumentBase(html, url.href);
  }

  throw new Error('The website redirected too many times.');
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { websiteId, url } = await request.json();
    if (typeof websiteId !== 'string' || typeof url !== 'string') {
      throw new Error('A website ID and URL are required.');
    }

    const snapshotCreatedAt = new Date().toISOString();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const pdf = await fetchPdf(url);
    let error;

    if (!pdf) {
      const rawHtml = await fetchHtml(url);
      let renderedHtml = null;
      try {
        renderedHtml = await fetchRenderedHtml(url);
      } catch (renderError) {
        console.warn(renderError instanceof Error ? renderError.message : 'Browser HTML rendering failed.');
      }
      const snapshotHtml = renderedHtml ? createReaderSnapshot(renderedHtml, url) : rawHtml;
      ({ error } = await supabase
        .from('saved_websites')
        .update({
          snapshot_html: snapshotHtml,
          snapshot_pdf_path: null,
          snapshot_created_at: snapshotCreatedAt,
        })
        .eq('id', websiteId)
        .eq('url', url));
    }

    if (pdf) {
      const snapshotPdfPath = `${websiteId}.pdf`;
      const { error: uploadError } = await supabase.storage.from(snapshotBucket).upload(snapshotPdfPath, pdf, {
        contentType: 'application/pdf',
        upsert: true,
      });
      if (uploadError) throw new Error(`Unable to store PDF: ${uploadError.message}`);
      ({ error } = await supabase
        .from('saved_websites')
        .update({
          snapshot_html: null,
          snapshot_pdf_path: snapshotPdfPath,
          snapshot_created_at: snapshotCreatedAt,
        })
        .eq('id', websiteId)
        .eq('url', url));
    }

    if (error) throw new Error(`Unable to store snapshot: ${error.message}`);

    return Response.json(
      { website: { snapshotCreatedAt } },
      { headers: corsHeaders },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to capture website.';
    return Response.json({ error: message }, { status: 400, headers: corsHeaders });
  }
});