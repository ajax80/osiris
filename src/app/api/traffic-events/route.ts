import { NextResponse } from 'next/server';

export async function GET() {
  const key = process.env.GA511_KEY;
  if (!key) {
    return NextResponse.json({ traffic_events: [], total: 0, error: 'GA511_KEY not set' });
  }

  try {
    const res = await fetch(`https://511ga.org/api/v2/get/event?key=${key}&format=json`, {
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      return NextResponse.json({ traffic_events: [], total: 0, error: '511GA unavailable' });
    }

    const data = await res.json();

    const traffic_events = (Array.isArray(data) ? data : [])
      .filter((e: any) => e.Latitude && e.Longitude)
      .map((e: any) => ({
        id: `ga-${e.ID}`,
        lat: e.Latitude,
        lng: e.Longitude,
        roadway: e.RoadwayName || '',
        direction: e.DirectionOfTravel || '',
        description: e.Description || '',
        lanes_affected: e.LanesAffected || '',
        event_type: e.EventType || 'unknown',
        subtype: e.Subtype || '',
        severity: e.Severity || 'unknown',
        full_closure: !!e.IsFullClosure,
        updated: e.LastUpdated ? e.LastUpdated * 1000 : null,
        source: 'GA-511',
      }));

    return NextResponse.json({
      traffic_events,
      total: traffic_events.length,
      timestamp: new Date().toISOString(),
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Traffic events fetch error:', error);
    return NextResponse.json({ traffic_events: [], total: 0, error: 'Failed to fetch traffic events' }, { status: 500 });
  }
}
