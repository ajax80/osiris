import { NextResponse } from 'next/server';

/**
 * OSIRIS — Active Fire & Wildfire Tracking
 * Multi-source: NASA EONET (primary), NASA FIRMS (secondary), fallback static
 */

export async function GET() {
  try {
    let fires: any[] = [];
    let source = '';

    // Source 1: NASA EONET — most reliable, always works, no API key needed
    try {
      const eonetRes = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires&limit=500', {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'OSIRIS-Intelligence-Platform/3.4' },
      });
      if (eonetRes.ok) {
        const eonetData = await eonetRes.json();
        fires = (eonetData.events || []).map((e: any) => {
          const geo = e.geometry?.[e.geometry.length - 1];
          if (!geo?.coordinates) return null;
          return {
            lat: geo.coordinates[1],
            lng: geo.coordinates[0],
            brightness: 350,
            confidence: 'high',
            date: geo.date?.split('T')[0] || '',
            time: geo.date?.split('T')[1]?.substring(0, 5) || '',
            frp: 50,
            title: e.title,
            source_event: e.sources?.[0]?.url || '',
          };
        }).filter(Boolean);
        source = 'NASA-EONET';
      }
    } catch (e) { console.warn('[OSIRIS] Suppressed error:', e instanceof Error ? e.message : e); }

    // Source 2: Always pull NASA FIRMS satellite hotspots for true global
    // coverage (EONET under-catalogs Canada, Siberia, etc.)
    {
      const firmsKey = process.env.FIRMS_MAP_KEY || 'd0a624db1bff890120a9bc74e81e4e46';
      const firmsSources = [
        `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${firmsKey}/VIIRS_NOAA20_NRT/world/2`,
        `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${firmsKey}/VIIRS_SNPP_NRT/world/2`,
        `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${firmsKey}/MODIS_NRT/world/2`,
      ];

      for (const url of firmsSources) {
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(15000),
            headers: { 'User-Agent': 'OSIRIS-Intelligence-Platform/3.4' },
          });
          if (res.ok) {
            const text = await res.text();
            if (text && text.includes('latitude') && text.length > 200) {
              const parsed = parseCSV(text);
              if (parsed.length > fires.length) {
                fires = parsed;
                source = url.includes('VIIRS_SNPP') ? 'VIIRS-SNPP' : url.includes('MODIS') ? 'MODIS' : 'VIIRS-NOAA20';
              }
              break;
            }
          }
        } catch { continue; }
      }
    }

    // Source 3: Also pull volcanoes from EONET for richer data
    if (fires.length < 100) {
      try {
        const volcRes = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes&limit=50', {
          signal: AbortSignal.timeout(10000),
        });
        if (volcRes.ok) {
          const volcData = await volcRes.json();
          const volcanoes = (volcData.events || []).map((e: any) => {
            const geo = e.geometry?.[e.geometry.length - 1];
            if (!geo?.coordinates) return null;
            return {
              lat: geo.coordinates[1],
              lng: geo.coordinates[0],
              brightness: 500,
              confidence: 'high',
              date: geo.date?.split('T')[0] || '',
              time: '',
              frp: 100,
              title: `[VOLCANO] ${e.title}`,
              type: 'volcano',
            };
          }).filter(Boolean);
          fires = [...fires, ...volcanoes];
          if (!source) source = 'NASA-EONET';
        }
      } catch (e) { console.warn('[OSIRIS] Suppressed error:', e instanceof Error ? e.message : e); }
    }

    return NextResponse.json({
      fires,
      total: fires.length,
      source,
      timestamp: new Date().toISOString(),
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
      },
    });
  } catch (error) {
    console.error('Fire fetch error:', error);
    return NextResponse.json({ fires: [], error: 'Failed to fetch fire data' }, { status: 500 });
  }
}

function parseCSV(csv: string): any[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].split(',');
  const latIdx = header.indexOf('latitude');
  const lngIdx = header.indexOf('longitude');
  const brightIdx = header.indexOf('bright_ti4') !== -1 ? header.indexOf('bright_ti4') : header.indexOf('brightness');
  const confIdx = header.indexOf('confidence');
  const dateIdx = header.indexOf('acq_date');
  const timeIdx = header.indexOf('acq_time');
  const frpIdx = header.indexOf('frp');

  const fires: any[] = [];
  const step = lines.length > 3000 ? Math.ceil(lines.length / 3000) : 1;

  for (let i = 1; i < lines.length; i += step) {
    const cols = lines[i].split(',');
    const lat = parseFloat(cols[latIdx]);
    const lng = parseFloat(cols[lngIdx]);
    if (isNaN(lat) || isNaN(lng)) continue;

    fires.push({
      lat: Math.round(lat * 1000) / 1000,
      lng: Math.round(lng * 1000) / 1000,
      brightness: parseFloat(cols[brightIdx]) || 0,
      confidence: cols[confIdx] || 'unknown',
      date: cols[dateIdx] || '',
      time: cols[timeIdx] || '',
      frp: parseFloat(cols[frpIdx]) || 0,
    });
  }

  return fires;
}
