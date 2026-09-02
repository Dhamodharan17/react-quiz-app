// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const maxSnapshotCharacters = 2_000_000;

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

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (head) => `${head}${baseTag}`);
  }

  return `${baseTag}${html}`;
};

const fetchHtml = async (initialUrl: string) => {
  let url = validateUrl(initialUrl);

  for (let redirectCount = 0; redirectCount < 6; redirectCount += 1) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'WebsiteCacheSnapshot/1.0',
        Accept: 'text/html,application/xhtml+xml',
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
    return addDocumentBase(html, url.href);
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

    const snapshotHtml = await fetchHtml(url);
    const snapshotCreatedAt = new Date().toISOString();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { error } = await supabase
      .from('saved_websites')
      .update({ snapshot_html: snapshotHtml, snapshot_created_at: snapshotCreatedAt })
      .eq('id', websiteId)
      .eq('url', url);

    if (error) throw new Error(`Unable to store snapshot: ${error.message}`);

    return Response.json(
      { website: { snapshotHtml, snapshotCreatedAt } },
      { headers: corsHeaders },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to capture website.';
    return Response.json({ error: message }, { status: 400, headers: corsHeaders });
  }
});