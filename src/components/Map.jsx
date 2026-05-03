import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap, Circle, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { Crosshair } from 'lucide-react';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import ngoLogo from '../assets/ngo-logo.svg';
import incidentLogo from '../assets/incident-logo.svg';

try {
  if (icon && iconShadow) {
    L.Marker.prototype.options.icon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
  }
} catch (e) {
  // swallow icon creation errors to avoid crashing the map render
  // Leaflet will fall back to its built-in icon
  // eslint-disable-next-line no-console
  console.warn('Leaflet icon init failed', e);
}

const getIcon = (severity, isAI = false) => {
  let color;
  if (isAI) {
    if (severity > 75) color = '#C8440A';
    else if (severity > 50) color = '#2D5F8A';
    else color = '#7A7570';
  } else {
    if (severity > 75) color = '#C8440A';
    else if (severity > 50) color = '#2D5F8A';
    else if (severity > 25) color = '#7A7570';
    else color = '#2D5F8A';
  }
  const pulse = 'animation:markerPulse 2s infinite;';
  const html = `<div style="display:inline-block;border:3px solid ${color};border-radius:8px;padding:2px;background:transparent;${pulse}"><img src="${incidentLogo}" style="width:28px;height:28px;display:block;border-radius:6px;"/></div>`;
  return L.divIcon({
    className: 'custom-icon incident-logo-icon',
    html,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
};

function safeDivIcon(opts) {
  try {
    return L.divIcon(opts);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('divIcon creation failed, falling back to undefined icon', e);
    return undefined;
  }
}

const userIcon = safeDivIcon({
  className: 'custom-icon',
  html: `<div style="background:#C8440A;width:16px;height:16px;border-radius:50%;border:2px solid #FAFAF7;"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const supportIcon = safeDivIcon({
  className: 'support-logo-icon',
  html: `<div style="width:34px;height:34px;display:inline-block;animation:markerPulse 2s infinite;padding:2px;border-radius:8px;background:transparent"><img src="${ngoLogo}" style="width:28px;height:28px;display:block;border-radius:6px;"/></div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

const movingAidIcon = safeDivIcon({
  className: 'custom-icon',
  html: `
    <div style="position:relative;width:28px;height:20px;animation:markerPulse 1.4s infinite;">
      <div style="position:absolute;left:2px;top:5px;width:22px;height:10px;background:#2D5F8A;border:2px solid #FAFAF7;border-radius:2px;">
        <div style="position:absolute;left:3px;top:1px;width:5px;height:3px;background:#FAFAF7;border-radius:1px;"></div>
        <div style="position:absolute;left:10px;top:1px;width:5px;height:3px;background:#FAFAF7;border-radius:1px;"></div>
      </div>
      <div style="position:absolute;left:0px;top:13px;width:6px;height:6px;background:#1A1A1A;border:2px solid #FAFAF7;border-radius:50%;"></div>
      <div style="position:absolute;left:17px;top:13px;width:6px;height:6px;background:#1A1A1A;border:2px solid #FAFAF7;border-radius:50%;"></div>
      <div style="position:absolute;left:23px;top:8px;width:3px;height:4px;background:#C8440A;border-radius:1px;"></div>
    </div>
  `,
  iconSize: [28, 20],
  iconAnchor: [14, 10],
});

function MapEvents({ onMapClick }) {
  useMapEvents({ click(e) { if (onMapClick) onMapClick(e.latlng); } });
  return null;
}

function LocateControl({ userPos }) {
  const map = useMap();
  useEffect(() => {
    if (userPos) map.flyTo(userPos, 13, { duration: 1.5 });
  }, [userPos, map]);
  return null;
}

function fmt(n) {
  if (n == null || n === 0) return '—';
  return Number(n).toLocaleString('en-IN');
}

function getIncidentSeverity(incident) {
  const model = Number(incident?.modelSeverityScore);
  if (Number.isFinite(model)) return model;
  const fallback = Number(incident?.severityScore);
  return Number.isFinite(fallback) ? fallback : 0;
}

function getHelpStatus(incident) {
  const assigned = incident?.assignedNGOs?.length || 0;
  const resolved = incident?.resolvedNGOs?.length || 0;
  if ((incident?.severityScore || 0) === 0 || (assigned > 0 && resolved >= assigned)) {
    return { label: 'Situation under control', color: '#059669' };
  }
  if (assigned > 0) {
    return { label: 'Help is coming', color: '#D97706' };
  }
  return { label: 'Awaiting help assignment', color: '#DC2626' };
}

function normalizeCoords(value) {
  if (!value) return null;
  const directLat = Number(value.lat ?? value.latitude);
  const directLng = Number(value.lng ?? value.longitude ?? value.lon);
  if (Number.isFinite(directLat) && Number.isFinite(directLng)) {
    return { lat: directLat, lng: directLng };
  }

  const nested = value.location || value.geo || value.coords;
  if (!nested) return null;
  const nestedLat = Number(nested.lat ?? nested.latitude);
  const nestedLng = Number(nested.lng ?? nested.longitude ?? nested.lon);
  if (Number.isFinite(nestedLat) && Number.isFinite(nestedLng)) {
    return { lat: nestedLat, lng: nestedLng };
  }
  return null;
}

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function distanceKm(from, to) {
  const source = normalizeCoords(from);
  const target = normalizeCoords(to);
  if (!source || !target) return null;
  const earthRadiusKm = 6371;
  const dLat = toRadians(target.lat - source.lat);
  const dLng = toRadians(target.lng - source.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(source.lat)) * Math.cos(toRadians(target.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function estimateEtaFromDistanceKm(km) {
  if (!Number.isFinite(km) || km < 0) return null;
  const averageSpeedKmh = 33;
  const dispatchBufferMinutes = 8;
  const minutes = Math.max(6, Math.round((km / averageSpeedKmh) * 60 + dispatchBufferMinutes));
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
  }
  return `${minutes} min`;
}

function estimateDurationMinutesFromDistanceKm(km) {
  if (!Number.isFinite(km) || km < 0) return 20;
  const averageSpeedKmh = 33;
  const dispatchBufferMinutes = 8;
  return Math.max(6, Math.round((km / averageSpeedKmh) * 60 + dispatchBufferMinutes));
}

function formatDuration(minutesFloat) {
  const minutes = Math.max(1, Math.round(Number(minutesFloat) || 0));
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
  }
  return `${minutes} min`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getPointAtFraction(positions = [], fraction = 0) {
  if (!Array.isArray(positions) || positions.length === 0) return null;
  if (positions.length === 1) return positions[0];

  const clamped = clamp(fraction, 0, 1);
  const segmentLengths = [];
  let total = 0;

  for (let i = 1; i < positions.length; i += 1) {
    const [lat1, lng1] = positions[i - 1];
    const [lat2, lng2] = positions[i];
    const len = distanceKm({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 }) || 0;
    segmentLengths.push(len);
    total += len;
  }

  if (total === 0) return positions[positions.length - 1];

  const targetDistance = total * clamped;
  let traversed = 0;
  for (let i = 1; i < positions.length; i += 1) {
    const segmentLen = segmentLengths[i - 1];
    const start = positions[i - 1];
    const end = positions[i];
    if (traversed + segmentLen >= targetDistance) {
      const local = segmentLen === 0 ? 0 : (targetDistance - traversed) / segmentLen;
      return [
        start[0] + (end[0] - start[0]) * local,
        start[1] + (end[1] - start[1]) * local,
      ];
    }
    traversed += segmentLen;
  }
  return positions[positions.length - 1];
}

function buildSimulatedRoute(from, to, steps = 18) {
  const source = normalizeCoords(from);
  const target = normalizeCoords(to);
  if (!source || !target) return [];

  const routePoints = [];
  for (let index = 0; index < steps; index += 1) {
    const fraction = steps === 1 ? 1 : index / (steps - 1);
    const bend = Math.sin(fraction * Math.PI) * 0.05;
    routePoints.push([
      source.lat + (target.lat - source.lat) * fraction + bend,
      source.lng + (target.lng - source.lng) * fraction - bend,
    ]);
  }

  routePoints[0] = [source.lat, source.lng];
  routePoints[routePoints.length - 1] = [target.lat, target.lng];
  return routePoints;
}

async function fetchRoadRoute(from, to, signal) {
  const routeUrl = `/api/route?fromLat=${encodeURIComponent(from.lat)}&fromLng=${encodeURIComponent(from.lng)}&toLat=${encodeURIComponent(to.lat)}&toLng=${encodeURIComponent(to.lng)}`;
  const response = await fetch(routeUrl, { signal });
  if (!response.ok) return null;
  const data = await response.json();
  if (!Array.isArray(data?.positions) || data.positions.length === 0) return null;
  return {
    source: data.source || 'road',
    positions: data.positions,
    distanceKm: Number(data.distanceKm),
    durationMin: Number(data.durationMin),
  };
}

function buildRouteKey(from, to) {
  return [
    from.lat.toFixed(5),
    from.lng.toFixed(5),
    to.lat.toFixed(5),
    to.lng.toFixed(5),
  ].join('|');
}

export default function MapView({ incidents = [], ngos = [], onMapClick, interactive = false, userPosition, onLocate }) {
  const defaultCenter = [20.5937, 78.9629];
  const center = userPosition || defaultCenter;
  const [routeByKey, setRouteByKey] = useState({});
  const [routeProgressByKey, setRouteProgressByKey] = useState({});

  const ngoById = useMemo(() => ngos.reduce((acc, ngo) => {
    if (ngo?.id) acc[ngo.id] = ngo;
    return acc;
  }, {}), [ngos]);

  const routeSegments = useMemo(() => incidents.flatMap((incident) => {
    const incidentCoords = normalizeCoords(incident?.location || incident);
    if (!incidentCoords) return [];

    const assignedNgoIds = Array.isArray(incident?.assignedNGOs) ? incident.assignedNGOs : [];
    return assignedNgoIds.map((ngoId) => {
      const ngo = ngoById[ngoId];
      const ngoCoords = normalizeCoords(ngo?.location || ngo);
      if (!ngoCoords) return null;
      const km = distanceKm(ngoCoords, incidentCoords);
      const routeKey = buildRouteKey(ngoCoords, incidentCoords);
      return {
        id: `${incident.id || incident.title}-${ngoId}`,
        incidentTitle: incident.title,
        incidentKey: incident.id || incident._clientId || `${incident.title}-${incidentCoords.lat}-${incidentCoords.lng}`,
        ngoId,
        ngoName: ngo?.name || 'Assigned NGO',
        ngoCoords,
        incidentCoords,
        distance: km,
        routeKey,
      };
    }).filter(Boolean);
  }), [incidents, ngoById]);

  useEffect(() => {
    const missingSegments = routeSegments.filter((segment) => !routeByKey[segment.routeKey]);
    if (missingSegments.length === 0) return;

    const controller = new AbortController();
    let cancelled = false;

    const fetchRoutes = async () => {
      const updates = {};
      console.debug('[Map] fetchRoutes missingSegments:', missingSegments.length);
      for (const segment of missingSegments.slice(0, 25)) {
        if (cancelled) return;
        const roadRoute = await fetchRoadRoute(segment.ngoCoords, segment.incidentCoords, controller.signal);
        const fallbackPositions = buildSimulatedRoute(segment.ngoCoords, segment.incidentCoords);
        updates[segment.routeKey] = {
          status: 'ready',
          source: roadRoute?.source || 'simulated',
          positions: roadRoute?.positions?.length ? roadRoute.positions : fallbackPositions,
          distanceKm: Number.isFinite(roadRoute?.distanceKm) ? roadRoute.distanceKm : segment.distance,
          durationMin: Number.isFinite(roadRoute?.durationMin)
            ? roadRoute.durationMin
            : estimateDurationMinutesFromDistanceKm(segment.distance),
        };
      }
      if (cancelled) return;
      console.debug('[Map] setting routes for keys:', Object.keys(updates).length);
      setRouteByKey((prev) => ({ ...prev, ...updates }));
    };

    fetchRoutes();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [routeByKey, routeSegments]);

  useEffect(() => {
    const activeRoutes = routeSegments.filter((segment) => routeByKey[segment.routeKey]?.status === 'ready');
    if (activeRoutes.length === 0) return undefined;

    const cycleTimer = window.setInterval(() => {
      setRouteProgressByKey((prev) => {
        const next = { ...prev };
        activeRoutes.forEach((segment) => {
          const route = routeByKey[segment.routeKey];
          const routeMinutes = Number(route?.durationMin);
          const visualCycleMs = clamp((Number.isFinite(routeMinutes) ? routeMinutes : 20) * 1000 / 4, 10000, 30000);
          const current = Number.isFinite(next[segment.routeKey]) ? next[segment.routeKey] : 0;
          next[segment.routeKey] = (current + 250 / visualCycleMs) % 1;
        });
        return next;
      });
    }, 250);

    return () => window.clearInterval(cycleTimer);
  }, [routeByKey, routeSegments]);

  const routeSummaryByIncident = useMemo(() => routeSegments.reduce((acc, segment) => {
    const route = routeByKey[segment.routeKey];
    if (route?.status !== 'ready') return acc;

    const effectiveDistance = Number.isFinite(route.distanceKm) ? route.distanceKm : segment.distance;
    const effectiveEta = Number.isFinite(route.durationMin) && route.durationMin > 0
      ? formatDuration(route.durationMin)
      : estimateEtaFromDistanceKm(segment.distance);

    const normalized = {
      ...segment,
      distance: effectiveDistance,
      eta: effectiveEta,
      routeSource: route.source || 'road',
    };

    const existing = acc[segment.incidentKey];
    if (!existing) {
      acc[segment.incidentKey] = normalized;
      return acc;
    }

    const existingDistance = Number.isFinite(existing.distance) ? existing.distance : Number.POSITIVE_INFINITY;
    const currentDistance = Number.isFinite(normalized.distance) ? normalized.distance : Number.POSITIVE_INFINITY;
    if (currentDistance < existingDistance) acc[segment.incidentKey] = normalized;
    return acc;
  }, {}), [routeByKey, routeSegments]);

  const supportMarkers = useMemo(() => Object.values(routeSegments.reduce((acc, segment) => {
    if (routeByKey[segment.routeKey]?.status === 'ready' && !acc[segment.ngoId]) {
      acc[segment.ngoId] = {
        ngoId: segment.ngoId,
        ngoName: segment.ngoName,
        ngoCoords: segment.ngoCoords,
      };
    }
    return acc;
  }, {})), [routeByKey, routeSegments]);

  const movingAidMarkers = useMemo(() => {
    // Produce at most one moving aid marker per NGO (deduplicate by ngoId)
    const chosenByNgo = {};
    for (const segment of routeSegments) {
      const route = routeByKey[segment.routeKey];
      if (!route || route.status !== 'ready' || !Array.isArray(route.positions) || route.positions.length < 2) continue;
      const existing = chosenByNgo[segment.ngoId];
      // prefer shorter distance segment if multiple
      if (!existing || (Number.isFinite(segment.distance) && segment.distance < existing.distance)) {
        chosenByNgo[segment.ngoId] = segment;
      }
    }

    const markers = [];
    for (const ngoId of Object.keys(chosenByNgo)) {
      const segment = chosenByNgo[ngoId];
      const route = routeByKey[segment.routeKey];
      const progress = Number.isFinite(routeProgressByKey[segment.routeKey]) ? routeProgressByKey[segment.routeKey] : 0;
      const point = getPointAtFraction(route.positions, progress);
      if (!point) continue;
      markers.push({
        id: `aid-${segment.id}`,
        point,
        ngoName: segment.ngoName,
        incidentTitle: segment.incidentTitle,
        eta: routeSummaryByIncident[segment.incidentKey]?.eta,
      });
    }
    return markers;
  }, [routeByKey, routeProgressByKey, routeSegments, routeSummaryByIncident]);

  return (
    <div className="map-wrapper">
      <MapContainer center={center} zoom={userPosition ? 13 : 5} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />

        {interactive && <MapEvents onMapClick={onMapClick} />}
        <LocateControl userPos={userPosition} />

        {routeSegments.map((segment) => {
          const route = routeByKey[segment.routeKey];
          if (!route || route.status !== 'ready') return null;
          return (
            <Polyline
              key={`route-${segment.id}`}
              positions={route.positions}
              pathOptions={{ color: '#2D5F8A', weight: 3.25, opacity: 0.9 }}
            />
          );
        })}

        {movingAidMarkers.map((marker) => (
          <Marker key={marker.id} position={marker.point} icon={movingAidIcon}>
            <Popup>
              <div className="map-popup">
                <div className="map-popup__eyebrow map-popup__eyebrow--primary">Dispatch</div>
                <strong className="map-popup__title">Help Vehicle En Route</strong>
                <div className="map-popup__subtitle">{marker.ngoName} to {marker.incidentTitle}</div>
                <div className="map-popup__meta">Estimated arrival: ~{marker.eta || '—'}</div>
              </div>
            </Popup>
          </Marker>
        ))}

        {supportMarkers.map((marker) => (
          <Marker key={`support-${marker.ngoId}`} position={[marker.ngoCoords.lat, marker.ngoCoords.lng]} icon={supportIcon}>
            <Popup>
              <div className="map-popup">
                <div className="map-popup__eyebrow">Resource Source</div>
                <strong className="map-popup__title">Help Team Source</strong>
                <div className="map-popup__subtitle">{marker.ngoName}</div>
                <div className="map-popup__meta">Help is dispatched from this NGO.</div>
              </div>
            </Popup>
          </Marker>
        ))}

        {userPosition && (
          <>
            <Marker position={userPosition} icon={userIcon}>
              <Popup><strong>Your Location</strong></Popup>
            </Marker>
            <Circle center={userPosition} radius={500} pathOptions={{ color: '#C8440A', fillColor: '#C8440A', fillOpacity: 0.06, weight: 1.5 }} />
          </>
        )}

        {incidents.map((inc) => {
          const severity = getIncidentSeverity(inc);
          const incidentCoords = normalizeCoords(inc?.location || inc);
          const incidentKey = inc.id || inc._clientId || `${inc.title}-${incidentCoords?.lat}-${incidentCoords?.lng}`;
          const routeSummary = routeSummaryByIncident[incidentKey];
          const helpStatus = getHelpStatus(inc);

          return (
            <Marker
              key={inc.id || inc._clientId || `${inc.location?.lat}-${inc.location?.lng}`}
              position={[inc.location.lat, inc.location.lng]}
              icon={getIcon(severity, inc.aiGenerated)}
            >
              <Popup>
                <div className="map-popup">
                  {inc.aiGenerated && (
                    <div className="map-popup__eyebrow map-popup__eyebrow--primary">
                      AI REPORT
                    </div>
                  )}

                  <h4 className="map-popup__title">{inc.title}</h4>
                  <div className="map-popup__subtitle">{inc.disasterType}</div>

                  {inc.description && (
                    <p className="map-popup__body">{inc.description}</p>
                  )}

                  <div className="map-popup__severity" style={{ color: severity > 75 ? 'var(--primary)' : 'var(--accent)' }}>
                    Severity: {severity}%{inc.level ? ` (${inc.level})` : ''}
                  </div>

                  {inc.aiGenerated ? (
                    <>
                      <div className="map-popup__stats">
                        <span>Deaths</span><strong>{fmt(inc.confirmedDeaths)}</strong>
                        <span>Rescued</span><strong>{fmt(inc.confirmedRescued)}</strong>
                        <span>Awaiting</span><strong>{fmt(inc.awaitingRescue)}</strong>
                        <span>Affected</span><strong>{fmt(inc.totalAffected)}</strong>
                      </div>
                      {inc.logistics && (
                        <div className="map-popup__panel">
                          <div className="map-popup__label">Logistics Needed</div>
                          <div>Water: {fmt(inc.logistics.freshWater)} L</div>
                          <div>Food: {fmt(inc.logistics.foodPackets)} packets</div>
                          <div>Med Kits: {fmt(inc.logistics.medicalKits)}</div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="map-popup__meta">
                      {inc.reportCount} reports • {inc.assignedNGOs?.length || 0} NGOs
                    </div>
                  )}

                  <div className="map-popup__status" style={{ color: helpStatus.color }}>
                    {helpStatus.label}
                  </div>

                  {routeSummary && (
                    <div className="map-popup__route">
                      <div><strong>From:</strong> {routeSummary.ngoName}</div>
                      <div><strong>Route:</strong> ~{Number.isFinite(routeSummary.distance) ? routeSummary.distance.toFixed(1) : '—'} km road route</div>
                      <div><strong>Estimated arrival:</strong> ~{routeSummary.eta || '—'}</div>
                      <div className="map-popup__meta"><strong>Route source:</strong> {routeSummary.routeSource}</div>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {onLocate && (
        <button
          className="map-locate-btn"
          onClick={onLocate}
          title="Locate me"
          style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            zIndex: 999,
            padding: '10px',
            borderRadius: '2px',
            border: '1px solid #1A1A1A',
            background: 'white',
            cursor: 'pointer',
            transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
          }}
        >
          <Crosshair size={20} color="#C8440A" />
        </button>
      )}
    </div>
  );
}