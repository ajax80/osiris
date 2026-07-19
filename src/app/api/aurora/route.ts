import { NextResponse } from 'next/server';

let cache: any = null;
let cacheAt = 0;
const TTL = 300000;

export async function GET() {
  if (cache && Date.now() - cacheAt < TTL) {
    return NextResponse.json(cache, { headers: { 'Cache-Control': 'public, s-maxage=300' } });
  }
  try {
    const res = await fetch('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return NextResponse.json({ points: [], total: 0 });
    const data = await res.json();
    const points: any[] = [];
    for (const c of data.coordinates || []) {
      const val = c[2];
      if (val < 8) continue;
      points.push({ lng: c[0] > 180 ? c[0] - 360 : c[0], lat: c[1], intensity: val });
    }
    const body = {
      points,
      total: points.length,
      observation: data['Observation Time'],
      forecast: data['Forecast Time'],
    };
    cache = body;
    cacheAt = Date.now();
    return NextResponse.json(body, { headers: { 'Cache-Control': 'public, s-maxage=300' } });
  } catch {
    return NextResponse.json({ points: [], total: 0 });
  }
}
