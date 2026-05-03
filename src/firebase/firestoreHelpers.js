import { db } from './config';
import {
  collection, addDoc, updateDoc, doc, arrayUnion, serverTimestamp,
  query, where, getDocs, getDoc
} from 'firebase/firestore';

function stableHash(input = '') {
  let hash = 0;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function deriveNgoInventory(ngo, index = 0, total = 1) {
  const seed = stableHash(`${ngo?.id || ''}|${ngo?.name || ''}|${ngo?.city || ''}|${index}|${total}`);
  const volunteerCount = Array.isArray(ngo?.volunteers) ? ngo.volunteers.length : Number(ngo?.volunteerCount) || 0;
  const donationCount = Number(ngo?.donationCount) || 0;
  const locationBoost = Number.isFinite(Number(ngo?.location?.lat)) && Number.isFinite(Number(ngo?.location?.lng)) ? 6 : 0;

  const baseStock = 28
    + (seed % 18)
    + Math.min(18, volunteerCount * 2)
    + Math.min(10, donationCount * 2)
    + locationBoost;

  const spread = (seed % 11) + (index % 5);
  const food = Math.max(12, Math.round(baseStock * 1.22 + spread));
  const clothes = Math.max(10, Math.round(baseStock * 1.01 + ((seed >> 2) % 8)));
  const supplies = Math.max(14, Math.round(baseStock * 1.16 + ((seed >> 4) % 10)));
  const medical = Math.max(8, Math.round(baseStock * 0.78 + Math.max(2, Math.ceil(volunteerCount * 1.5)) + ((seed >> 6) % 5)));

  return { food, clothes, supplies, medical };
}

const DISASTER_BASE_SEVERITY = {
  Flood: 35,
  Fire: 48,
  Earthquake: 55,
  Cyclone: 50,
  Landslide: 45,
  'Medical Emergency': 42,
  'Hunger Crisis': 36,
};

const URGENCY_WEIGHT = {
  low: 0,
  medium: 8,
  high: 16,
  critical: 24,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateSeverityScore({ reportCount, disasterType, aiAnalysis, requiredResources }) {
  const base = DISASTER_BASE_SEVERITY[disasterType] ?? 32;
  const reports = Number(reportCount) || 1;
  const reportImpact = clamp(Math.floor((reports - 1) * 4), 0, 35);

  const urgency = String(aiAnalysis?.urgency || 'medium').toLowerCase();
  const urgencyImpact = URGENCY_WEIGHT[urgency] ?? URGENCY_WEIGHT.medium;

  const confidence = clamp(Number(aiAnalysis?.confidence) || 0, 0, 1);
  const confidenceImpact = Math.round(confidence * 10);

  const resources = Array.isArray(requiredResources) ? requiredResources : [];
  const resourceImpactRaw = resources.slice(0, 8).reduce((sum, item) => {
    const quantity = Math.max(0, Number(item?.quantity) || 0);
    const priority = String(item?.priority || 'medium').toLowerCase();
    const priorityScore = priority === 'critical' ? 4 : priority === 'high' ? 3 : priority === 'low' ? 1 : 2;
    const quantityScore = clamp(Math.round(quantity / 40), 0, 4);
    return sum + priorityScore + quantityScore;
  }, 0);
  const resourceImpact = clamp(resourceImpactRaw, 0, 22);

  return clamp(Math.round(base + reportImpact + urgencyImpact + confidenceImpact + resourceImpact), 5, 100);
}

// ---- REPORTS & INCIDENTS ----
export async function submitCitizenReport(citizenId, disasterType, location, title, existingIncidents, options = {}) {
  const { evidencePhotoUrl = null, aiAnalysis = null, requiredResources = [], evidenceVerification = null } = options;

  const toRadians = (deg) => (deg * Math.PI) / 180;
  const distanceKm = (from, to) => {
    const fromLat = Number(from?.lat);
    const fromLng = Number(from?.lng);
    const toLat = Number(to?.lat);
    const toLng = Number(to?.lng);
    if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) return Number.POSITIVE_INFINITY;

    const earthRadiusKm = 6371;
    const dLat = toRadians(toLat - fromLat);
    const dLng = toRadians(toLng - fromLng);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
  };

  // Merge into nearest existing incident if reported within 10km and same disaster type.
  let nearestIncident = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const inc of existingIncidents) {
    if (!inc.location) continue;
    if (inc.disasterType !== disasterType) continue;
    const km = distanceKm(inc.location, location);
    if (km <= 10 && km < nearestDistance) {
      nearestIncident = inc;
      nearestDistance = km;
    }
  }

  if (nearestIncident) {
    const nextReportCount = (nearestIncident.reportCount || 1) + 1;
    const mergedAiAnalysis = aiAnalysis || nearestIncident.aiAnalysis || null;
    const mergedResources = requiredResources?.length ? requiredResources : (nearestIncident.requiredResources || []);
    const mergedVerification = evidenceVerification || nearestIncident.evidenceVerification || null;
    const nextSeverity = calculateSeverityScore({
      reportCount: nextReportCount,
      disasterType,
      aiAnalysis: mergedAiAnalysis,
      requiredResources: mergedResources,
    });

    await updateDoc(doc(db, 'incidents', nearestIncident.id), {
      reportCount: nextReportCount,
      severityScore: nextSeverity,
      modelSeverityScore: nextSeverity,
      lastEvidencePhotoUrl: evidencePhotoUrl,
      aiAnalysis: mergedAiAnalysis,
      requiredResources: mergedResources,
      evidenceVerification: mergedVerification,
    });
    await addDoc(collection(db, 'reports'), {
      citizenId,
      disasterType,
      location,
      incidentId: nearestIncident.id,
      evidencePhotoUrl,
      aiAnalysis,
      requiredResources,
      evidenceVerification,
      createdAt: serverTimestamp(),
    });
    return nearestIncident.id;
  }

  // Create new incident
  const initialSeverity = calculateSeverityScore({
    reportCount: 1,
    disasterType,
    aiAnalysis,
    requiredResources,
  });

  const incRef = await addDoc(collection(db, 'incidents'), {
    title, disasterType, location,
    reportCount: 1, severityScore: initialSeverity,
    modelSeverityScore: initialSeverity,
    assignedNGOs: [], resolvedNGOs: [],
    lastEvidencePhotoUrl: evidencePhotoUrl,
    aiAnalysis,
    requiredResources,
    evidenceVerification,
    createdAt: serverTimestamp(),
  });
  await addDoc(collection(db, 'reports'), {
    citizenId,
    disasterType,
    location,
    incidentId: incRef.id,
    evidencePhotoUrl,
    aiAnalysis,
    requiredResources,
    evidenceVerification,
    createdAt: serverTimestamp(),
  });
  return incRef.id;
}

// ---- NGO ASSIGNMENT ----
export async function assignNGOToIncident(incidentId, ngoId) {
  await updateDoc(doc(db, 'incidents', incidentId), {
    assignedNGOs: arrayUnion(ngoId),
  });
}

function normalizeLocationPoint(value) {
  if (!value) return null;
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.longitude ?? value?.lon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };

  const nested = value.location || value.geo || value.coords;
  if (!nested) return null;
  const nestedLat = Number(nested?.lat ?? nested?.latitude);
  const nestedLng = Number(nested?.lng ?? nested?.longitude ?? nested?.lon);
  if (Number.isFinite(nestedLat) && Number.isFinite(nestedLng)) return { lat: nestedLat, lng: nestedLng };
  return null;
}

function haversineDistanceKm(from, to) {
  const source = normalizeLocationPoint(from);
  const target = normalizeLocationPoint(to);
  if (!source || !target) return null;

  const toRadians = (deg) => (deg * Math.PI) / 180;
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

function mapResourceToInventoryField(resourceName = '') {
  const key = String(resourceName).toLowerCase();
  if (key.includes('food') || key.includes('meal') || key.includes('ration')) return 'food';
  if (key.includes('cloth') || key.includes('blanket') || key.includes('wear')) return 'clothes';
  if (key.includes('med') || key.includes('first aid') || key.includes('medicine')) return 'medical';
  if (key.includes('water') || key.includes('shelter') || key.includes('rescue') || key.includes('supply') || key.includes('tool')) return 'supplies';
  return null;
}

function priorityMultiplier(priority = 'medium') {
  const p = String(priority).toLowerCase();
  if (p === 'critical') return 1.6;
  if (p === 'high') return 1.3;
  if (p === 'low') return 0.8;
  return 1;
}

function buildDemandVector(requiredResources = []) {
  const demand = { food: 0, clothes: 0, supplies: 0, medical: 0 };
  const resources = Array.isArray(requiredResources) ? requiredResources : [];

  resources.forEach((item) => {
    const field = mapResourceToInventoryField(item?.resource);
    if (!field) return;

    const qty = Math.max(1, Number(item?.quantity) || 1);
    const weightedQty = qty * priorityMultiplier(item?.priority);
    demand[field] += weightedQty;
  });

  return demand;
}

function scoreNgoForIncident(incident, ngo) {
  const ngoInventory = ngo?.inventory || {};
  const demand = buildDemandVector(incident?.requiredResources || []);

  const demandEntries = Object.entries(demand).filter(([, needed]) => needed > 0);
  const hasDemandData = demandEntries.length > 0;

  const resourceFit = hasDemandData ? (() => {
    const totalDemand = demandEntries.reduce((sum, [, needed]) => sum + needed, 0);
    const fulfilled = demandEntries.reduce((sum, [field, needed]) => {
      const available = Math.max(0, Number(ngoInventory[field]) || 0);
      return sum + Math.min(available, needed);
    }, 0);
    return clamp(totalDemand > 0 ? fulfilled / totalDemand : 0, 0, 1);
  })() : (() => {
    const totalInventory = ['food', 'clothes', 'supplies', 'medical'].reduce(
      (sum, field) => sum + Math.max(0, Number(ngoInventory[field]) || 0),
      0
    );
    return clamp(totalInventory / 800, 0, 1);
  })();

  const distance = haversineDistanceKm(incident?.location || incident, ngo);
  const distanceScore = distance == null ? 0.25 : clamp(1 - distance / 250, 0, 1);

  const inventoryCapacity = ['food', 'clothes', 'supplies', 'medical'].reduce(
    (sum, field) => sum + Math.max(0, Number(ngoInventory[field]) || 0),
    0
  );
  const capacityScore = clamp(inventoryCapacity / 1000, 0, 1);

  // Model weights: prioritize resource fit, then proximity, then general capacity.
  const score = resourceFit * 0.68 + distanceScore * 0.27 + capacityScore * 0.05;

  return {
    ngoId: ngo.id,
    score,
    distanceKm: distance,
    resourceFit,
    distanceScore,
    capacityScore,
  };
}

function getRecommendedNgoCount(incident, availableNgoCount) {
  const severity = Number(incident?.severityScore) || 0;
  const requiredResources = Array.isArray(incident?.requiredResources) ? incident.requiredResources.length : 0;

  let count = 1;
  if (severity >= 75) count = 3;
  else if (severity >= 45) count = 2;

  if (requiredResources >= 6) count += 1;
  return Math.max(1, Math.min(count, Math.max(1, availableNgoCount)));
}

export async function autoAssignNGOsForIncidentModel(incident, ngos, options = {}) {
  if (!incident?.id) throw new Error('Incident is required for auto-assignment.');

  const currentAssigned = Array.isArray(incident.assignedNGOs) ? incident.assignedNGOs : [];
  const candidates = (Array.isArray(ngos) ? ngos : [])
    .filter((ngo) => ngo?.id)
    .filter((ngo) => !currentAssigned.includes(ngo.id));

  if (candidates.length === 0) {
    return { assignedNgoIds: [], recommendedNgoIds: [], scored: [] };
  }

  const scored = candidates
    .map((ngo) => ({ ngo, ...scoreNgoForIncident(incident, ngo) }))
    .sort((a, b) => b.score - a.score);

  const recommendedCount = options.maxAssignCount || getRecommendedNgoCount(incident, scored.length);
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 0.25;

  let recommended = scored
    .filter((row) => row.score >= minScore)
    .slice(0, recommendedCount);

  if (recommended.length === 0 && scored.length > 0) {
    recommended = scored.slice(0, 1);
  }

  const recommendedNgoIds = recommended.map((row) => row.ngo.id);
  if (recommendedNgoIds.length > 0) {
    await updateDoc(doc(db, 'incidents', incident.id), {
      assignedNGOs: arrayUnion(...recommendedNgoIds),
    });
  }

  return {
    assignedNgoIds: recommendedNgoIds,
    recommendedNgoIds,
    scored: scored.map((row) => ({
      ngoId: row.ngo.id,
      score: row.score,
      distanceKm: row.distanceKm,
      resourceFit: row.resourceFit,
    })),
  };
}

export async function markSituationUnderControl(incidentId, ngoId, totalAssigned) {
  const incSnap = await getDoc(doc(db, 'incidents', incidentId));
  if (!incSnap.exists()) return;
  const data = incSnap.data();
  const resolved = [...(data.resolvedNGOs || [])];
  if (!resolved.includes(ngoId)) resolved.push(ngoId);
  const total = totalAssigned || data.assignedNGOs?.length || 1;
  const newSeverity = Math.max(0, Math.floor(100 - (resolved.length / total) * 100));
  await updateDoc(doc(db, 'incidents', incidentId), {
    resolvedNGOs: resolved,
    severityScore: newSeverity,
  });
}

// ---- TASKS ----
export async function assignTask(ngoId, volunteerId, incidentId, description) {
  const volunteerRef = doc(db, 'users', volunteerId);
  const volunteerSnap = await getDoc(volunteerRef);
  if (!volunteerSnap.exists()) throw new Error('Volunteer not found');

  const volunteerData = volunteerSnap.data();
  if (volunteerData.role !== 'volunteer') throw new Error('Selected user is not a volunteer');

  // Soft check: warn if volunteer is not in this NGO, but still allow admin overrides
  // (joinedNgoId may not be set if volunteer hasn't explicitly joined yet)
  if (volunteerData.joinedNgoId && volunteerData.joinedNgoId !== ngoId) {
    throw new Error(`This volunteer has already joined a different NGO (${volunteerData.joinedNgoName || volunteerData.joinedNgoId}). Ask them to leave first.`);
  }

  return await addDoc(collection(db, 'tasks'), {
    ngoId, volunteerId, incidentId, description,
    status: 'pending', createdAt: serverTimestamp(),
  });
}

export async function markTaskComplete(taskId) {
  await updateDoc(doc(db, 'tasks', taskId), { status: 'completed' });
}

// ---- INVENTORY ----
export async function updateInventory(userId, field, value) {
  const ref = doc(db, 'users', userId);
  await updateDoc(ref, { [`inventory.${field}`]: Math.max(0, value) });
}

export async function assignLogicalInventoriesToNgos(ngos = []) {
  const list = Array.isArray(ngos) ? ngos.filter((ngo) => ngo?.id) : [];
  if (list.length === 0) return [];

  const allocations = list.map((ngo, index) => ({
    ngoId: ngo.id,
    inventory: deriveNgoInventory(ngo, index, list.length),
  }));

  await Promise.all(allocations.map(({ ngoId, inventory }) => updateDoc(doc(db, 'users', ngoId), { inventory })));
  return allocations;
}

export async function updateUserLocation(userId, location) {
  const ref = doc(db, 'users', userId);
  await updateDoc(ref, {
    location,
    lat: location?.lat ?? null,
    lng: location?.lng ?? null,
  });
}

// ---- DONATIONS ----
export async function createDonation(userId, userName, amount, incidentId, message) {
  return await addDoc(collection(db, 'donations'), {
    userId, userName, amount: Number(amount),
    incidentId: incidentId || null,
    message: message || '',
    createdAt: serverTimestamp(),
  });
}

// ---- VOLUNTEER REGISTRATION (citizen -> volunteer) ----
export async function registerCitizenAsVolunteer(uid, skills) {
  await updateDoc(doc(db, 'users', uid), {
    role: 'volunteer',
    skills: skills || 'General Support',
  });
}

export async function joinVolunteerToNGO(volunteerId, ngoId, ngoName) {
  await updateDoc(doc(db, 'users', volunteerId), {
    joinedNgoId: ngoId,
    joinedNgoName: ngoName || '',
    joinedNgoAt: serverTimestamp(),
  });
}

export async function leaveVolunteerNGO(volunteerId) {
  await updateDoc(doc(db, 'users', volunteerId), {
    joinedNgoId: null,
    joinedNgoName: null,
    joinedNgoAt: null,
  });
}

// ---- AI CRISIS SCAN ----
/**
 * Saves AI-generated crisis reports to Firestore `incidents` collection.
 * Skips any incident whose title already exists (case-insensitive) to avoid
 * re-saving the same event on repeated scans.
 *
 * @param {Array} aiIncidents - Normalized objects from crisisScanner.js
 * @returns {Array} - The saved incidents, each with a real Firestore `id`
 */
export async function saveAIIncidentsToFirestore(aiIncidents) {
  if (!Array.isArray(aiIncidents) || aiIncidents.length === 0) return [];

  // Fetch existing incident titles to detect duplicates
  const existingSnap = await getDocs(
    query(collection(db, 'incidents'), where('aiGenerated', '==', true))
  );
  const existingTitles = new Set(
    existingSnap.docs.map((d) => String(d.data().title || '').toLowerCase().trim())
  );

  const saved = [];

  for (const incident of aiIncidents) {
    const titleKey = String(incident.title || '').toLowerCase().trim();

    // Skip if already saved in a previous scan
    if (existingTitles.has(titleKey)) continue;

    // Strip the temporary client-side id before writing
    const firestoreData = { ...incident };
    delete firestoreData._clientId;

    const ref = await addDoc(collection(db, 'incidents'), {
      ...firestoreData,
      modelSeverityScore: Number.isFinite(Number(firestoreData.severityScore))
        ? Number(firestoreData.severityScore)
        : null,
      createdAt: serverTimestamp(),
    });

    existingTitles.add(titleKey); // Prevent duplicates within the same batch
    saved.push({ id: ref.id, ...firestoreData });
  }

  return saved;
}
