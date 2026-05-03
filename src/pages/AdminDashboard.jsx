import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { MapPin, AlertCircle, Users, Package, BarChart3, Shield, Cpu, RefreshCw } from 'lucide-react';
import Navbar from '../components/Navbar';
import TabBar from '../components/TabBar';
import MapView from '../components/Map';
import SeverityBar from '../components/SeverityBar';
import FloatingAlert from '../components/FloatingAlert';
import StatCard from '../components/StatCard';
import { assignNGOToIncident, autoAssignNGOsForIncidentModel, saveAIIncidentsToFirestore } from '../firebase/firestoreHelpers';
import { runCrisisScanner } from '../services/crisisScanner';

const normalizeCoords = (value) => {
  if (!value) return null;

  const directLat = Number(value.lat ?? value.latitude);
  const directLng = Number(value.lng ?? value.longitude ?? value.lon);
  if (Number.isFinite(directLat) && Number.isFinite(directLng)) {
    return { lat: directLat, lng: directLng };
  }

  const nested = value.location || value.geo || value.coords;
  if (nested) {
    const nestedLat = Number(nested.lat ?? nested.latitude);
    const nestedLng = Number(nested.lng ?? nested.longitude ?? nested.lon);
    if (Number.isFinite(nestedLat) && Number.isFinite(nestedLng)) {
      return { lat: nestedLat, lng: nestedLng };
    }
  }

  return null;
};

const toRadians = (deg) => (deg * Math.PI) / 180;

const distanceKm = (from, to) => {
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
};

export default function AdminDashboard() {
  const { user, userData, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState([]);
  const [ngos, setNgos] = useState([]);
  const [allVolunteers, setAllVolunteers] = useState([]);
  const [donations, setDonations] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [floatingAlert, setFloatingAlert] = useState(null);
  const [userPosition, setUserPosition] = useState(null);
  const [showNearestOnly, setShowNearestOnly] = useState(false);
  const [assigningNgoId, setAssigningNgoId] = useState('');
  const [autoAssigningIncidentId, setAutoAssigningIncidentId] = useState('');

  // AI Scanner state
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanLog, setScanLog] = useState([]);
  const [scanDone, setScanDone] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [scanResults, setScanResults] = useState([]);
  const lastSevereAlertKeyRef = useRef('');
  const autoAssignAttemptedKeysRef = useRef(new Set());

  const getModelSeverity = useCallback((incident) => {
    const model = Number(incident?.modelSeverityScore);
    if (Number.isFinite(model)) return model;
    const fallback = Number(incident?.severityScore);
    return Number.isFinite(fallback) ? fallback : 0;
  }, []);

  const getIncidentHelpStatus = (incident) => {
    const assigned = incident?.assignedNGOs?.length || 0;
    const resolved = incident?.resolvedNGOs?.length || 0;

    if ((incident?.severityScore || 0) === 0 || (assigned > 0 && resolved >= assigned)) {
      return { label: 'Situation under control', color: 'var(--success)' };
    }
    if (assigned > 0) {
      return { label: 'Help is coming', color: 'var(--warning)' };
    }
    return { label: 'Awaiting NGO assignment', color: 'var(--danger)' };
  };

  const estimateEtaFromDistanceKm = (km) => {
    if (!Number.isFinite(km) || km < 0) return null;

    // Rough forecast, intentionally approximate.
    const averageSpeedKmh = 34;
    const dispatchBufferMinutes = 8;
    const minutes = Math.max(6, Math.round((km / averageSpeedKmh) * 60 + dispatchBufferMinutes));

    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainder = minutes % 60;
      return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
    }

    return `${minutes} min`;
  };

  const getIncidentEtaLabel = (incident) => {
    const assignedNgoIds = Array.isArray(incident?.assignedNGOs) ? incident.assignedNGOs : [];
    if (assignedNgoIds.length === 0) return null;

    const incidentCoords = normalizeCoords(incident?.location || incident);
    if (!incidentCoords) return null;

    const nearestDistance = assignedNgoIds.reduce((minDistance, ngoId) => {
      const ngo = ngos.find((item) => item.id === ngoId);
      const km = distanceKm(ngo, incidentCoords);
      if (!Number.isFinite(km)) return minDistance;
      return minDistance == null || km < minDistance ? km : minDistance;
    }, null);

    return estimateEtaFromDistanceKm(nearestDistance);
  };

  useEffect(() => {
    if (!authLoading && (!user || (user.email !== 'resqaiadmin@gmail.com' && userData?.role !== 'admin'))) navigate('/');
  }, [user, userData, authLoading, navigate]);

  const locateUser = useCallback(() => {
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(
      (pos) => setUserPosition([pos.coords.latitude, pos.coords.longitude]),
      () => {}, { enableHighAccuracy: true }
    );
  }, []);
  useEffect(() => { locateUser(); }, [locateUser]);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'incidents'), (s) => {
      const data = s.docs.map(d => ({ id: d.id, ...d.data() }));
      setIncidents(data);
      const severe = data.find(i => i.reportCount > 5 && i.severityScore > 50);
      if (!severe) {
        lastSevereAlertKeyRef.current = '';
        return;
      }

      const severeKey = `${severe.id}:${severe.reportCount}:${severe.severityScore}`;
      if (lastSevereAlertKeyRef.current === severeKey) return;

      lastSevereAlertKeyRef.current = severeKey;
      setFloatingAlert(`${severe.reportCount} reports: ${severe.disasterType} in ${severe.title}`);
    });
    const u2 = onSnapshot(query(collection(db, 'users'), where('role', '==', 'ngo')), (s) => setNgos(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u3 = onSnapshot(query(collection(db, 'users'), where('role', '==', 'volunteer')), (s) => setAllVolunteers(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u4 = onSnapshot(collection(db, 'donations'), (s) => setDonations(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  useEffect(() => {
    if (!floatingAlert) return;
    const timer = setTimeout(() => setFloatingAlert(null), 3500);
    return () => clearTimeout(timer);
  }, [floatingAlert]);

  const handleAssign = async (ngoId) => {
    if (!selectedIncident || assigningNgoId) return;
    setAssigningNgoId(ngoId);
    try {
      await assignNGOToIncident(selectedIncident.id, ngoId);
      setFloatingAlert(`NGO assigned to "${selectedIncident.title}" successfully.`);
    } catch (err) {
      setFloatingAlert(`Assignment failed: ${err.message}`);
    } finally {
      setAssigningNgoId('');
    }
  };

  const handleAIScan = useCallback(async () => {
    if (scanLoading) return;
    setScanLoading(true);
    setScanError('');
    setScanLog([]);
    setScanDone(false);
    setSavedCount(0);
    setScanResults([]);

    try {
      const results = await runCrisisScanner((msg) =>
        setScanLog((prev) => [...prev, msg])
      );
      setScanResults(results);
      setScanLog((prev) => [...prev, `💾 Saving ${results.length} reports to Firestore...`]);
      const saved = await saveAIIncidentsToFirestore(results);
      setSavedCount(saved.length);

      if (saved.length === 0) {
        setScanLog((prev) => [...prev, '⚠️ All reports already exist in Firebase from a previous scan.']);
      } else {
        setScanLog((prev) => [...prev, `✅ ${saved.length} new crisis reports saved and live on the map!`]);
        setFloatingAlert(`🤖 AI Scan complete — ${saved.length} new crisis reports added!`);
      }
      setScanDone(true);
    } catch (err) {
      const msg = String(err?.message || err);
      setScanError(
        msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('overloaded')
          ? 'Gemini API is currently overloaded. Please wait a minute and try again.'
          : msg
      );
    } finally {
      setScanLoading(false);
    }
  }, [scanLoading]);

  const handleAutoAssignModel = useCallback(async (incident) => {
    if (!incident?.id || autoAssigningIncidentId) return;
    setAutoAssigningIncidentId(incident.id);
    try {
      const result = await autoAssignNGOsForIncidentModel(incident, ngos);
      if (result.assignedNgoIds.length > 0) {
        setFloatingAlert(`Model auto-assigned ${result.assignedNgoIds.length} NGO(s) to "${incident.title}".`);
      }
    } catch (err) {
      setFloatingAlert(`Auto-assignment failed: ${err.message}`);
    } finally {
      setAutoAssigningIncidentId('');
    }
  }, [autoAssigningIncidentId, ngos]);

  useEffect(() => {
    if (!incidents.length || !ngos.length) return;

    const candidates = incidents.filter((incident) => {
      const severity = Number(incident?.severityScore) || 0;
      const assignedCount = incident?.assignedNGOs?.length || 0;
      const resolvedCount = incident?.resolvedNGOs?.length || 0;

      if (severity <= 0) return false;
      if (assignedCount > 0) return false;
      if (resolvedCount > 0) return false;

      const key = `${incident.id}:${incident.reportCount || 0}:${severity}`;
      if (autoAssignAttemptedKeysRef.current.has(key)) return false;

      autoAssignAttemptedKeysRef.current.add(key);
      return true;
    });

    if (candidates.length === 0) return;

    let isCancelled = false;
    const runAssignments = async () => {
      for (const incident of candidates) {
        if (isCancelled) return;
        try {
          await autoAssignNGOsForIncidentModel(incident, ngos);
        } catch {
          // Silent retry prevention by key-ref above; admin can trigger manual auto-assign.
        }
      }
    };

    runAssignments();
    return () => {
      isCancelled = true;
    };
  }, [incidents, ngos]);

  const nearestNgos = useMemo(() => {
    const incidentCoords = normalizeCoords(selectedIncident?.location || selectedIncident);
    if (!incidentCoords) return ngos.map((ngo) => ({ ...ngo, distanceKm: null }));

    return ngos
      .map((ngo) => ({
        ...ngo,
        distanceKm: distanceKm(incidentCoords, ngo),
      }))
      .sort((a, b) => {
        if (a.distanceKm == null && b.distanceKm == null) return 0;
        if (a.distanceKm == null) return 1;
        if (b.distanceKm == null) return -1;
        return a.distanceKm - b.distanceKm;
      });
  }, [ngos, selectedIncident]);

  const ngosForAssignment = useMemo(() => {
    if (!showNearestOnly) return nearestNgos;
    return nearestNgos.slice(0, 5);
  }, [nearestNgos, showNearestOnly]);

  const volunteersByNgo = useMemo(() => {
    const grouped = allVolunteers.reduce((acc, volunteer) => {
      const ngoId = volunteer.joinedNgoId || 'unassigned';
      if (!acc[ngoId]) acc[ngoId] = [];
      acc[ngoId].push(volunteer);
      return acc;
    }, {});

    return grouped;
  }, [allVolunteers]);

  const volunteerGroups = useMemo(() => {
    const ngoGroups = ngos.map((ngo) => ({
      id: ngo.id,
      name: ngo.name,
      volunteers: volunteersByNgo[ngo.id] || [],
    }));

    const unassigned = volunteersByNgo.unassigned || [];
    if (unassigned.length > 0) {
      ngoGroups.push({
        id: 'unassigned',
        name: 'Not Joined Any NGO',
        volunteers: unassigned,
      });
    }

    return ngoGroups;
  }, [ngos, volunteersByNgo]);

  const totalDonations = donations.reduce((s, d) => s + (d.amount || 0), 0);
  const activeIncidents = incidents.filter(i => i.severityScore > 0);
  const resolvedIncidents = incidents.filter(i => i.severityScore === 0);
  const sortedActiveIncidents = useMemo(
    () => [...activeIncidents].sort((a, b) => getModelSeverity(b) - getModelSeverity(a)),
    [activeIncidents, getModelSeverity]
  );

  const tabs = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 size={15} /> },
    { id: 'map', label: 'Command Map', icon: <MapPin size={15} /> },
    { id: 'incidents', label: 'Incidents', icon: <AlertCircle size={15} /> },
    { id: 'scanner', label: 'AI Scanner', icon: <Cpu size={15} /> },
    { id: 'ngos', label: 'NGOs', icon: <Shield size={15} /> },
    { id: 'volunteers', label: 'Volunteers', icon: <Users size={15} /> },
  ];

  if (authLoading) return <div className="app-layout" style={{ justifyContent: 'center', alignItems: 'center' }}><span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} /></div>;

  return (
    <div className="app-layout">
      <FloatingAlert message={floatingAlert} onClose={() => setFloatingAlert(null)} />

      {/* Left Sidebar */}
      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Main Content Area */}
      <div className="app-main-wrapper">
        <Navbar />
        <main className="app-content">

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="fade-in">
            <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
              <StatCard icon={<AlertCircle size={36} />} value={incidents.length} label="Total Incidents" />
              <StatCard icon={<AlertCircle size={36} />} value={activeIncidents.length} label="Active Crises" color="var(--danger)" />
              <StatCard icon={<Shield size={36} />} value={ngos.length} label="Registered NGOs" />
              <StatCard icon={<Users size={36} />} value={allVolunteers.length} label="Volunteers" />
            </div>
            <div className="grid-3">
              <StatCard icon={<BarChart3 size={36} />} value={resolvedIncidents.length} label="Resolved" color="var(--success)" />
              <StatCard icon={<Package size={36} />} value={`₹${totalDonations.toLocaleString()}`} label="Total Donations" color="var(--primary)" />
              <StatCard icon={<BarChart3 size={36} />} value={incidents.reduce((s, i) => s + (i.reportCount || 0), 0)} label="Total Reports" />
            </div>
          </div>
        )}

        {/* COMMAND MAP */}
        {activeTab === 'map' && (
          <div style={{ height: 'calc(100vh - 130px)' }} className="fade-in">
            <MapView incidents={incidents} ngos={ngos} interactive={false} userPosition={userPosition} onLocate={locateUser} />
          </div>
        )}

        {/* AI SCANNER TAB */}
        {activeTab === 'scanner' && (
          <div className="fade-in" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
            {/* Scanner Control Panel */}
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem', background: 'linear-gradient(135deg,var(--bg-surface),var(--bg-surface))', border: '1.5px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <Cpu size={22} color="var(--primary)" />
                <div>
                  <h3 style={{ fontFamily: 'var(--font-serif)',  margin: 0, fontSize: '1.05rem', color: 'var(--primary)' }}>AI Crisis Scanner</h3>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>Powered by Gemini AI + Google Search • Admin Only</p>
                </div>
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                Scans recent real-world disasters across India, generates AI-predicted resource requirements for each event, and saves them to Firestore so they appear live on the Command Map and all user dashboards.
              </p>

              {/* Live log feed */}
              {scanLog.length > 0 && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '0.65rem 0.85rem', marginBottom: '0.85rem', maxHeight: 130, overflowY: 'auto', fontFamily: 'monospace' }}>
                  {scanLog.map((line, i) => (
                    <div key={i} style={{ fontSize: '0.72rem', color: 'var(--text-body)', lineHeight: 1.6 }}>{line}</div>
                  ))}
                </div>
              )}

              {scanError && (
                <div style={{ background: 'var(--danger-light)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, padding: '0.55rem 0.8rem', fontSize: '0.78rem', marginBottom: '0.85rem' }}>
                  ⚠️ {scanError}
                </div>
              )}

              {scanDone && (
                <div style={{ color: savedCount > 0 ? 'var(--success)' : 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.85rem' }}>
                  {savedCount > 0 ? `✅ ${savedCount} new incidents saved to Firebase and live on map!` : '⚠️ All scanned incidents already exist in Firebase.'}
                </div>
              )}

              <button
                className="btn btn-primary"
                onClick={handleAIScan}
                disabled={scanLoading}
                style={{ background: scanLoading ? undefined : 'linear-gradient(135deg,var(--primary),#4F46E5)', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', minWidth: 200 }}
              >
                {scanLoading
                  ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2, borderColor: 'var(--text-light)', borderTopColor: 'transparent' }} /> Scanning India for crises...</>
                  : <><RefreshCw size={15} /> Run AI Crisis Scan</>}
              </button>
            </div>

            {/* Scan Results with Resource Predictions */}
            {scanResults.length > 0 && (
              <div>
                <h4 style={{ fontFamily: 'var(--font-serif)',  marginBottom: '0.85rem', fontSize: '0.95rem' }}>
                  📊 Scan Results — {scanResults.length} Crisis Reports
                  <span style={{ marginLeft: 8, fontSize: '0.72rem', background: 'var(--primary-light)', color: 'var(--primary)', borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>🤖 AI Generated</span>
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {scanResults.map((inc, idx) => (
                    <div key={inc._clientId || idx} className="card" style={{ padding: '1.25rem', border: `1.5px solid ${inc.level === 'RED' ? 'var(--danger-light)' : inc.level === 'ORANGE' ? 'var(--warning-light)' : 'var(--success-light)'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 3 }}>
                            <span style={{ fontSize: '0.65rem', background: inc.level === 'RED' ? 'var(--danger)' : inc.level === 'ORANGE' ? 'var(--warning)' : 'var(--success)', color: 'var(--text-light)', borderRadius: 4, padding: '2px 7px', fontWeight: 700, letterSpacing: '0.05em' }}>{inc.level}</span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{inc.disasterType}</span>
                          </div>
                          <h4 style={{ fontFamily: 'var(--font-serif)',  margin: 0, fontSize: '0.92rem' }}>{inc.title}</h4>
                        </div>
                        <span style={{ fontSize: '0.9rem', fontWeight: 800, color: inc.severityScore > 75 ? 'var(--danger)' : inc.severityScore > 50 ? 'var(--warning)' : 'var(--success)', whiteSpace: 'nowrap', marginLeft: 12 }}>{inc.severityScore}%</span>
                      </div>

                      {inc.description && (
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 0.75rem', lineHeight: 1.5 }}>{inc.description}</p>
                      )}

                      {/* Casualty quick stats */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.4rem', marginBottom: '0.85rem' }}>
                        {[['💀 Deaths', inc.confirmedDeaths], ['🟢 Rescued', inc.confirmedRescued], ['🔴 Awaiting', inc.awaitingRescue], ['👥 Affected', inc.totalAffected]].map(([label, val]) => (
                          <div key={label} style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{label}</div>
                            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>{val > 0 ? val.toLocaleString('en-IN') : '—'}</div>
                          </div>
                        ))}
                      </div>

                      {/* AI Predicted Resource Needs */}
                      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: 8, padding: '0.85rem' }}>
                        <h5 style={{ fontFamily: 'var(--font-serif)',  margin: '0 0 0.35rem', fontSize: '0.82rem' }}>AI Predicted Resource Needs</h5>
                        <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0 0 0.4rem', lineHeight: 1.45 }}>
                          {inc.aiAnalysis?.summary || inc.description}
                        </p>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.55rem' }}>
                          Urgency: <strong style={{ color: inc.aiAnalysis?.urgency === 'critical' ? 'var(--danger)' : inc.aiAnalysis?.urgency === 'high' ? 'var(--warning)' : 'inherit' }}>{inc.aiAnalysis?.urgency || 'N/A'}</strong>
                          {' '}&bull; Confidence: <strong>{inc.aiAnalysis?.confidence != null ? `${Math.round(inc.aiAnalysis.confidence * 100)}%` : 'N/A'}</strong>
                        </div>
                        {inc.requiredResources?.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.22rem' }}>
                            {inc.requiredResources.map((item, i) => (
                              <div key={i} style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: item.priority === 'critical' ? 'var(--danger)' : item.priority === 'high' ? 'var(--warning)' : item.priority === 'low' ? 'var(--success)' : '#F59E0B', flexShrink: 0 }} />
                                {item.resource}: <strong style={{ color: 'var(--text-primary)', marginLeft: 2 }}>{item.quantity}</strong>
                                <span style={{ marginLeft: 4, opacity: 0.7 }}>({item.priority})</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: 0 }}>Resource predictions pending — re-scan to populate.</p>
                        )}

                        {/* Logistics */}
                        {inc.logistics && (inc.logistics.freshWater > 0 || inc.logistics.foodPackets > 0) && (
                          <div style={{ marginTop: '0.65rem', paddingTop: '0.55rem', borderTop: '1px solid var(--border-light)', display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            <span>💧 Water: <strong>{inc.logistics.freshWater?.toLocaleString('en-IN')} L</strong></span>
                            <span>🍱 Food: <strong>{inc.logistics.foodPackets?.toLocaleString('en-IN')} pkts</strong></span>
                            <span>🏥 Med Kits: <strong>{inc.logistics.medicalKits?.toLocaleString('en-IN')}</strong></span>
                          </div>
                        )}
                      </div>

                      <div style={{ marginTop: '0.6rem', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        📍 {inc.location?.lat?.toFixed(4)}, {inc.location?.lng?.toFixed(4)} &bull; Source: {inc.source}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!scanLoading && scanResults.length === 0 && !scanDone && (
              <div className="empty-state">
                <Cpu size={48} color="var(--primary)" />
                <p>Click <strong>Run AI Crisis Scan</strong> to fetch real-time crisis data from Gemini AI.</p>
              </div>
            )}
          </div>
        )}

        {/* INCIDENTS */}
        {activeTab === 'incidents' && (
          <div className="fade-in admin-incidents-layout">
            <div className="admin-incidents-list">
              <h4 style={{ fontFamily: 'var(--font-serif)',  fontSize: '0.9rem', marginBottom: '0.5rem' }}>Active Incidents ({sortedActiveIncidents.length})</h4>
              {sortedActiveIncidents.map(inc => {
                const severity = getModelSeverity(inc);
                const helpStatus = getIncidentHelpStatus(inc);
                const etaLabel = getIncidentEtaLabel(inc);
                return (
                <div key={inc.id} className={`incident-item ${selectedIncident?.id === inc.id ? 'selected' : ''}`} onClick={() => setSelectedIncident(inc)} style={{ borderLeftColor: severity > 75 ? 'var(--danger)' : severity > 40 ? 'var(--warning)' : 'var(--success)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <strong style={{ fontSize: '0.82rem' }}>{inc.title}</strong>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: severity > 75 ? 'var(--danger)' : 'var(--text-muted)' }}>{severity}%</span>
                  </div>
                  <SeverityBar value={severity} />
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>{inc.disasterType} • {inc.reportCount} reports • {inc.assignedNGOs?.length || 0} NGOs</div>
                  <div style={{ fontSize: '0.7rem', color: helpStatus.color, fontWeight: 700, marginTop: 3 }}>
                    🚑 {helpStatus.label}
                  </div>
                  {inc.assignedNGOs?.length > 0 && etaLabel && (
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      🕒 Predicted ETA: ~{etaLabel}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
            <div className="admin-incidents-detail">
              {selectedIncident ? (
                <div className="card fade-in" style={{ padding: '1.5rem' }}>
                  {(() => {
                    const selectedSeverity = getModelSeverity(selectedIncident);
                    return (
                    <>
                  <h3 style={{ fontFamily: 'var(--font-serif)',  marginBottom: '0.5rem' }}>{selectedIncident.title}</h3>
                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>🌪 {selectedIncident.disasterType}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>📢 {selectedIncident.reportCount} reports</span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: selectedSeverity > 50 ? 'var(--danger)' : 'var(--success)' }}>Severity: {selectedSeverity}%</span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: getIncidentHelpStatus(selectedIncident).color }}>🚑 {getIncidentHelpStatus(selectedIncident).label}</span>
                  </div>
                  <SeverityBar value={selectedSeverity} />

                  </>
                    );
                  })()}

                  <div style={{ marginTop: '1.15rem', marginBottom: '0.4rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-sm)', padding: '0.85rem' }}>
                    <h4 style={{ fontFamily: 'var(--font-serif)',  marginBottom: '0.4rem', fontSize: '0.85rem' }}>AI Predicted Resource Needs</h4>
                    <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                      {selectedIncident.aiAnalysis?.summary || 'No AI summary available yet for this incident.'}
                    </p>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.45rem' }}>
                      Urgency: {selectedIncident.aiAnalysis?.urgency || 'N/A'} • Confidence: {selectedIncident.aiAnalysis?.confidence ? `${Math.round(selectedIncident.aiAnalysis.confidence * 100)}%` : 'N/A'}
                    </div>
                    {selectedIncident.requiredResources?.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        {selectedIncident.requiredResources.map((item, idx) => (
                          <div key={`${item.resource}-${idx}`} style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            • {item.resource}: <strong style={{ color: 'var(--text-primary)' }}>{item.quantity}</strong> ({item.priority || 'medium'})
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>No predicted resource list available yet.</p>
                    )}
                    {selectedIncident.lastEvidencePhotoUrl && (
                      <a href={selectedIncident.lastEvidencePhotoUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: '0.55rem', fontSize: '0.72rem', color: 'var(--primary)' }}>
                        View latest incident evidence photo
                      </a>
                    )}

                    <div style={{ marginTop: '0.75rem', paddingTop: '0.65rem', borderTop: '1px solid var(--border-light)' }}>
                      <strong style={{ fontSize: '0.78rem' }}>Evidence Verification</strong>
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        Verdict: <strong style={{ color: selectedIncident.evidenceVerification?.verdict === 'fake' ? 'var(--danger)' : selectedIncident.evidenceVerification?.verdict === 'suspicious' ? 'var(--warning)' : 'var(--success)' }}>{selectedIncident.evidenceVerification?.verdict || 'N/A'}</strong>
                        {' '}• Risk: {selectedIncident.evidenceVerification?.riskScore ?? 'N/A'} / 100
                      </p>
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {selectedIncident.evidenceVerification?.reason || 'No evidence verification data yet.'}
                      </p>
                    </div>
                  </div>

                  <h4 style={{ fontFamily: 'var(--font-serif)',  marginTop: '1.5rem', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
                    Assign NGOs ({selectedIncident.assignedNGOs?.length || 0} assigned)
                  </h4>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
                    <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      Showing {ngosForAssignment.length} of {nearestNgos.length} NGOs
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => setShowNearestOnly((prev) => !prev)}
                      >
                        {showNearestOnly ? 'Show All NGOs' : 'Nearest 5 Only'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={Boolean(autoAssigningIncidentId)}
                        onClick={() => {
                          const liveIncident = incidents.find((i) => i.id === selectedIncident.id) || selectedIncident;
                          handleAutoAssignModel(liveIncident);
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        {autoAssigningIncidentId === selectedIncident.id
                          ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, borderColor: 'var(--text-light)', borderTopColor: 'transparent' }} /> Auto assigning...</>
                          : 'Auto Assign (Model)'}
                      </button>
                    </div>
                  </div>
                  <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
                    NGOs are sorted by nearest distance to this incident location.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {ngosForAssignment.map(ngo => {
                      // Read live assignment state from incidents array, not stale selectedIncident snapshot
                      const liveIncident = incidents.find(i => i.id === selectedIncident.id) || selectedIncident;
                      const assigned = liveIncident.assignedNGOs?.includes(ngo.id);
                      const resolved = liveIncident.resolvedNGOs?.includes(ngo.id);
                      const isAssigning = assigningNgoId === ngo.id;
                      const etaLabel = estimateEtaFromDistanceKm(ngo.distanceKm);
                      return (
                        <div key={ngo.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.65rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)' }}>
                          <div>
                            <strong style={{ fontSize: '0.82rem' }}>{ngo.name}</strong>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>ID: {ngo.ngoId} • 🍲{ngo.inventory?.food || 0} 👕{ngo.inventory?.clothes || 0} 📦{ngo.inventory?.supplies || 0}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              {ngo.distanceKm != null ? `Distance: ${ngo.distanceKm.toFixed(1)} km` : 'Distance unavailable'} • 📍 {ngo.city || 'N/A'}
                            </div>
                            {assigned && etaLabel && (
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                🕒 Predicted arrival: ~{etaLabel}
                              </div>
                            )}
                          </div>
                          {resolved ? (
                            <span style={{ fontSize: '0.72rem', color: 'var(--success)', fontWeight: 600 }}>✅ Resolved</span>
                          ) : assigned ? (
                            <span style={{ fontSize: '0.72rem', color: 'var(--warning)', fontWeight: 600 }}>⏳ Assigned</span>
                          ) : (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleAssign(ngo.id)}
                              disabled={Boolean(assigningNgoId)}
                              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                              {isAssigning
                                ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, borderColor: 'var(--text-light)', borderTopColor: 'transparent' }} /> Assigning...</>
                                : 'Assign'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="empty-state" style={{ height: '100%' }}><AlertCircle size={48} /><p>Select an incident to view details and assign NGOs</p></div>
              )}
            </div>
          </div>
        )}

        {/* NGOs */}
        {activeTab === 'ngos' && (
          <div className="fade-in">
            <h3 style={{ fontFamily: 'var(--font-serif)',  marginBottom: '1rem' }}>🏢 Registered NGOs ({ngos.length})</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
              {ngos.map(ngo => (
                <div key={ngo.id} className="card" style={{ padding: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <strong>{ngo.name}</strong>
                    <span className="role-badge" style={{ fontSize: '0.65rem' }}>{ngo.ngoId}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.78rem' }}>
                    <div style={{ background: 'var(--bg-secondary)', padding: '0.5rem', borderRadius: 'var(--radius-sm)' }}>🍲 Food: <strong>{ngo.inventory?.food || 0}</strong></div>
                    <div style={{ background: 'var(--bg-secondary)', padding: '0.5rem', borderRadius: 'var(--radius-sm)' }}>👕 Clothes: <strong>{ngo.inventory?.clothes || 0}</strong></div>
                    <div style={{ background: 'var(--bg-secondary)', padding: '0.5rem', borderRadius: 'var(--radius-sm)' }}>📦 Supplies: <strong>{ngo.inventory?.supplies || 0}</strong></div>
                    <div style={{ background: 'var(--bg-secondary)', padding: '0.5rem', borderRadius: 'var(--radius-sm)' }}>🏥 Medical: <strong>{ngo.inventory?.medical || 0}</strong></div>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                    📞 {ngo.phone || 'N/A'} • 📍 {ngo.city || 'N/A'}
                  </div>
                  <div style={{ marginTop: '0.75rem', paddingTop: '0.65rem', borderTop: '1px solid var(--border-light)' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                      Volunteers: {volunteersByNgo[ngo.id]?.length || 0}
                    </div>
                    {volunteersByNgo[ngo.id]?.length > 0 ? (
                      <div style={{ marginTop: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        {volunteersByNgo[ngo.id].slice(0, 3).map((volunteer) => (
                          <span key={volunteer.id} style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            • {volunteer.name || 'Volunteer'}
                          </span>
                        ))}
                        {volunteersByNgo[ngo.id].length > 3 && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            +{volunteersByNgo[ngo.id].length - 3} more
                          </span>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                        No volunteers linked yet.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VOLUNTEERS */}
        {activeTab === 'volunteers' && (
          <div className="fade-in">
            <h3 style={{ fontFamily: 'var(--font-serif)',  marginBottom: '1rem' }}>👥 All Volunteers ({allVolunteers.length})</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {volunteerGroups.map((group) => (
                <div key={group.id} className="card" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <strong style={{ fontSize: '0.9rem' }}>{group.name}</strong>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{group.volunteers.length} volunteers</span>
                  </div>
                  {group.volunteers.length === 0 ? (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No volunteers in this NGO yet.</p>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.65rem' }}>
                      {group.volunteers.map((v) => (
                        <div key={v.id} style={{ padding: '0.8rem', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)' }}>
                          <strong style={{ fontSize: '0.86rem' }}>{v.name}</strong>
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 4 }}>🛠 {v.skills || 'General'}</div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>📍 {v.city || 'N/A'} • 📞 {v.phone || 'N/A'} • {v.availability || 'Available'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
      </div>
    </div>
  );
}
