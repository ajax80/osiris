import { NextResponse } from 'next/server';

const CITIES: [number, number, string][] = [
  [40.71, -74.0, 'New York'], [34.05, -118.2, 'Los Angeles'], [41.88, -87.6, 'Chicago'], [29.76, -95.4, 'Houston'],
  [33.45, -112.1, 'Phoenix'], [38.9, -77.04, 'Washington'], [47.61, -122.33, 'Seattle'], [37.77, -122.42, 'San Francisco'],
  [25.76, -80.19, 'Miami'], [33.75, -84.39, 'Atlanta'], [42.36, -71.06, 'Boston'], [43.65, -79.38, 'Toronto'],
  [49.28, -123.12, 'Vancouver'], [19.43, -99.13, 'Mexico City'], [45.42, -75.7, 'Ottawa'],
  [51.51, -0.13, 'London'], [48.86, 2.35, 'Paris'], [52.52, 13.4, 'Berlin'], [41.9, 12.5, 'Rome'], [40.42, -3.7, 'Madrid'],
  [55.75, 37.62, 'Moscow'], [50.45, 30.52, 'Kyiv'], [52.23, 21.01, 'Warsaw'], [41.01, 28.98, 'Istanbul'],
  [28.61, 77.21, 'Delhi'], [19.08, 72.88, 'Mumbai'], [23.81, 90.41, 'Dhaka'], [24.86, 67.0, 'Karachi'],
  [39.9, 116.4, 'Beijing'], [31.23, 121.47, 'Shanghai'], [22.32, 114.17, 'Hong Kong'], [35.68, 139.69, 'Tokyo'],
  [37.57, 126.98, 'Seoul'], [1.35, 103.82, 'Singapore'], [13.75, 100.5, 'Bangkok'], [-6.2, 106.85, 'Jakarta'],
  [14.6, 120.98, 'Manila'], [3.14, 101.69, 'Kuala Lumpur'], [10.82, 106.63, 'Ho Chi Minh City'],
  [24.71, 46.68, 'Riyadh'], [25.2, 55.27, 'Dubai'], [35.69, 51.39, 'Tehran'], [30.04, 31.24, 'Cairo'],
  [6.52, 3.37, 'Lagos'], [-26.2, 28.05, 'Johannesburg'], [-1.29, 36.82, 'Nairobi'], [36.75, 3.06, 'Algiers'],
  [-23.55, -46.63, 'Sao Paulo'], [-34.6, -58.38, 'Buenos Aires'], [4.71, -74.07, 'Bogota'], [-12.05, -77.04, 'Lima'],
  [-33.45, -70.67, 'Santiago'], [-33.87, 151.21, 'Sydney'], [-37.81, 144.96, 'Melbourne'], [59.91, 10.75, 'Oslo'],
];

function classify(aqi: number) {
  if (aqi > 300) return { level: 'Hazardous', color: '#8B0000' };
  if (aqi > 200) return { level: 'Very Unhealthy', color: '#8F3F97' };
  if (aqi > 150) return { level: 'Unhealthy', color: '#FF1744' };
  if (aqi > 100) return { level: 'Unhealthy (Sensitive)', color: '#FF9500' };
  if (aqi > 50) return { level: 'Moderate', color: '#FFD700' };
  return { level: 'Good', color: '#00E676' };
}

let cache: any = null;
let cacheAt = 0;
const TTL = 900000;

export async function GET() {
  if (cache && Date.now() - cacheAt < TTL) {
    return NextResponse.json(cache, { headers: { 'Cache-Control': 'public, s-maxage=900' } });
  }
  try {
    const lats = CITIES.map(c => c[0]).join(',');
    const lons = CITIES.map(c => c[1]).join(',');
    const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&current=us_aqi,pm2_5`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return NextResponse.json({ stations: [], total: 0 });
    const data = await res.json();
    const arr = Array.isArray(data) ? data : [data];
    const stations = arr.map((r: any, i: number) => {
      const aqi = r.current?.us_aqi;
      if (aqi == null || !CITIES[i]) return null;
      const { level, color } = classify(aqi);
      return { name: CITIES[i][2], lat: CITIES[i][0], lng: CITIES[i][1], aqi, pm25: r.current?.pm2_5, level, color };
    }).filter(Boolean);
    const body = { stations, total: stations.length, timestamp: new Date().toISOString() };
    cache = body;
    cacheAt = Date.now();
    return NextResponse.json(body, { headers: { 'Cache-Control': 'public, s-maxage=900' } });
  } catch {
    return NextResponse.json({ stations: [], total: 0 });
  }
}
