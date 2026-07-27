import { NextRequest, NextResponse } from 'next/server';
import https from 'https';
import http from 'http';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * CCTV image proxy — bypasses CORS / hotlink protection on camera CDNs.
 * Whitelisted domains only to prevent open-proxy abuse.
 */
const ALLOWED_HOSTS = [
  'cdn.skylinewebcams.com',
  'cdn2.skylinewebcams.com',
  's3-eu-west-1.amazonaws.com',
  'voyage.aprr.fr',
  'thb.gov.tw',
];

// THB servers send non-standard HTTP headers that Node's strict parser rejects.
// These need special handling via curl fallback.
const LENIENT_HOSTS = ['thb.gov.tw'];

function isAllowed(hostname: string): boolean {
  return ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h));
}

function needsLenientParsing(hostname: string): boolean {
  return LENIENT_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h));
}

const MAX_REDIRECTS = 3;

/** Standard proxy for well-behaved servers */
function proxyFetch(url: string, referer: string, lenient = false, redirectsLeft = MAX_REDIRECTS): Promise<{ status: number; contentType: string; data: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      reject(new Error('Unsupported protocol'));
      return;
    }
    if (!isAllowed(parsed.hostname.toLowerCase())) {
      reject(new Error('Forbidden domain'));
      return;
    }
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    const options: any = {
      headers: {
        'Accept': 'image/*,*/*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Referer': referer,
      },
      timeout: 12000,
      // Some camera servers emit non-standard headers that Node's strict
      // parser rejects. Relaxing the parser is scoped to those hosts only.
      insecureHTTPParser: lenient,
    };

    const req = mod.get(url, options, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        if (redirectsLeft <= 0) {
          reject(new Error('Too many redirects'));
          return;
        }
        // Re-validate the redirect target: a whitelisted host must not be able
        // to bounce us to an internal address.
        const next = new URL(res.headers.location, url);
        proxyFetch(next.toString(), referer, lenient, redirectsLeft - 1).then(resolve).catch(reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 502,
          contentType: res.headers['content-type'] || 'image/jpeg',
          data: Buffer.concat(chunks),
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/** Lenient fetch for servers with non-standard HTTP headers */
async function curlFetch(url: string): Promise<{ status: number; contentType: string; data: Buffer }> {
  try {
    return await proxyFetch(url, `https://${new URL(url).hostname}/`, true);
  } catch {
    return { status: 502, contentType: 'application/json', data: Buffer.from('{}') };
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  if (!isAllowed(target.hostname.toLowerCase())) {
    return NextResponse.json({ error: 'Forbidden domain: ' + target.hostname }, { status: 403 });
  }

  try {
    let result: { status: number; contentType: string; data: Buffer };

    if (needsLenientParsing(target.hostname.toLowerCase())) {
      // THB and similar servers with non-standard headers
      result = await curlFetch(target.toString());
    } else {
      result = await proxyFetch(target.toString(), `https://${target.hostname}/`);
    }

    if (result.status >= 400) {
      return NextResponse.json({ error: `Upstream ${result.status}` }, { status: result.status });
    }

    return new NextResponse(new Uint8Array(result.data), {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'public, max-age=5, stale-while-revalidate=10',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    console.error('Camera proxy error:', error?.message || error);
    return NextResponse.json({ error: 'Proxy failed: ' + (error?.message || 'unknown') }, { status: 502 });
  }
}
