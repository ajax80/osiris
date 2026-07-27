import { NextResponse } from 'next/server';
import { fetchAsfinagCameras } from './asfinag';
import { fetchAustraliaCameras } from './australia';
import { fetchBulgariaCameras } from './bulgaria';
import { fetchCzechiaCameras } from './czechia';
import { fetchFinlandCameras } from './finland';
import { fetchFranceCameras } from './france';
import { fetchGermanyCameras } from './germany';
import { fetchGreeceCameras } from './greece';
import { fetchHongKongCameras } from './hongkong';
import { fetchIcelandCameras } from './iceland';
import { fetchItalyCameras } from './italy';
import { fetchJapanCameras } from './japan';
import { fetchMacedoniaCameras } from './macedonia';
import { fetchPolandCameras } from './poland';
import { fetchRomaniaCameras } from './romania';
import { fetchSerbiaCameras } from './serbia';
import { fetchSlovakiaCameras } from './slovakia';
import { fetchSpainCameras } from './spain';
import { fetchSwitzerlandCameras } from './switzerland';
import { fetchTaiwanCameras } from './taiwan';
import { fetchTurkeyCameras } from './turkey';
import { fetchUtahCameras } from './utah';

/**
 * OSIRIS — Worldwide CCTV Camera API v2
 * Viewport-aware: pass ?region=xx to load cameras for specific regions
 * Supports: uk, us-east, us-west, us-central, canada, europe, asia
 * Or pass ?lat=x&lng=y&radius=5 for proximity-based loading
 */

// ═══ CAMERA SOURCE DEFINITIONS ═══

// ── UK: Transport for London JamCams (~900) ──
async function fetchTfLCameras(): Promise<any[]> {
  try {
    const res = await fetch('https://api.tfl.gov.uk/Place/Type/JamCam', { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data || []).map((cam: any) => {
      const imgProp = cam.additionalProperties?.find((p: any) => p.key === 'imageUrl');
      const camId = cam.id?.replace('JamCams_', '') || '';
      return {
        id: `tfl-${cam.id}`, lat: cam.lat, lng: cam.lon,
        name: cam.commonName || 'London JamCam', city: 'London', country: 'UK',
        feed_url: imgProp?.value || `https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/${camId}.jpg`,
        source: 'TfL',
      };
    }).filter((c: any) => c.lat && c.lng);
  } catch { return []; }
}

// ── US-WEST: WSDOT Washington State (~500) ──
async function fetchWSDOTCameras(): Promise<any[]> {
  const key = process.env.WSDOT_KEY;
  if (!key) return [];
  try {
    const res = await fetch(`https://www.wsdot.wa.gov/Traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson?AccessCode=${key}`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data || []).filter((c: any) => c.IsActive && c.ImageURL).map((cam: any) => ({
      id: `wsdot-${cam.CameraID}`, lat: cam.CameraLocation?.Latitude, lng: cam.CameraLocation?.Longitude,
      name: cam.Title || 'WSDOT Camera', city: cam.CameraLocation?.RoadName || 'Washington', country: 'US',
      feed_url: cam.ImageURL, source: 'WSDOT',
    })).filter((c: any) => c.lat && c.lng);
  } catch { return []; }
}

// ── US-WEST: Caltrans California Districts ──
async function fetchCaltransCameras(): Promise<any[]> {
  const allCams: any[] = [];
  const districts = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10', 'd11', 'd12'];
  for (const dist of districts) {
    try {
      const res = await fetch(`https://cwwp2.dot.ca.gov/data/${dist}/cctv/cctvStatus${dist.toUpperCase()}.json`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      for (const item of (data?.data || [])) {
        const c = item.cctv;
        if (!c || c.inService !== 'true') continue;
        const lat = parseFloat(c.location?.latitude);
        const lng = parseFloat(c.location?.longitude);
        const url = c.imageData?.static?.currentImageURL;
        if (!lat || !lng || !url) continue;
        allCams.push({ id: `cal-${allCams.length}`, lat, lng, name: c.location?.locationName || 'Caltrans', city: c.location?.nearbyPlace || 'California', country: 'US', feed_url: url, source: 'Caltrans' });
      }
    } catch { /* silent */ }
  }
  return allCams;
}

// ── CANADA: Ottawa, Toronto, Montreal ──
async function fetchCanadaCameras(): Promise<any[]> {
  const cams: any[] = [];
  
  // Ottawa MTO Highway Cameras
  try {
    const res = await fetch('https://511on.ca/api/v2/get/cameras', { signal: AbortSignal.timeout(10000), headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      for (const cam of (data || [])) {
        if (!cam.latitude || !cam.longitude) continue;
        cams.push({
          id: `on-${cam.id || cams.length}`, lat: cam.latitude, lng: cam.longitude,
          name: cam.description || cam.name || 'Ontario Camera', city: 'Ontario', country: 'Canada',
          feed_url: cam.imageUrl || cam.url || '', source: '511 Ontario',
        });
      }
    }
  } catch { /* silent */ }

  // Ville de Montréal cameras
  try {
    const res = await fetch('https://ville.montreal.qc.ca/circulation/sites/ville.montreal.qc.ca.circulation/files/cameras.json', { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      for (const cam of (data || [])) {
        cams.push({
          id: `mtl-${cams.length}`, lat: cam.latitude || cam.lat, lng: cam.longitude || cam.lng,
          name: cam.description || cam.name || 'Montréal Camera', city: 'Montréal', country: 'Canada',
          feed_url: cam.url || cam.imageUrl || '', source: 'Ville MTL',
        });
      }
    }
  } catch { /* silent */ }

  // Curated Ottawa/Toronto cameras from known public feeds
  const curated = [
    { id: 'ott-1', lat: 45.4215, lng: -75.6972, name: 'Parliament Hill / Wellington', city: 'Ottawa', country: 'Canada', feed_url: 'https://traffic.ottawa.ca/map/camera?id=1', source: 'Ottawa' },
    { id: 'ott-2', lat: 45.4231, lng: -75.6831, name: 'Rideau / Sussex', city: 'Ottawa', country: 'Canada', feed_url: 'https://traffic.ottawa.ca/map/camera?id=2', source: 'Ottawa' },
    { id: 'ott-3', lat: 45.4195, lng: -75.7009, name: 'Bank / Sparks', city: 'Ottawa', country: 'Canada', feed_url: 'https://traffic.ottawa.ca/map/camera?id=3', source: 'Ottawa' },
    { id: 'ott-4', lat: 45.4249, lng: -75.6950, name: 'King Edward / Rideau', city: 'Ottawa', country: 'Canada', feed_url: 'https://traffic.ottawa.ca/map/camera?id=4', source: 'Ottawa' },
    { id: 'ott-5', lat: 45.3968, lng: -75.7398, name: 'Merivale / Baseline', city: 'Ottawa', country: 'Canada', feed_url: 'https://traffic.ottawa.ca/map/camera?id=5', source: 'Ottawa' },
    { id: 'ott-6', lat: 45.3484, lng: -75.7580, name: 'Fallowfield / Woodroffe', city: 'Ottawa', country: 'Canada', feed_url: 'https://traffic.ottawa.ca/map/camera?id=6', source: 'Ottawa' },
    { id: 'ott-7', lat: 45.4012, lng: -75.6518, name: 'Hwy 417 / Vanier Pkwy', city: 'Ottawa', country: 'Canada', feed_url: 'https://traffic.ottawa.ca/map/camera?id=7', source: 'Ottawa' },
    { id: 'ott-8', lat: 45.4475, lng: -75.4822, name: 'Innes / Orleans Blvd', city: 'Ottawa', country: 'Canada', feed_url: 'https://traffic.ottawa.ca/map/camera?id=8', source: 'Ottawa' },
    { id: 'tor-1', lat: 43.6532, lng: -79.3832, name: 'Yonge / Dundas Square', city: 'Toronto', country: 'Canada', feed_url: 'https://511on.ca/api/v2/get/cameras', source: '511 Ontario' },
    { id: 'tor-2', lat: 43.6426, lng: -79.3871, name: 'CN Tower / Lakeshore', city: 'Toronto', country: 'Canada', feed_url: 'https://511on.ca/api/v2/get/cameras', source: '511 Ontario' },
    { id: 'tor-3', lat: 43.6711, lng: -79.3868, name: 'Bloor / Yonge', city: 'Toronto', country: 'Canada', feed_url: 'https://511on.ca/api/v2/get/cameras', source: '511 Ontario' },
  ];
  cams.push(...curated);

  // Alberta 511
  try {
    const res = await fetch('https://511.alberta.ca/api/v2/get/cameras', { signal: AbortSignal.timeout(10000), headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      for (const cam of (data || [])) {
        if (!cam.Latitude || !cam.Longitude || !cam.Views?.[0]?.Url) continue;
        cams.push({
          id: `ab-${cam.Id || cams.length}`, lat: cam.Latitude, lng: cam.Longitude,
          name: cam.Location || 'Alberta Camera', city: 'Alberta', country: 'Canada',
          feed_url: cam.Views[0].Url, source: 'Alberta 511',
        });
      }
    }
  } catch { /* silent */ }

  return cams.filter((c: any) => c.lat && c.lng);
}

// ── US-CENTRAL: Chicago, Houston, Dallas, Denver ──
async function fetchUSCentralCameras(): Promise<any[]> {
  const cams: any[] = [];
  // Illinois DOT
  try {
    const res = await fetch('https://www.travelmidwest.com/lmiga/cameraReport.json', { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      for (const cam of (data?.cameraReports || data || []).slice(0, 800)) {
        if (!cam.latitude || !cam.longitude) continue;
        cams.push({
          id: `ildot-${cams.length}`, lat: cam.latitude, lng: cam.longitude,
          name: cam.cameraName || cam.description || 'IDOT Camera', city: 'Illinois', country: 'US',
          feed_url: cam.imageUrl || cam.url || '', source: 'IDOT',
        });
      }
    }
  } catch { /* silent */ }

  return cams.filter((c: any) => c.lat && c.lng);
}

// ── US-EAST: NYC, DC, Florida, Georgia ──
async function fetchUSEastCameras(): Promise<any[]> {
  const cams: any[] = [];
  // NYC DOT — direct (allorigins proxy is dead)
  try {
    const res = await fetch('https://webcams.nyctmc.org/api/cameras', { signal: AbortSignal.timeout(10000), headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      for (const cam of (Array.isArray(data) ? data : []).slice(0, 1000)) {
        if (!cam.latitude || !cam.longitude) continue;
        cams.push({
          id: `nyc-${cam.id || cams.length}`, lat: cam.latitude, lng: cam.longitude,
          name: cam.name || 'NYC Camera', city: cam.area || 'New York', country: 'US',
          feed_url: cam.imageUrl || `https://webcams.nyctmc.org/api/cameras/${cam.id}/image`, source: 'NYC DOT',
        });
      }
    }
  } catch (e) {
    console.error('NYC cameras fetch error:', e);
  }

  // Florida 511
  try {
    const res = await fetch('https://fl511.com/api/v2/cameras', { signal: AbortSignal.timeout(8000), headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      for (const cam of (data || []).slice(0, 800)) {
        if (!cam.latitude || !cam.longitude) continue;
        cams.push({
          id: `fl-${cams.length}`, lat: cam.latitude, lng: cam.longitude,
          name: cam.description || 'FL-511 Camera', city: 'Florida', country: 'US',
          feed_url: cam.imageUrl || '', source: 'FL-511',
        });
      }
    }
  } catch { /* silent */ }

  // Georgia 511 (GDOT)
  const gaKey = process.env.GA511_KEY;
  if (gaKey) {
    try {
      const res = await fetch(`https://511ga.org/api/v2/get/cameras?key=${gaKey}&format=json`, { signal: AbortSignal.timeout(10000), headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        for (const cam of (data || [])) {
          const view = cam.Views?.find((v: any) => v.Status === 'Enabled');
          if (!cam.Latitude || !cam.Longitude || !view?.Url) continue;
          cams.push({
            id: `ga-${cam.Id || cams.length}`, lat: cam.Latitude, lng: cam.Longitude,
            name: cam.Location || 'GDOT Camera', city: 'Georgia', country: 'US',
            feed_url: view.Url, source: 'GA-511',
          });
        }
      }
    } catch { /* silent */ }
  }

  return cams.filter((c: any) => c.lat && c.lng);
}

// ── EUROPE: Netherlands, Germany, France ──
async function fetchEuropeCameras(): Promise<any[]> {
  const cams: any[] = [];
  
  // Netherlands Rijkswaterstaat
  try {
    const res = await fetch('https://opendata.ndw.nu/cameras.json', { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      for (const cam of (data || []).slice(0, 1000)) {
        if (!cam.lat || !cam.lng) continue;
        cams.push({
          id: `nl-${cams.length}`, lat: cam.lat, lng: cam.lng,
          name: cam.name || 'NL Camera', city: 'Netherlands', country: 'NL',
          feed_url: cam.imageUrl || '', source: 'RWS',
        });
      }
    }
  } catch { /* silent */ }

  cams.push(...await fetchAsfinagCameras());

  return cams.filter((c: any) => c.lat && c.lng);
}

// ── ASIA/PACIFIC ──
async function fetchAsiaCameras(): Promise<any[]> {
  const cams: any[] = [];
  
  // Singapore Live Traffic Images
  try {
    const res = await fetch('https://api.data.gov.sg/v1/transport/traffic-images', { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json();
      const items = data.items?.[0]?.cameras || [];
      for (const cam of items) {
        if (!cam.location?.latitude || !cam.location?.longitude || !cam.image) continue;
        cams.push({
          id: `sin-${cam.camera_id}`,
          lat: cam.location.latitude,
          lng: cam.location.longitude,
          name: `Camera ${cam.camera_id}`,
          city: 'Singapore',
          country: 'Singapore',
          feed_url: cam.image,
          source: 'LTA Singapore'
        });
      }
    }
  } catch { /* silent */ }

  return cams;
}

// ═══ REGION MAPPING ═══
const REGION_FETCHERS: Record<string, () => Promise<any[]>> = {
  'uk': fetchTfLCameras,
  'us-west': async () => [...await fetchWSDOTCameras(), ...await fetchCaltransCameras()],
  'us-east': fetchUSEastCameras,
  'us-central': fetchUSCentralCameras,
  'canada': fetchCanadaCameras,
  'europe': fetchEuropeCameras,
  'asia': fetchAsiaCameras,
  'utah': fetchUtahCameras,
  'bulgaria': fetchBulgariaCameras,
  'greece': fetchGreeceCameras,
  'serbia': fetchSerbiaCameras,
  'macedonia': fetchMacedoniaCameras,
  'turkey': fetchTurkeyCameras,
  'romania': fetchRomaniaCameras,
  'italy': fetchItalyCameras,
  'czechia': fetchCzechiaCameras,
  'slovakia': fetchSlovakiaCameras,
  'germany': fetchGermanyCameras,
  'france': fetchFranceCameras,
  'spain': fetchSpainCameras,
  'poland': fetchPolandCameras,
  'finland': fetchFinlandCameras,
  'iceland': fetchIcelandCameras,
  'switzerland': fetchSwitzerlandCameras,
  'australia': fetchAustraliaCameras,
  'taiwan': fetchTaiwanCameras,
  'japan': fetchJapanCameras,
  'hongkong': fetchHongKongCameras,
};

// Determine which regions to fetch based on viewport bounds
function getRegionsForBounds(lat: number, lng: number, radius: number): string[] {
  const regions: string[] = [];
  // UK
  if (lat > 49 && lat < 61 && lng > -8 && lng < 2) regions.push('uk');
  // US-East
  if (lat > 24 && lat < 49 && lng > -85 && lng < -66) regions.push('us-east');
  // US-West
  if (lat > 24 && lat < 49 && lng > -125 && lng < -100) regions.push('us-west');
  // US-Central
  if (lat > 24 && lat < 49 && lng > -105 && lng < -80) regions.push('us-central');
  // Utah (UDOT) — explicit, since us-west only covers WA + CA
  if (lat > 36.9 && lat < 42.1 && lng > -114.2 && lng < -108.9) regions.push('utah');
  // Canada
  if (lat > 42 && lat < 70 && lng > -141 && lng < -52) regions.push('canada');

  // Europe — per-country sources take precedence over the generic aggregate
  const inBulgaria = lat > 41 && lat < 44.5 && lng > 22 && lng < 29.5;
  const inGreece = lat > 34.5 && lat < 41.8 && lng > 19 && lng < 30;
  const inSerbia = lat > 42 && lat < 46.5 && lng > 18.8 && lng < 23.3;
  const inMacedonia = lat > 40.8 && lat < 42.8 && lng > 20.4 && lng < 23.2;
  const inRomania = lat > 43.5 && lat < 48.5 && lng > 20 && lng < 29.8;
  const inTurkey = lat > 35.5 && lat < 42.5 && lng > 25.5 && lng < 45;
  const inItaly = lat > 36 && lat < 47.5 && lng > 6.5 && lng < 18.5;
  const inCzechia = lat > 48.5 && lat < 51.1 && lng > 12 && lng < 18.9;
  const inSlovakia = lat > 47.7 && lat < 49.6 && lng > 16.8 && lng < 22.6;
  const inGermany = lat > 47 && lat < 55.1 && lng > 5.8 && lng < 15.1;
  const inFrance = lat > 42.3 && lat < 51.1 && lng > -5 && lng < 8.3;
  const inSpain = lat > 27 && lat < 43.8 && lng > -18.2 && lng < 4.4;
  const inPoland = lat > 49.0 && lat < 55.0 && lng > 14.1 && lng < 24.1;
  const inFinland = lat > 59.5 && lat < 70.1 && lng > 20 && lng < 31.6;
  const inIceland = lat > 63.0 && lat < 67.0 && lng > -25.0 && lng < -13.0;
  const inSwitzerland = lat > 45.8 && lat < 47.8 && lng > 5.9 && lng < 10.5;
  const inBalkans = inBulgaria || inGreece || inSerbia || inMacedonia || inRomania || inTurkey;
  const inWesternEurope = inItaly || inCzechia || inSlovakia || inGermany || inFrance || inSpain || inPoland || inFinland || inIceland || inSwitzerland;

  if (lat > 35 && lat < 72 && lng > -11 && lng < 40 && !inBalkans && !inWesternEurope) regions.push('europe');
  if (inBulgaria) regions.push('bulgaria');
  if (inGreece) regions.push('greece');
  if (inSerbia) regions.push('serbia');
  if (inMacedonia) regions.push('macedonia');
  if (inRomania) regions.push('romania');
  if (inTurkey) regions.push('turkey');
  if (inItaly) regions.push('italy');
  if (inCzechia) regions.push('czechia');
  if (inSlovakia) regions.push('slovakia');
  if (inGermany) regions.push('germany');
  if (inFrance) regions.push('france');
  if (inSpain) regions.push('spain');
  if (inPoland) regions.push('poland');
  if (inFinland) regions.push('finland');
  if (inIceland) regions.push('iceland');
  if (inSwitzerland) regions.push('switzerland');

  // Asia — per-country sources, then the generic aggregate
  const inTaiwan = lat > 21.8 && lat < 25.4 && lng > 119.5 && lng < 122.1;
  const inJapan = lat > 30 && lat < 46 && lng > 128 && lng < 146;
  const inHongKong = lat > 22.1 && lat < 22.6 && lng > 113.8 && lng < 114.5;
  if (inTaiwan) regions.push('taiwan');
  if (inJapan) regions.push('japan');
  if (inHongKong) regions.push('hongkong');
  if (lat > -10 && lat < 60 && lng > 60 && lng < 150) regions.push('asia');
  // Australia
  if (lat > -45 && lat < -10 && lng > 110 && lng < 155) regions.push('australia');

  return regions.length > 0 ? regions : ['uk', 'us-east']; // Default fallback
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region');
    const lat = parseFloat(searchParams.get('lat') || '0');
    const lng = parseFloat(searchParams.get('lng') || '0');
    const radius = parseFloat(searchParams.get('radius') || '10');

    let regionsToFetch: string[];
    
    if (region === 'all') {
      regionsToFetch = Object.keys(REGION_FETCHERS);
    } else if (region) {
      regionsToFetch = region.split(',').filter(r => r in REGION_FETCHERS);
    } else if (lat !== 0 || lng !== 0) {
      regionsToFetch = getRegionsForBounds(lat, lng, radius);
    } else {
      // Default: load all regions for global coverage
      regionsToFetch = Object.keys(REGION_FETCHERS);
    }

    const results = await Promise.allSettled(
      regionsToFetch.map(r => REGION_FETCHERS[r]())
    );

    const allCameras: any[] = [];
    const sources: Record<string, number> = {};

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const cam of result.value) {
          allCameras.push(cam);
          sources[cam.source] = (sources[cam.source] || 0) + 1;
        }
      }
    }

    return NextResponse.json({
      cameras: allCameras,
      total: allCameras.length,
      sources,
      regions: regionsToFetch,
      timestamp: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    console.error('CCTV fetch error:', error);
    return NextResponse.json({ cameras: [], error: 'Failed' }, { status: 500 });
  }
}
