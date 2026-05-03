import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db, storage } from '../firebase/config';
import { collection, onSnapshot, query, where, doc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { MapPin, FileText, Heart, Users, Package, ClipboardList, CheckCircle2, HandHelping, Locate } from 'lucide-react';
import Navbar from '../components/Navbar';
import TabBar from '../components/TabBar';
import MapView from '../components/Map';
import Modal from '../components/Modal';
import SeverityBar from '../components/SeverityBar';
import FloatingAlert from '../components/FloatingAlert';
import DonationForm from '../components/DonationForm';
import { submitCitizenReport, assignNGOToIncident, markSituationUnderControl, assignTask, markTaskComplete, updateInventory, createDonation, registerCitizenAsVolunteer, updateUserLocation, joinVolunteerToNGO, leaveVolunteerNGO } from '../firebase/firestoreHelpers';
import { analyzeIncidentPhoto, verifyIncidentEvidence } from '../services/incidentVision';

const normalizeCoords = (value) => {
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

const estimateEtaFromDistanceKm = (km) => {
  if (!Number.isFinite(km) || km < 0) return null;

  // Rough estimate only: includes dispatch prep plus average on-road speed.
  const averageSpeedKmh = 32;
  const dispatchBufferMinutes = 8;
  const minutes = Math.max(6, Math.round((km / averageSpeedKmh) * 60 + dispatchBufferMinutes));

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
  }

  return `${minutes} min`;
};

export default function Dashboard() {
  const { user, userData, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const role = userData?.role;

  const [incidents, setIncidents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [ngos, setNgos] = useState([]);
  const [activeTab, setActiveTab] = useState('map');
  const [showReportModal, setShowReportModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [userPosition, setUserPosition] = useState(null);
  const [floatingAlert, setFloatingAlert] = useState(null);
  const [inventory, setInventory] = useState(userData?.inventory || { food: 0, clothes: 0, supplies: 0, medical: 0 });
  const [taskForm, setTaskForm] = useState({ volunteerId: '', incidentId: '', description: '' });
  const [myReports, setMyReports] = useState([]);
  const [ngoLocationSaving, setNgoLocationSaving] = useState(false);
  const [manualNgoCoords, setManualNgoCoords] = useState({ lat: '', lng: '' });
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reportAnalysisPreview, setReportAnalysisPreview] = useState(null);
  const [reportVerificationPreview, setReportVerificationPreview] = useState(null);
  const [reportStage, setReportStage] = useState('');
  const [volunteerProfile, setVolunteerProfile] = useState(null);
  const [joiningNgoId, setJoiningNgoId] = useState('');
  const [taskError, setTaskError] = useState('');
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const lastSevereAlertKeyRef = useRef('');

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

  const withTimeout = async (promise, ms, message) => {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) navigate('/');
  }, [user, authLoading, navigate]);

  // Geolocation
  const locateUser = useCallback(() => {
    if (!navigator.geolocation) return;

    const requestLocation = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserPosition([pos.coords.latitude, pos.coords.longitude]),
        () => {},
        { enableHighAccuracy: true }
      );
    };

    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((status) => {
        if (status.state !== 'denied') requestLocation();
      }).catch(() => requestLocation());
      return;
    }

    requestLocation();
  }, []);

  useEffect(() => { locateUser(); }, [locateUser]);

  useEffect(() => {
    if (!reportError) return;
    const timer = setTimeout(() => setReportError(''), 5000);
    return () => clearTimeout(timer);
  }, [reportError]);

  useEffect(() => {
    if (!floatingAlert) return;
    const timer = setTimeout(() => setFloatingAlert(null), 3500);
    return () => clearTimeout(timer);
  }, [floatingAlert]);

  useEffect(() => {
    if (!reportSubmitting) return;
    const watchdog = setTimeout(() => {
      setReportSubmitting(false);
      setReportError('Submission took too long. Please try again.');
      setReportStage('');
    }, 45000);
    return () => clearTimeout(watchdog);
  }, [reportSubmitting]);

  // Realtime incidents
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'incidents'), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setIncidents(data);
      const severe = data.find(i => i.reportCount > 5 && i.severityScore > 50);
      if (!severe) {
        lastSevereAlertKeyRef.current = '';
        return;
      }

      const severeKey = `${severe.id}:${severe.reportCount}:${severe.severityScore}`;
      if (lastSevereAlertKeyRef.current === severeKey) return;

      lastSevereAlertKeyRef.current = severeKey;
      setFloatingAlert(`${severe.reportCount} people reporting ${severe.disasterType} in ${severe.title}!`);
    });
    return () => unsub();
  }, []);

  // Realtime tasks for volunteer or NGO
  useEffect(() => {
    if (!user) return;
    let q;
    if (role === 'volunteer') q = query(collection(db, 'tasks'), where('volunteerId', '==', user.uid));
    else if (role === 'ngo') q = query(collection(db, 'tasks'), where('ngoId', '==', user.uid));
    else return;
    const unsub = onSnapshot(q, (snap) => setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [user, role]);

  // Volunteers for NGO
  useEffect(() => {
    if (role !== 'ngo' || !user) return;
    const q = query(collection(db, 'users'), where('role', '==', 'volunteer'));
    const unsub = onSnapshot(q, (snap) => {
      const ngoName = (userData?.name || '').trim().toLowerCase();
      const matched = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((volunteer) => {
          const byNgoId = volunteer.joinedNgoId === user.uid;
          const byNgoName = !volunteer.joinedNgoId && ngoName && String(volunteer.joinedNgoName || '').trim().toLowerCase() === ngoName;
          return byNgoId || byNgoName;
        });
      setVolunteers(matched);
    });
    return () => unsub();
  }, [role, user, userData?.name]);

  // NGO directory for volunteers
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'users'), where('role', '==', 'ngo'));
    const unsub = onSnapshot(q, (snap) => setNgos(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [user]);

  // Volunteer profile with NGO membership
  useEffect(() => {
    if (role !== 'volunteer' || !user) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) setVolunteerProfile({ id: snap.id, ...snap.data() });
    });
    return () => unsub();
  }, [role, user]);

  // My reports for citizen
  useEffect(() => {
    if (role !== 'citizen' || !user) return;
    const q = query(collection(db, 'reports'), where('citizenId', '==', user.uid));
    const unsub = onSnapshot(q, (snap) => setMyReports(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [role, user]);

  // Sync inventory from userData
  useEffect(() => {
    if (!userData?.inventory) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInventory(userData.inventory);
  }, [userData]);

  useEffect(() => {
    if (role !== 'ngo') return;
    const lat = userData?.location?.lat ?? userData?.lat ?? '';
    const lng = userData?.location?.lng ?? userData?.lng ?? '';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setManualNgoCoords({ lat: String(lat), lng: String(lng) });
  }, [role, userData]);

  // Refresh user doc for inventory updates
  useEffect(() => {
    if (role !== 'ngo' || !user) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) setInventory(snap.data().inventory || {});
    });
    return () => unsub();
  }, [role, user]);

  const handleMapClick = (latlng) => {
    if (role === 'citizen') {
      setReportError('');
      setReportAnalysisPreview(null);
      setReportVerificationPreview(null);
      setReportStage('');
      setSelectedLocation(latlng);
      setShowReportModal(true);
    }
  };

  const handleReport = async (e) => {
    e.preventDefault();
    if (!selectedLocation || !user) return;

    const fd = new FormData(e.target);
    const photoFile = fd.get('incidentPhoto');
    if (!(photoFile instanceof File) || photoFile.size === 0) {
      setReportError('Please upload a live incident photo.');
      return;
    }

    setReportSubmitting(true);
    setReportError('');
    setReportAnalysisPreview(null);
    setReportVerificationPreview(null);
    setReportStage('Analyzing incident image with AI...');

    try {
      const aiResult = await withTimeout(
        analyzeIncidentPhoto({
          imageFile: photoFile,
          disasterType: fd.get('type'),
          title: fd.get('title'),
        }),
        30000,
        'AI analysis timed out. Please retry in a moment.'
      );

      setReportAnalysisPreview(aiResult);

      setReportStage('Verifying image authenticity and category match...');
      const verificationResult = await withTimeout(
        verifyIncidentEvidence({
          imageFile: photoFile,
          disasterType: fd.get('type'),
          title: fd.get('title'),
        }),
        20000,
        'Image verification timed out. Please try again.'
      );
      setReportVerificationPreview(verificationResult);

      if (verificationResult.verdict === 'fake') {
        throw new Error(`Image verification failed: ${verificationResult.reason || 'The uploaded image does not match the reported incident.'}`);
      }

      let photoUrl = null;
      let uploadFailed = false;
      try {
        setReportStage('Uploading incident photo...');
        const safeName = `${Date.now()}-${photoFile.name.replace(/\s+/g, '-')}`;
        const photoRef = ref(storage, `incident-evidence/${user.uid}/${safeName}`);
        await withTimeout(
          uploadBytes(photoRef, photoFile, { contentType: photoFile.type || 'image/jpeg' }),
          15000,
          'Photo upload timed out.'
        );
        photoUrl = await withTimeout(
          getDownloadURL(photoRef),
          10000,
          'Unable to read uploaded photo URL.'
        );
      } catch {
        uploadFailed = true;
      }

      setReportStage('Saving report and resource prediction...');
      await withTimeout(
        submitCitizenReport(
          user.uid,
          fd.get('type'),
          { lat: selectedLocation.lat, lng: selectedLocation.lng },
          fd.get('title'),
          incidents,
          {
            evidencePhotoUrl: photoUrl,
            aiAnalysis: {
              summary: aiResult.summary,
              urgency: aiResult.urgency,
              confidence: aiResult.confidence,
              source: aiResult.source,
              analyzedAt: new Date().toISOString(),
            },
            requiredResources: aiResult.requiredResources,
            evidenceVerification: verificationResult,
          }
        ),
        15000,
        'Report save timed out. Check Firebase rules and internet, then retry.'
      );

      if (uploadFailed) {
        setFloatingAlert('Report submitted, but photo storage failed (CORS). Configure Firebase Storage CORS/rules.');
      }

      setShowReportModal(false);
      setSelectedLocation(null);
      setReportAnalysisPreview(null);
      setReportVerificationPreview(null);
      setReportError('');
      setReportStage('');
    } catch (err) {
      setReportError(err?.message || 'Failed to submit report with AI analysis. Please try again.');
      setReportStage('');
    } finally {
      setReportSubmitting(false);
    }
  };

  const handleSelfAssign = async (incId) => {
    await assignNGOToIncident(incId, user.uid);
  };

  const handleResolve = async (inc) => {
    await markSituationUnderControl(inc.id, user.uid, inc.assignedNGOs?.length);
  };

  const handleAssignTask = async (e) => {
    e.preventDefault();
    setTaskError('');
    setTaskSubmitting(true);
    try {
      await assignTask(user.uid, taskForm.volunteerId, taskForm.incidentId, taskForm.description);
      setShowTaskModal(false);
      setTaskForm({ volunteerId: '', incidentId: '', description: '' });
      setFloatingAlert('Task assigned successfully!');
    } catch (err) {
      setTaskError(err?.message || 'Failed to assign task. Please try again.');
    } finally {
      setTaskSubmitting(false);
    }
  };

  const handleInvUpdate = async (field, delta) => {
    const newVal = Math.max(0, (inventory[field] || 0) + delta);
    setInventory(prev => ({ ...prev, [field]: newVal }));
    await updateInventory(user.uid, field, newVal);
  };

  const handleDonate = async (amount, incidentId, message) => {
    await createDonation(user.uid, userData?.name || 'Anonymous', amount, incidentId, message);
  };

  const handleJoinNgo = async (ngo) => {
    if (!user || role !== 'volunteer') return;
    setJoiningNgoId(ngo.id);
    try {
      await joinVolunteerToNGO(user.uid, ngo.id, ngo.name);
      setFloatingAlert(`You joined ${ngo.name}. You can now receive tasks from this NGO.`);
    } finally {
      setJoiningNgoId('');
    }
  };

  const handleLeaveNgo = async () => {
    if (!user || role !== 'volunteer') return;
    setJoiningNgoId('leave');
    try {
      await leaveVolunteerNGO(user.uid);
      setFloatingAlert('You left your NGO membership.');
    } finally {
      setJoiningNgoId('');
    }
  };

  const handleUseCurrentNgoLocation = () => {
    if (!navigator.geolocation || !user) return;
    setNgoLocationSaving(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        await updateUserLocation(user.uid, next);
        setManualNgoCoords({ lat: String(next.lat), lng: String(next.lng) });
        setNgoLocationSaving(false);
      },
      () => setNgoLocationSaving(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSaveManualNgoLocation = async (e) => {
    e.preventDefault();
    if (!user) return;
    const lat = Number(manualNgoCoords.lat);
    const lng = Number(manualNgoCoords.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setNgoLocationSaving(true);
    await updateUserLocation(user.uid, { lat, lng });
    setNgoLocationSaving(false);
  };

  if (authLoading || !userData) return (
    <div className="app-layout" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
    </div>
  );

  const myAssigned = incidents.filter(i => i.assignedNGOs?.includes(user.uid));
  const ngoById = ngos.reduce((acc, ngo) => {
    acc[ngo.id] = ngo;
    return acc;
  }, {});

  const getIncidentEtaLabel = (incident) => {
    const assignedNgoIds = Array.isArray(incident?.assignedNGOs) ? incident.assignedNGOs : [];
    if (assignedNgoIds.length === 0) return null;

    const incidentCoords = normalizeCoords(incident?.location || incident);
    if (!incidentCoords) return null;

    // For NGO users, prioritize own ETA when assigned.
    if (role === 'ngo' && user?.uid && assignedNgoIds.includes(user.uid)) {
      const selfCoords = normalizeCoords(userData?.location || userData);
      const selfDistance = distanceKm(selfCoords, incidentCoords);
      const selfEta = estimateEtaFromDistanceKm(selfDistance);
      if (selfEta) return selfEta;
    }

    const nearestDistance = assignedNgoIds.reduce((minDistance, ngoId) => {
      const ngoCoords = normalizeCoords(ngoById[ngoId]);
      const km = distanceKm(ngoCoords, incidentCoords);
      if (!Number.isFinite(km)) return minDistance;
      return minDistance == null || km < minDistance ? km : minDistance;
    }, null);

    return estimateEtaFromDistanceKm(nearestDistance);
  };

  const aiIncidents = incidents.filter(i => i.aiGenerated === true);
  const sortedIncidents = [...incidents].sort((a, b) => getModelSeverity(b) - getModelSeverity(a));

  // Tab configs per role
  const tabConfigs = {
    citizen: [
      { id: 'map', label: 'Map', icon: <MapPin size={15} /> },
      { id: 'reports', label: 'My Reports', icon: <FileText size={15} /> },
      { id: 'donate', label: 'Donate', icon: <Heart size={15} /> },
      { id: 'volunteer', label: 'Volunteer', icon: <HandHelping size={15} /> },
    ],
    ngo: [
      { id: 'map', label: 'Map', icon: <MapPin size={15} /> },
      { id: 'inventory', label: 'Inventory', icon: <Package size={15} /> },
      { id: 'volunteers', label: 'Volunteers', icon: <Users size={15} /> },
      { id: 'assignments', label: 'Assignments', icon: <ClipboardList size={15} /> },
      { id: 'donate', label: 'Donations', icon: <Heart size={15} /> },
    ],
    volunteer: [
      { id: 'map', label: 'Map', icon: <MapPin size={15} /> },
      { id: 'ngo', label: 'My NGO', icon: <Users size={15} /> },
      { id: 'tasks', label: 'My Tasks', icon: <ClipboardList size={15} /> },
      { id: 'donate', label: 'Donate', icon: <Heart size={15} /> },
    ],
  };

  return (
    <div className="app-layout">
      <FloatingAlert message={floatingAlert} onClose={() => setFloatingAlert(null)} />
      <TabBar tabs={tabConfigs[role] || tabConfigs.citizen} activeTab={activeTab} onTabChange={setActiveTab} />
      
      <div className="app-main-wrapper">
        <Navbar />
        <main className="app-content">

        {/* ===== MAP TAB ===== */}
        {activeTab === 'map' && (
          <div className="dashboard-map-layout">
            <aside className="dashboard-map-sidebar">

              {role === 'citizen' && (
                <div className="card fade-in">
                  <h4 style={{ fontFamily: 'var(--font-serif)',  fontSize: '0.9rem', marginBottom: '0.5rem' }}>📍 Report Emergency</h4>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Click anywhere on the map to pin a disaster location.</p>
                </div>
              )}

              <div className="card fade-in" style={{ flex: 1, overflowY: 'auto' }}>
                <h4 style={{ fontFamily: 'var(--font-serif)',  fontSize: '0.9rem', marginBottom: '0.55rem' }}>
                  Live Incidents ({sortedIncidents.length})
                  {aiIncidents.length > 0 && (
                    <span style={{ marginLeft: 8, fontSize: '0.7rem', background: 'var(--primary-light)', color: 'var(--primary)', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>
                      🤖 {aiIncidents.length} AI
                    </span>
                  )}
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {sortedIncidents.length === 0 && <p className="empty-state" style={{ padding: '1rem' }}>No incidents reported yet.</p>}
                  {sortedIncidents.map(inc => (
                    (() => {
                      const severity = getModelSeverity(inc);
                      const helpStatus = getIncidentHelpStatus(inc);
                      const etaLabel = getIncidentEtaLabel(inc);
                      return (
                      <div
                        key={inc.id}
                        className={`incident-item ${inc.severityScore === 0 ? 'resolved' : ''}`}
                        style={{
                          borderLeftColor: inc.aiGenerated
                            ? (severity > 75 ? 'var(--primary)' : 'var(--primary)')
                            : (severity > 75 ? 'var(--danger)' : severity > 40 ? 'var(--warning)' : 'var(--success)'),
                          background: inc.aiGenerated ? 'var(--bg-hover)' : undefined,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
                          <strong style={{ fontSize: '0.8rem', lineHeight: 1.3, flex: 1 }}>{inc.title}</strong>
                          <span style={{ fontSize: '0.7rem', color: inc.aiGenerated ? 'var(--primary)' : severity > 75 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 700, marginLeft: 4 }}>{severity}%</span>
                        </div>

                        {inc.aiGenerated && (
                          <span style={{ fontSize: '0.62rem', background: 'var(--primary)', color: 'var(--text-light)', borderRadius: 3, padding: '1px 5px', fontWeight: 700, display: 'inline-block', marginBottom: 4 }}>🤖 AI</span>
                        )}

                        <SeverityBar value={severity} />

                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                          {inc.disasterType}{inc.aiGenerated ? ` • ${inc.level || ''}` : ` • ${inc.reportCount} reports`}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: helpStatus.color, fontWeight: 700, marginTop: 3 }}>
                          🚑 {helpStatus.label}
                        </div>
                        {inc.assignedNGOs?.length > 0 && etaLabel && (
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            🕒 Predicted ETA: ~{etaLabel}
                          </div>
                        )}

                        {/* AI-specific quick stats */}
                        {inc.aiGenerated && (inc.confirmedDeaths > 0 || inc.awaitingRescue > 0 || inc.totalAffected > 0) && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', marginTop: 5, fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                            {inc.confirmedDeaths > 0 && <><span>💀 Deaths</span><span style={{ fontWeight: 600 }}>{inc.confirmedDeaths.toLocaleString('en-IN')}</span></>}
                            {inc.awaitingRescue > 0 && <><span>🔴 Awaiting</span><span style={{ fontWeight: 600 }}>{inc.awaitingRescue.toLocaleString('en-IN')}</span></>}
                            {inc.totalAffected > 0 && <><span>👥 Affected</span><span style={{ fontWeight: 600 }}>{inc.totalAffected.toLocaleString('en-IN')}</span></>}
                            {inc.confirmedRescued > 0 && <><span>🟢 Rescued</span><span style={{ fontWeight: 600 }}>{inc.confirmedRescued.toLocaleString('en-IN')}</span></>}
                          </div>
                        )}

                        {/* AI logistics summary */}
                        {inc.aiGenerated && inc.logistics && (inc.logistics.foodPackets > 0 || inc.logistics.medicalKits > 0) && (
                          <div style={{ marginTop: 4, fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                            🍱 {inc.logistics.foodPackets?.toLocaleString('en-IN')} food • 🏥 {inc.logistics.medicalKits?.toLocaleString('en-IN')} kits
                          </div>
                        )}

                        {role === 'ngo' && !inc.assignedNGOs?.includes(user.uid) && inc.severityScore > 0 && (
                          <button className="btn btn-primary btn-sm w-full mt-1" onClick={() => handleSelfAssign(inc.id)}>Self-Assign</button>
                        )}
                      </div>
                      );
                    })()
                  ))}
                </div>
              </div>
            </aside>
            <section className="dashboard-map-main">
              <MapView incidents={incidents} ngos={ngos} onMapClick={handleMapClick} interactive={role === 'citizen'} userPosition={userPosition} onLocate={locateUser} />
            </section>
          </div>
        )}

        {/* ===== CITIZEN: MY REPORTS ===== */}
        {activeTab === 'reports' && role === 'citizen' && (
          <div className="fade-in" style={{ maxWidth: 700, margin: '0 auto', width: '100%' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)',  marginBottom: '1rem' }}>My Reports ({myReports.length})</h3>
            {myReports.length === 0 && <div className="empty-state"><FileText size={40} /><p>No reports yet. Click on the map to report an incident.</p></div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {myReports.map(r => (
                <div key={r.id} className="card" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{r.disasterType}</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{r.createdAt?.toDate?.()?.toLocaleDateString?.() || 'Just now'}</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>📍 {r.location?.lat?.toFixed(4)}, {r.location?.lng?.toFixed(4)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== CITIZEN: VOLUNTEER REGISTRATION ===== */}
        {activeTab === 'volunteer' && role === 'citizen' && (
          <div className="fade-in" style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}>
            <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
              <HandHelping size={48} color="var(--primary)" style={{ marginBottom: '1rem' }} />
              <h3 style={{ fontFamily: 'var(--font-serif)',  marginBottom: '0.5rem' }}>Become a Volunteer</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Help communities in crisis by joining as a volunteer.</p>
              <form onSubmit={async (e) => { e.preventDefault(); await registerCitizenAsVolunteer(user.uid, new FormData(e.target).get('skills')); window.location.reload(); }}>
                <div className="input-group">
                  <label>Your Skills</label>
                  <input type="text" name="skills" className="input-field" placeholder="Medical, Logistics, Cooking..." required />
                </div>
                <button type="submit" className="btn btn-primary w-full btn-lg">Register as Volunteer</button>
              </form>
            </div>
          </div>
        )}

        {/* ===== NGO: INVENTORY ===== */}
        {activeTab === 'inventory' && role === 'ngo' && (
          <div className="fade-in" style={{ maxWidth: 600, margin: '0 auto', width: '100%' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)',  marginBottom: '1rem' }}>📦 Resource Inventory</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {['food', 'clothes', 'supplies', 'medical'].map(field => (
                <div key={field} className="inv-control">
                  <span className="inv-label" style={{ textTransform: 'capitalize' }}>{field === 'medical' ? '🏥 Medical Kits' : field === 'food' ? '🍲 Food Packets' : field === 'clothes' ? '👕 Clothing Sets' : '📦 Supply Packs'}</span>
                  <button className="inv-btn" onClick={() => handleInvUpdate(field, -10)}>−</button>
                  <span className="inv-value">{inventory[field] || 0}</span>
                  <button className="inv-btn" onClick={() => handleInvUpdate(field, 10)}>+</button>
                </div>
              ))}
            </div>
            <div className="card" style={{ marginTop: '1rem', padding: '1rem' }}>
              <h4 style={{ fontFamily: 'var(--font-serif)',  marginBottom: '0.5rem', fontSize: '0.9rem' }}>📍 Operational Location</h4>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Keep this updated so admins can assign incidents to nearest NGOs.
              </p>
              <button className="btn btn-outline btn-sm w-full" onClick={handleUseCurrentNgoLocation} disabled={ngoLocationSaving}>
                <Locate size={14} /> Use Current Location
              </button>
              <form onSubmit={handleSaveManualNgoLocation} style={{ marginTop: '0.75rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <input
                    type="number"
                    step="any"
                    className="input-field"
                    placeholder="Latitude"
                    value={manualNgoCoords.lat}
                    onChange={(e) => setManualNgoCoords((prev) => ({ ...prev, lat: e.target.value }))}
                  />
                  <input
                    type="number"
                    step="any"
                    className="input-field"
                    placeholder="Longitude"
                    value={manualNgoCoords.lng}
                    onChange={(e) => setManualNgoCoords((prev) => ({ ...prev, lng: e.target.value }))}
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-sm w-full mt-1" disabled={ngoLocationSaving}>Save Coordinates</button>
              </form>
            </div>
          </div>
        )}

        {/* ===== NGO: VOLUNTEERS ===== */}
        {activeTab === 'volunteers' && role === 'ngo' && (
          <div className="fade-in" style={{ maxWidth: 700, margin: '0 auto', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontFamily: 'var(--font-serif)' }}>👥 Volunteers ({volunteers.length})</h3>
              <button className="btn btn-primary btn-sm" onClick={() => { setTaskError(''); setShowTaskModal(true); }}>+ Assign Task</button>
            </div>
            {volunteers.length === 0 && <div className="empty-state"><Users size={40} /><p>No volunteers registered yet. Volunteers must join your NGO first.</p></div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
              {volunteers.map(v => (
                <div key={v.id} className="card" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong style={{ fontSize: '0.9rem' }}>{v.name}</strong>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>🛠 {v.skills || 'General'}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>📍 {v.city || 'N/A'} • {v.availability || 'Available'}</div>
                    </div>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ fontSize: '0.7rem', padding: '4px 8px', whiteSpace: 'nowrap' }}
                      onClick={() => {
                        setTaskError('');
                        setTaskForm(p => ({ ...p, volunteerId: v.id }));
                        setShowTaskModal(true);
                      }}
                    >
                      Assign Task
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== NGO: ASSIGNMENTS ===== */}
        {activeTab === 'assignments' && role === 'ngo' && (
          <div className="fade-in" style={{ maxWidth: 700, margin: '0 auto', width: '100%' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)',  marginBottom: '1rem' }}>📋 My Assigned Incidents ({myAssigned.length})</h3>
            {myAssigned.length === 0 && <div className="empty-state"><ClipboardList size={40} /><p>No assignments yet. Self-assign from the Map tab.</p></div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {myAssigned.map(inc => (
                <div key={inc.id} className="card" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong>{inc.title}</strong>
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: inc.severityScore > 50 ? 'var(--danger)' : 'var(--success)' }}>{inc.severityScore}%</span>
                  </div>
                  <SeverityBar value={inc.severityScore} />
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0' }}>{inc.disasterType} • {inc.reportCount} reports • {inc.assignedNGOs?.length || 0} NGOs</div>
                  {(() => {
                    const etaLabel = getIncidentEtaLabel(inc);
                    if (!etaLabel) return null;
                    return (
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                        🕒 Predicted arrival: ~{etaLabel}
                      </div>
                    );
                  })()}
                  {!inc.resolvedNGOs?.includes(user.uid) ? (
                    <button className="btn btn-success btn-sm w-full" onClick={() => handleResolve(inc)}>
                      <CheckCircle2 size={14} /> Mark Situation Under Control
                    </button>
                  ) : (
                    <div style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={14} /> You marked this resolved</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== VOLUNTEER: MY TASKS ===== */}
        {activeTab === 'tasks' && role === 'volunteer' && (
          <div className="fade-in" style={{ maxWidth: 700, margin: '0 auto', width: '100%' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)',  marginBottom: '1rem' }}>📋 My Tasks ({tasks.length})</h3>
            {tasks.length === 0 && <div className="empty-state"><ClipboardList size={40} /><p>No tasks assigned yet. Your NGO will assign tasks when needed.</p></div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {tasks.map(t => (
                <div key={t.id} className="task-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <strong style={{ fontSize: '0.88rem' }}>{t.description}</strong>
                    <span className={`task-status ${t.status}`}>{t.status}</span>
                  </div>
                  {t.status === 'pending' && (
                    <button className="btn btn-success btn-sm w-full mt-1" onClick={() => markTaskComplete(t.id)}>
                      <CheckCircle2 size={14} /> Mark Complete
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== VOLUNTEER: NGO MEMBERSHIP ===== */}
        {activeTab === 'ngo' && role === 'volunteer' && (
          <div className="fade-in" style={{ maxWidth: 760, margin: '0 auto', width: '100%' }}>
            <div className="card" style={{ padding: '1rem', marginBottom: '0.9rem' }}>
              <h3 style={{ fontFamily: 'var(--font-serif)',  marginBottom: '0.4rem' }}>🏢 NGO Membership</h3>
              {volunteerProfile?.joinedNgoId ? (
                <>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.7rem' }}>
                    Joined NGO: <strong style={{ color: 'var(--text-primary)' }}>{volunteerProfile.joinedNgoName || 'Unknown NGO'}</strong>
                  </p>
                  <button className="btn btn-outline btn-sm" onClick={handleLeaveNgo} disabled={joiningNgoId === 'leave'}>
                    Leave NGO
                  </button>
                </>
              ) : (
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  You are not joined to any NGO yet. Join one below to start receiving tasks.
                </p>
              )}
            </div>

            <h4 style={{ fontFamily: 'var(--font-serif)',  marginBottom: '0.75rem', fontSize: '0.9rem' }}>Available NGOs ({ngos.length})</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
              {ngos.map((ngo) => {
                const isCurrent = volunteerProfile?.joinedNgoId === ngo.id;
                return (
                  <div key={ngo.id} className="card" style={{ padding: '1rem' }}>
                    <strong style={{ fontSize: '0.9rem' }}>{ngo.name}</strong>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 4 }}>
                      📍 {ngo.city || 'N/A'} • 📞 {ngo.phone || 'N/A'}
                    </div>
                    <div style={{ marginTop: '0.7rem' }}>
                      {isCurrent ? (
                        <span style={{ fontSize: '0.74rem', color: 'var(--success)', fontWeight: 600 }}>✅ Joined</span>
                      ) : (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleJoinNgo(ngo)}
                          disabled={Boolean(joiningNgoId) || volunteerProfile?.joinedNgoId === ngo.id}
                        >
                          {joiningNgoId === ngo.id ? 'Joining...' : 'Join NGO'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== DONATE TAB (all roles) ===== */}
        {activeTab === 'donate' && (
          <div className="fade-in" style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}>
            <div className="card" style={{ padding: '1.5rem' }}>
              <h3 style={{ fontFamily: 'var(--font-serif)',  marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Heart size={20} color="var(--danger)" /> Donate for Relief</h3>
              <DonationForm incidents={incidents} onDonate={handleDonate} />
            </div>
          </div>
        )}
      </main>
      </div>

      {/* ===== REPORT MODAL ===== */}
      <Modal
        isOpen={showReportModal}
        onClose={() => {
          setShowReportModal(false);
          setReportError('');
          setReportVerificationPreview(null);
          setReportStage('');
        }}
        title="🚨 Report Emergency"
      >
        <form
          onSubmit={handleReport}
          onChange={() => {
            if (reportError) setReportError('');
          }}
        >
          {reportError && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 'var(--radius-sm)', padding: '0.55rem 0.7rem', fontSize: '0.76rem', marginBottom: '0.75rem' }}>
              {reportError}
            </div>
          )}
          <div className="input-group">
            <label>Disaster Type</label>
            <select name="type" className="input-field">
              <option value="Flood">🌊 Flood</option>
              <option value="Fire">🔥 Fire</option>
              <option value="Earthquake">🏚️ Earthquake</option>
              <option value="Cyclone">🌪️ Cyclone</option>
              <option value="Landslide">⛰️ Landslide</option>
              <option value="Medical Emergency">🏥 Medical Emergency</option>
              <option value="Hunger Crisis">🍽️ Hunger Crisis</option>
            </select>
          </div>
          <div className="input-group">
            <label>Location / Area Name</label>
            <input type="text" name="title" className="input-field" placeholder="e.g. South Chennai, Bihar Patna" required />
          </div>
          <div className="input-group">
            <label>Live Incident Photo (Required)</label>
            <input type="file" name="incidentPhoto" className="input-field" accept="image/*" capture="environment" required />
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
              This image is analyzed by AI to estimate required resources and quantity.
            </p>
          </div>
          {reportSubmitting && reportStage && (
            <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: 'var(--primary)', borderRadius: 'var(--radius-sm)', padding: '0.55rem 0.7rem', fontSize: '0.76rem', marginBottom: '0.75rem' }}>
              {reportStage}
            </div>
          )}
          {reportAnalysisPreview && (
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-sm)', padding: '0.7rem', marginBottom: '0.75rem' }}>
              <strong style={{ fontSize: '0.76rem' }}>AI Resource Estimate ({reportAnalysisPreview.source})</strong>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '4px 0 6px' }}>{reportAnalysisPreview.summary}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {reportAnalysisPreview.requiredResources?.slice(0, 4).map((r, idx) => (
                  <span key={`${r.resource}-${idx}`} style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    • {r.resource}: {r.quantity} ({r.priority})
                  </span>
                ))}
              </div>
            </div>
          )}
          {reportVerificationPreview && (
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-sm)', padding: '0.7rem', marginBottom: '0.75rem' }}>
              <strong style={{ fontSize: '0.76rem' }}>
                Evidence Verification: {reportVerificationPreview.verdict?.toUpperCase?.() || 'UNKNOWN'}
              </strong>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '4px 0 4px' }}>
                {reportVerificationPreview.reason}
              </p>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Risk: {reportVerificationPreview.riskScore ?? 'N/A'} / 100 • Relevance: {reportVerificationPreview.relevanceScore != null ? `${Math.round(reportVerificationPreview.relevanceScore * 100)}%` : 'N/A'} • Confidence: {reportVerificationPreview.confidence != null ? `${Math.round(reportVerificationPreview.confidence * 100)}%` : 'N/A'}
              </div>
            </div>
          )}
          {selectedLocation && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>📍 {selectedLocation.lat.toFixed(4)}, {selectedLocation.lng.toFixed(4)}</p>}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-outline w-full"
              onClick={() => {
                setShowReportModal(false);
                setReportError('');
                setReportVerificationPreview(null);
                setReportStage('');
              }}
              disabled={reportSubmitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-secondary w-full" disabled={reportSubmitting}>
              {reportSubmitting ? 'Analyzing & Submitting...' : 'Report Now'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ===== TASK ASSIGNMENT MODAL (NGO) ===== */}
      <Modal
        isOpen={showTaskModal}
        onClose={() => { setShowTaskModal(false); setTaskError(''); setTaskForm({ volunteerId: '', incidentId: '', description: '' }); }}
        title="📋 Assign Task to Volunteer"
      >
        <form onSubmit={handleAssignTask}>
          {taskError && (
            <div style={{ background: 'var(--danger-light)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.7rem', fontSize: '0.75rem', marginBottom: '0.75rem' }}>
              ⚠️ {taskError}
            </div>
          )}
          <div className="input-group">
            <label>Select Volunteer</label>
            <select
              className="input-field"
              value={taskForm.volunteerId}
              onChange={e => { setTaskError(''); setTaskForm(p => ({ ...p, volunteerId: e.target.value })); }}
              required
            >
              <option value="">Choose volunteer...</option>
              {volunteers.length === 0
                ? <option disabled>No volunteers have joined your NGO yet</option>
                : volunteers.map(v => <option key={v.id} value={v.id}>{v.name} ({v.skills || 'General'})</option>)
              }
            </select>
            {volunteers.length === 0 && (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>Volunteers must first join your NGO from their dashboard.</p>
            )}
          </div>
          <div className="input-group">
            <label>For Incident</label>
            <select
              className="input-field"
              value={taskForm.incidentId}
              onChange={e => { setTaskError(''); setTaskForm(p => ({ ...p, incidentId: e.target.value })); }}
              required
            >
              <option value="">Choose incident...</option>
              {incidents.filter(i => i.severityScore > 0).map(i => (
                <option key={i.id} value={i.id}>
                  {i.title} ({i.disasterType}){myAssigned.some(a => a.id === i.id) ? ' ✔ Assigned to you' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label>Task Description</label>
            <input
              type="text"
              className="input-field"
              placeholder="e.g. Distribute food at Block A, Shelter 3"
              value={taskForm.description}
              onChange={e => { setTaskError(''); setTaskForm(p => ({ ...p, description: e.target.value })); }}
              required
            />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-outline w-full"
              onClick={() => { setShowTaskModal(false); setTaskError(''); setTaskForm({ volunteerId: '', incidentId: '', description: '' }); }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={taskSubmitting || volunteers.length === 0}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              {taskSubmitting
                ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 2, borderColor: 'var(--text-light)', borderTopColor: 'transparent' }} /> Assigning...</>
                : 'Assign Task'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
