import { NextResponse } from 'next/server';

let centroids: Record<string, [number, number]> | null = null;
let cache: any = null;
let cacheAt = 0;
const TTL = 600000;

async function getCentroids() {
  if (centroids) return centroids;
  try {
    const res = await fetch('https://raw.githubusercontent.com/gavinr/world-countries-centroids/master/dist/countries.geojson', {
      signal: AbortSignal.timeout(12000),
    });
    const data = await res.json();
    const map: Record<string, [number, number]> = {};
    for (const f of data.features || []) {
      const iso = f.properties?.ISO;
      if (iso) map[iso] = f.geometry.coordinates;
    }
    centroids = map;
  } catch {
    centroids = {};
  }
  return centroids;
}

export async function GET() {
  if (cache && Date.now() - cacheAt < TTL) {
    return NextResponse.json(cache, { headers: { 'Cache-Control': 'public, s-maxage=600' } });
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 4 * 3600;
    const cen = await getCentroids();
    const res = await fetch(`https://api.ioda.inetintel.cc.gatech.edu/v2/outages/summary?from=${from}&until=${now}&entityType=country&limit=100&orderByAbs=true`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return NextResponse.json({ outages: [], total: 0 });
    const data = await res.json();
    const outages: any[] = [];
    for (const d of data.data || []) {
      const iso = d.entity?.code;
      const c = iso && cen[iso];
      if (!c) continue;
      outages.push({
        code: iso,
        name: d.entity?.name || iso,
        lat: c[1],
        lng: c[0],
        score: Math.round(d.scores?.overall || 0),
        events: d.event_cnt || 0,
      });
    }
    const body = { outages, total: outages.length, timestamp: new Date().toISOString() };
    cache = body;
    cacheAt = Date.now();
    return NextResponse.json(body, { headers: { 'Cache-Control': 'public, s-maxage=600' } });
  } catch {
    return NextResponse.json({ outages: [], total: 0 });
  }
}
