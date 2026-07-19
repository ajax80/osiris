import { NextResponse } from 'next/server';

/**
 * OSIRIS — Flight Data API
 * Fetches real-time aircraft positions from adsb.lol (no API key required)
 * Covers 6 global regions for maximum coverage
 */

// adsb.fi caps the radius at 250 nm, so coverage is a grid of hub cells
const ADSB_DIST = 250;
const REGIONS = [
  // United States
  { lat: 40.7, lon: -74.0 },   // New York
  { lat: 38.9, lon: -77.0 },   // Washington DC
  { lat: 33.7, lon: -84.4 },   // Atlanta
  { lat: 25.8, lon: -80.3 },   // Miami
  { lat: 41.9, lon: -87.6 },   // Chicago
  { lat: 39.3, lon: -94.7 },   // Kansas City
  { lat: 32.8, lon: -97.0 },   // Dallas
  { lat: 29.8, lon: -95.4 },   // Houston
  { lat: 39.7, lon: -104.9 },  // Denver
  { lat: 33.4, lon: -112.1 },  // Phoenix
  { lat: 34.0, lon: -118.2 },  // Los Angeles
  { lat: 37.6, lon: -122.4 },  // San Francisco
  { lat: 47.5, lon: -122.3 },  // Seattle
  // Canada / Mexico
  { lat: 43.7, lon: -79.4 },   // Toronto
  { lat: 19.4, lon: -99.1 },   // Mexico City
  // Europe
  { lat: 51.5, lon: -0.1 },    // London
  { lat: 50.0, lon: 8.6 },     // Frankfurt
  { lat: 40.4, lon: -3.7 },    // Madrid
  { lat: 41.0, lon: 28.9 },    // Istanbul
  // Middle East / Asia / Oceania
  { lat: 25.3, lon: 55.4 },    // Dubai
  { lat: 1.4, lon: 103.9 },    // Singapore
  { lat: 35.6, lon: 139.8 },   // Tokyo
  { lat: -33.9, lon: 151.2 },  // Sydney
  // South America / Africa
  { lat: -23.5, lon: -46.6 },  // Sao Paulo
  { lat: -26.1, lon: 28.2 },   // Johannesburg
];

// Helicopter type codes
const HELI_TYPES = new Set([
  'R22','R44','R66','B06','B06T','B204','B205','B206','B212','B222','B230',
  'B407','B412','B427','B429','B430','B505','B525',
  'AS32','AS35','AS50','AS55','AS65',
  'EC20','EC25','EC30','EC35','EC45','EC55','EC75',
  'H125','H130','H135','H145','H155','H160','H175','H215','H225',
  'S55','S58','S61','S64','S70','S76','S92',
  'A109','A119','A139','A169','A189','AW09',
  'MD52','MD60','MDHI','MD90','NOTR',
  'B47G','HUEY','GAMA','CABR','EXE',
]);

// Private jet types
const PRIVATE_JET_TYPES = new Set([
  'G150','G200','G280','GLEX','G500','G550','G600','G650','G700',
  'GLF2','GLF3','GLF4','GLF5','GLF6','GL5T','GL7T','GV','GIV',
  'CL30','CL35','CL60','BD70','BD10',
  'C25A','C25B','C25C','C500','C510','C525','C550','C560','C56X','C680','C700','C750',
  'E35L','E50P','E55P','E545','E550',
  'FA50','FA7X','FA8X','F900','F2TH',
  'LJ35','LJ40','LJ45','LJ60','LJ70','LJ75',
  'PC12','PC24','TBM7','TBM8','TBM9',
  'PRM1','SF50','EA50','VLJ',
]);

// Military type indicators
const MILITARY_INDICATORS = new Set([
  'C17','C5M','C130','C30J','KC10','KC46','KC35','E3CF','E3TF','E8A',
  'B1B','B2','B52','F16','F15','F18','F22','F35','A10','F117',
  'RC135','E6B','P8A','P3','MQ9','RQ4','U2','EP3','RC12',
  'V22','CH47','UH60','AH64','AH1Z','MV22',
  'EUFI','RFAL','TORD','TYP','GR4',
]);

const AIRLINE_CODE_RE = /^([A-Z]{3})\d/;

async function fetchRegion(region: typeof REGIONS[0]): Promise<any[]> {
  try {
    const url = `https://opendata.adsb.fi/api/v2/lat/${region.lat}/lon/${region.lon}/dist/${ADSB_DIST}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(9000),
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      return data.aircraft || [];
    }
  } catch (e) {
    console.warn(`Region fetch failed for lat=${region.lat}:`, e);
  }
  return [];
}

// adsb.fi sits behind Cloudflare, which rejects large concurrent bursts —
// fetch the grid in small batches instead of all at once
async function fetchAllRegions(): Promise<any[]> {
  const out: any[] = [];
  const BATCH = 1;
  for (let i = 0; i < REGIONS.length; i += BATCH) {
    const results = await Promise.allSettled(REGIONS.slice(i, i + BATCH).map(fetchRegion));
    for (const r of results) if (r.status === 'fulfilled') out.push(...r.value);
    if (i + BATCH < REGIONS.length) await new Promise(res => setTimeout(res, 150));
  }
  return out;
}

function classifyFlight(f: any) {
  const modelUpper = (f.t || '').toUpperCase();
  const flightStr = (f.flight || '').trim().toUpperCase();
  const dbFlags = (f.dbFlags || 0);

  // Skip fixed structures
  if (modelUpper === 'TWR') return null;

  const lat = f.lat;
  const lon = f.lon;
  if (lat == null || lon == null) return null;

  const callsign = flightStr || f.hex || 'UNKNOWN';
  const altRaw = f.alt_baro;
  const altMeters = typeof altRaw === 'number' ? altRaw * 0.3048 : 0;
  const speedKnots = typeof f.gs === 'number' ? Math.round(f.gs * 10) / 10 : null;
  const heading = f.track || 0;
  const isHeli = HELI_TYPES.has(modelUpper);
  const isGrounded = typeof altRaw === 'number' && altRaw < 100;

  // Extract airline code
  const airlineMatch = AIRLINE_CODE_RE.exec(callsign);
  const airlineCode = airlineMatch ? airlineMatch[1] : '';

  // Classification
  let category: 'commercial' | 'private' | 'jet' | 'military' = 'commercial';
  if (dbFlags & 1 || MILITARY_INDICATORS.has(modelUpper) || (f.flight || '').match(/^(RCH|KING|DUKE|EVAC|JAKE|REACH|CONVOY)\d/i)) {
    category = 'military';
  } else if (PRIVATE_JET_TYPES.has(modelUpper)) {
    category = 'jet';
  } else if (!airlineCode && modelUpper && !['A319','A320','A321','A332','A333','A339','A343','A359','A388','B737','B738','B739','B38M','B39M','B752','B753','B763','B764','B772','B77L','B77W','B788','B789','B78X','E170','E175','E190','E195','CRJ7','CRJ9','AT43','AT72','DH8D'].includes(modelUpper)) {
    category = 'private';
  }

  return {
    callsign,
    lat: Math.round(lat * 100000) / 100000,
    lng: Math.round(lon * 100000) / 100000,
    alt: Math.round(altMeters),
    heading: Math.round(heading),
    speed_knots: speedKnots,
    model: f.t || 'Unknown',
    icao24: f.hex || '',
    registration: f.r || 'N/A',
    squawk: f.squawk || '',
    airline_code: airlineCode,
    aircraft_category: isHeli ? 'heli' : 'plane',
    category,
    grounded: isGrounded,
    nac_p: f.nac_p,
    type: 'flight',
  };
}

// In-memory cache to prevent global fan-out abuse
let cachedData: any = null;
let lastFetchTime = 0;
const CACHE_TTL = 45000; // 45 seconds cache window
let fetchPromise: Promise<any> | null = null;

export async function GET() {
  const now = Date.now();

  // Return cached data if within TTL
  if (cachedData && now - lastFetchTime < CACHE_TTL) {
    return NextResponse.json(cachedData, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    });
  }

  // Coalesce concurrent requests: wait for the active fetch rather than starting a new one
  if (fetchPromise) {
    try {
      const data = await fetchPromise;
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
      });
    } catch {
      // Fallback to error if the pending fetch failed
      return NextResponse.json({ error: 'Failed to fetch flight data' }, { status: 500 });
    }
  }

  // Start new global fetch
  fetchPromise = (async () => {
    const regionAircraft = await fetchAllRegions();

    const allRaw: any[] = [];
    const seenHex = new Set<string>();

    for (const ac of regionAircraft) {
      const hex = (ac.hex || '').toLowerCase().trim();
      if (hex && !seenHex.has(hex)) {
        seenHex.add(hex);
        allRaw.push(ac);
      }
    }

    // Classify all flights
    const commercial: any[] = [];
    const privateFl: any[] = [];
    const jets: any[] = [];
    const military: any[] = [];
    const gpsJamming: any[] = [];

    for (const raw of allRaw) {
      const flight = classifyFlight(raw);
      if (!flight) continue;

      // GPS jamming detection
      if (typeof flight.nac_p === 'number' && flight.nac_p <= 4 && !flight.grounded && flight.alt > 3000) {
        gpsJamming.push({
          lat: flight.lat,
          lng: flight.lng,
          nac_p: flight.nac_p,
          callsign: flight.callsign,
        });
      }

      switch (flight.category) {
        case 'military': military.push(flight); break;
        case 'jet': jets.push(flight); break;
        case 'private': privateFl.push(flight); break;
        default: commercial.push(flight);
      }
    }

    // Aggregate GPS jamming zones (grid-based)
    const jammingZones = aggregateJamming(gpsJamming);

    return {
      commercial_flights: commercial,
      private_flights: privateFl,
      private_jets: jets,
      military_flights: military,
      gps_jamming: jammingZones,
      total: allRaw.length,
      timestamp: new Date().toISOString(),
    };
  })();

  try {
    const data = await fetchPromise;
    cachedData = data;
    lastFetchTime = Date.now();
    fetchPromise = null;

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('Flight fetch error:', error);
    fetchPromise = null;
    return NextResponse.json(
      { error: 'Failed to fetch flight data' },
      { status: 500 }
    );
  }
}

function aggregateJamming(points: any[]) {
  if (points.length === 0) return [];
  const grid = new Map<string, { lat: number; lng: number; count: number; total_nac_p: number }>();
  const GRID_SIZE = 2; // degrees

  for (const p of points) {
    const gLat = Math.floor(p.lat / GRID_SIZE) * GRID_SIZE;
    const gLng = Math.floor(p.lng / GRID_SIZE) * GRID_SIZE;
    const key = `${gLat},${gLng}`;

    if (!grid.has(key)) {
      grid.set(key, { lat: gLat + GRID_SIZE / 2, lng: gLng + GRID_SIZE / 2, count: 0, total_nac_p: 0 });
    }
    const cell = grid.get(key)!;
    cell.count++;
    cell.total_nac_p += p.nac_p;
  }

  return Array.from(grid.values())
    .filter(z => z.count >= 3) // Minimum 3 aircraft with degraded NACp
    .map(z => ({
      lat: z.lat,
      lng: z.lng,
      severity: Math.round((1 - (z.total_nac_p / z.count) / 11) * 100),
      count: z.count,
    }));
}
