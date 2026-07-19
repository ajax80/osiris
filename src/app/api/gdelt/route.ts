import { NextResponse } from 'next/server';

/**
 * OSIRIS — GDELT Conflict Events API
 * Fetches global conflict/protest events from GDELT Project
 */

let gdeltCache: { body: any; until: number } | null = null;
const OK_TTL = 600000;
const FAIL_TTL = 120000;

const HEADERS = { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200' };

export async function GET() {
  if (gdeltCache && Date.now() < gdeltCache.until) {
    return NextResponse.json(gdeltCache.body, { headers: HEADERS });
  }

  const cacheAndReturn = (body: any, ttl: number) => {
    gdeltCache = { body, until: Date.now() + ttl };
    return NextResponse.json(body, { headers: HEADERS });
  };

  try {
    const url = 'https://api.gdeltproject.org/api/v2/geo/geo?query=conflict%20OR%20protest%20OR%20military%20OR%20attack&mode=PointData&format=GeoJSON&timespan=24h&maxpoints=500';
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });

    if (!res.ok) {
      return cacheAndReturn({ events: [], total: 0, error: `GDELT unavailable (${res.status})` }, FAIL_TTL);
    }

    const data = await res.json();
    const features = data.features || [];

    const events = features.map((f: any, i: number) => ({
      id: `gdelt-${i}`,
      lat: f.geometry?.coordinates?.[1],
      lng: f.geometry?.coordinates?.[0],
      name: f.properties?.name || 'Unknown Event',
      url: f.properties?.url || '',
      html: f.properties?.html || '',
      shareimage: f.properties?.shareimage || '',
      type: 'conflict',
    })).filter((e: any) => e.lat != null && e.lng != null);

    return cacheAndReturn({ events, total: events.length, timestamp: new Date().toISOString() }, OK_TTL);
  } catch (error) {
    console.error('GDELT fetch error:', error);
    return cacheAndReturn({ events: [], total: 0, error: 'GDELT fetch failed' }, FAIL_TTL);
  }
}
