import { NextResponse } from 'next/server';

let cache: any = null;
let cacheAt = 0;
const TTL = 86400000;

export async function GET() {
  if (cache && Date.now() - cacheAt < TTL) {
    return NextResponse.json(cache, { headers: { 'Cache-Control': 'public, s-maxage=86400' } });
  }
  try {
    const res = await fetch('https://www.submarinecablemap.com/api/v3/cable/cable-geo.json', {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'OSIRIS/1.0' },
    });
    if (!res.ok) return NextResponse.json({ type: 'FeatureCollection', features: [] });
    const data = await res.json();
    cache = data;
    cacheAt = Date.now();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=86400' } });
  } catch {
    return NextResponse.json({ type: 'FeatureCollection', features: [] });
  }
}
