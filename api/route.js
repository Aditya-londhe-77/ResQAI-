export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const fromLat = Number(url.searchParams.get('fromLat'))
    const fromLng = Number(url.searchParams.get('fromLng'))
    const toLat = Number(url.searchParams.get('toLat'))
    const toLng = Number(url.searchParams.get('toLng'))

    if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Invalid coordinates' }))
      return
    }

    const orsKey = globalThis.process?.env?.VITE_OPENROUTESERVICE_API_KEY
    const providers = []

    if (orsKey) {
      providers.push(async () => {
        const routeUrl = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${encodeURIComponent(orsKey)}&start=${fromLng},${fromLat}&end=${toLng},${toLat}`
        const response = await fetch(routeUrl)
        if (!response.ok) return null
        const data = await response.json()
        const feature = data?.features?.[0]
        const coords = feature?.geometry?.coordinates
        const summary = feature?.properties?.summary
        if (!Array.isArray(coords) || coords.length === 0) return null
        return {
          source: 'openrouteservice',
          positions: coords.map(([lng, lat]) => [lat, lng]),
          distanceKm: Number(summary?.distance) / 1000,
          durationMin: Number(summary?.duration) / 60,
        }
      })
    }

    providers.push(
      async () => {
        const routeUrl = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=false`
        const response = await fetch(routeUrl)
        if (!response.ok) return null
        const data = await response.json()
        const route = data?.routes?.[0]
        if (!route?.geometry?.coordinates?.length) return null
        return {
          source: 'osrm',
          positions: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          distanceKm: Number(route.distance) / 1000,
          durationMin: Number(route.duration) / 60,
        }
      },
      async () => {
        const routeUrl = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=false`
        const response = await fetch(routeUrl)
        if (!response.ok) return null
        const data = await response.json()
        const route = data?.routes?.[0]
        if (!route?.geometry?.coordinates?.length) return null
        return {
          source: 'osmde',
          positions: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          distanceKm: Number(route.distance) / 1000,
          durationMin: Number(route.duration) / 60,
        }
      }
    )

    let route = null
    for (const provider of providers) {
      route = await provider()
      if (route) break
    }

    res.statusCode = route ? 200 : 502
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(route || { error: 'Route unavailable' }))
  } catch (error) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: error?.message || 'Route proxy failed' }))
  }
}