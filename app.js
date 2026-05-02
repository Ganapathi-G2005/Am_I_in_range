/* ═══════════════════════════════════════════════════════
   HLB FIELD VERIFIER — app.js
   Census 2027 | Andhra Pradesh
═══════════════════════════════════════════════════════ */

'use strict';

/* ── Constants ───────────────────────────────────────── */
const HLB_ID       = 'HLB-0050';
const HLB_CENTER   = [17.685025, 83.010142];
const DEFAULT_ZOOM = 16;
const LS_KEY       = 'hlb_0050_polygon_v1';
const CHECK_INTERVAL_MS = 5000;

/* ── State ────────────────────────────────────────────── */
const state = {
  map: null,
  userMarker: null,
  hlbCenterMarker: null,
  userPosition: null,            // { lat, lng, accuracy, altitude }
  polygon: null,                 // Leaflet polygon layer
  polygonCoords: [],             // [ [lat,lng], ... ]
  isDrawing: false,
  drawVertices: [],              // temp vertices while drawing
  drawPolyline: null,            // preview polyline
  drawMarkers: [],               // vertex dot markers
  currentLayer: 'satellite',     // 'satellite' | 'street'
  statusCheckTimer: null,
  gpsWatchId: null,
  tileLayer: null,
};

/* ── DOM Refs ────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const UI = {
  map:               $('map'),
  statusBanner:      $('statusBanner'),
  statusIcon:        $('statusIcon'),
  statusText:        $('statusText'),
  gpsAccuracy:       $('gpsAccuracy'),
  gpsPulse:          $('gpsPulse'),
  infoPanel:         $('infoPanel'),
  infoToggleBtn:     $('infoToggleBtn'),
  infoPanelClose:    $('infoPanelClose'),
  btnDraw:           $('btnDraw'),
  btnClose:          $('btnClose'),
  btnSave:           $('btnSave'),
  btnClear:          $('btnClear'),
  btnNavigate:       $('btnNavigate'),
  btnLayer:          $('btnLayer'),
  coordLat:          $('coordLat'),
  coordLng:          $('coordLng'),
  coordAlt:          $('coordAlt'),
  toast:             $('toast'),
  gpsOverlay:        $('gpsOverlay'),
  drawModeIndicator: $('drawModeIndicator'),
};

/* ═══════════════════════════════════════════════════════
   TILE LAYER CONFIGS
═══════════════════════════════════════════════════════ */
const TILE_LAYERS = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri — Source: Esri, USGS, NOAA',
    maxZoom: 19,
    label: 'SAT',
  },
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    label: 'MAP',
  },
};

/* ═══════════════════════════════════════════════════════
   INITIALIZE MAP
═══════════════════════════════════════════════════════ */
function initMap() {
  state.map = L.map('map', {
    center: HLB_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: true,
    attributionControl: true,
    doubleClickZoom: false,    // we use dbl-click for polygon close
    tapTolerance: 15,
  });

  // Position zoom controls
  state.map.zoomControl.setPosition('bottomright');

  // Add satellite tile layer
  applySatelliteLayer();

  // HLB Center Marker
  addHlbCenterMarker();

  // Map click handler
  state.map.on('click', onMapClick);
  state.map.on('dblclick', onMapDblClick);

  // Load saved polygon
  loadSavedPolygon();

  // Start GPS
  initGPS();

  // Status check loop
  startStatusCheck();
}

/* ── Tile Layers ─────────────────────────────────────── */
function applySatelliteLayer() {
  if (state.tileLayer) state.map.removeLayer(state.tileLayer);
  const cfg = TILE_LAYERS.satellite;
  state.tileLayer = L.tileLayer(cfg.url, {
    attribution: cfg.attribution,
    maxZoom: cfg.maxZoom,
  }).addTo(state.map);
  state.currentLayer = 'satellite';
}

function applyStreetLayer() {
  if (state.tileLayer) state.map.removeLayer(state.tileLayer);
  const cfg = TILE_LAYERS.street;
  state.tileLayer = L.tileLayer(cfg.url, {
    attribution: cfg.attribution,
    maxZoom: cfg.maxZoom,
    className: 'map-dark-filter',
  }).addTo(state.map);
  state.currentLayer = 'street';
}

/* ── HLB Center Marker ───────────────────────────────── */
function addHlbCenterMarker() {
  const icon = L.divIcon({
    className: '',
    html: `<div class="hlb-center-pin" title="HLB 0050 Center">⊕</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -22],
  });

  state.hlbCenterMarker = L.marker(HLB_CENTER, { icon, zIndexOffset: 500 })
    .addTo(state.map)
    .bindPopup(`
      <div style="font-family:'Share Tech Mono',monospace;font-size:12px;line-height:1.7;color:#0a0f1a">
        <strong>HLB 0050 — CENTER</strong><br>
        17.685025°N, 83.010142°E<br>
        Ward 0081 · GVMC · Anakapalli
      </div>
    `, { className: 'hlb-popup' });
}

/* ═══════════════════════════════════════════════════════
   GPS / GEOLOCATION
═══════════════════════════════════════════════════════ */
function initGPS() {
  if (!('geolocation' in navigator)) {
    setStatus('unknown', '◌', 'GPS not supported on this device');
    showToast('⚠️ Geolocation not supported', 'warn');
    return;
  }

  setStatus('acquiring', '⏳', 'Acquiring GPS signal…');
  UI.gpsPulse.classList.remove('no-fix');

  state.gpsWatchId = navigator.geolocation.watchPosition(
    onGpsSuccess,
    onGpsError,
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    }
  );
}

function onGpsSuccess(pos) {
  const { latitude: lat, longitude: lng, accuracy, altitude } = pos.coords;

  state.userPosition = { lat, lng, accuracy, altitude };

  // Update accuracy badge
  UI.gpsAccuracy.textContent = `±${Math.round(accuracy)}m`;
  UI.gpsPulse.classList.remove('no-fix');

  // Update live coords in info panel
  UI.coordLat.textContent = `${lat.toFixed(6)}°N`;
  UI.coordLng.textContent = `${lng.toFixed(6)}°E`;
  UI.coordAlt.textContent = altitude !== null ? `Alt: ${Math.round(altitude)}m` : 'Alt: N/A';

  // Update / create user marker
  updateUserMarker(lat, lng);

  // Immediate status check
  checkInsideOutside();
}

function onGpsError(err) {
  UI.gpsPulse.classList.add('no-fix');
  UI.gpsAccuracy.textContent = '---';
  state.userPosition = null;

  if (err.code === err.PERMISSION_DENIED) {
    UI.gpsOverlay.hidden = false;
    setStatus('unknown', '🚫', 'Location access denied');
  } else if (err.code === err.TIMEOUT) {
    setStatus('acquiring', '⏳', 'GPS signal weak — retrying…');
  } else {
    setStatus('unknown', '⚠️', 'GPS unavailable');
  }
}

/* ── User Location Marker ────────────────────────────── */
function updateUserMarker(lat, lng) {
  const pos = L.latLng(lat, lng);

  if (!state.userMarker) {
    const icon = L.divIcon({
      className: '',
      html: `<div class="user-location-dot"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    state.userMarker = L.marker(pos, { icon, zIndexOffset: 1000 }).addTo(state.map);
  } else {
    state.userMarker.setLatLng(pos);
  }
}

/* ═══════════════════════════════════════════════════════
   INSIDE / OUTSIDE CHECK
═══════════════════════════════════════════════════════ */
function startStatusCheck() {
  clearInterval(state.statusCheckTimer);
  state.statusCheckTimer = setInterval(checkInsideOutside, CHECK_INTERVAL_MS);
}

function checkInsideOutside() {
  if (!state.userPosition) {
    setStatus('acquiring', '⏳', 'Acquiring GPS signal…');
    return;
  }

  if (state.polygonCoords.length < 3) {
    setStatus('no-polygon', '📐', 'Draw boundary to verify position');
    return;
  }

  const inside = pointInPolygon(
    [state.userPosition.lat, state.userPosition.lng],
    state.polygonCoords
  );

  if (inside) {
    setStatus('inside', '✅', 'INSIDE HLB 0050');
  } else {
    setStatus('outside', '⚠️', 'OUTSIDE the block');
  }
}

/* ── Ray-casting Point-in-Polygon ────────────────────── */
function pointInPolygon(point, polygon) {
  const [px, py] = point;
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

/* ═══════════════════════════════════════════════════════
   STATUS BANNER
═══════════════════════════════════════════════════════ */
function setStatus(type, icon, text) {
  UI.statusBanner.className = `status-banner status--${type}`;
  UI.statusIcon.textContent = icon;
  UI.statusText.textContent = text;
}

/* ═══════════════════════════════════════════════════════
   POLYGON DRAW TOOL
═══════════════════════════════════════════════════════ */
function startDrawMode() {
  if (state.isDrawing) {
    cancelDrawMode();
    return;
  }

  state.isDrawing = true;
  state.drawVertices = [];
  UI.btnDraw.classList.add('active');
  UI.btnDraw.querySelector('.tool-btn__label').textContent = 'Cancel';
  UI.btnClose.disabled = true;
  UI.drawModeIndicator.hidden = false;
  state.map.getContainer().style.cursor = 'crosshair';

  showToast('📍 Tap the map to place boundary vertices', 'info');
}

function cancelDrawMode() {
  state.isDrawing = false;
  clearDrawPreview();
  state.drawVertices = [];
  UI.btnDraw.classList.remove('active');
  UI.btnDraw.querySelector('.tool-btn__label').textContent = 'Draw';
  UI.btnClose.disabled = true;
  UI.btnSave.disabled = true;
  UI.drawModeIndicator.hidden = true;
  state.map.getContainer().style.cursor = '';
}

function addDrawVertex(latlng) {
  state.drawVertices.push([latlng.lat, latlng.lng]);
  updateDrawPreview();

  // Enable Close button after 3 vertices
  if (state.drawVertices.length >= 3) {
    UI.btnClose.disabled = false;
  }

  // Show vertex count
  showToast(`📌 Vertex ${state.drawVertices.length} placed`, 'info', 1200);
}

function updateDrawPreview() {
  const verts = state.drawVertices;

  // Remove existing preview
  if (state.drawPolyline) {
    state.map.removeLayer(state.drawPolyline);
    state.drawPolyline = null;
  }
  state.drawMarkers.forEach(m => state.map.removeLayer(m));
  state.drawMarkers = [];

  if (verts.length === 0) return;

  // Draw connecting lines
  if (verts.length > 1) {
    state.drawPolyline = L.polyline(verts, {
      color: '#3b82f6',
      weight: 2,
      dashArray: '6 4',
      opacity: 0.85,
    }).addTo(state.map);
  }

  // Draw vertex markers
  verts.forEach((v, i) => {
    const icon = L.divIcon({
      className: '',
      html: `<div style="
        width:12px;height:12px;
        background:${i === 0 ? '#f59e0b' : '#3b82f6'};
        border:2px solid white;
        border-radius:50%;
        box-shadow:0 0 6px rgba(59,130,246,0.6);
      "></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
    const m = L.marker(v, { icon, interactive: false }).addTo(state.map);
    state.drawMarkers.push(m);
  });
}

function clearDrawPreview() {
  if (state.drawPolyline) {
    state.map.removeLayer(state.drawPolyline);
    state.drawPolyline = null;
  }
  state.drawMarkers.forEach(m => state.map.removeLayer(m));
  state.drawMarkers = [];
}

function closePolygon() {
  if (state.drawVertices.length < 3) {
    showToast('⚠️ Need at least 3 vertices to close', 'warn');
    return;
  }

  const coords = [...state.drawVertices];
  cancelDrawMode();
  renderPolygon(coords);
  state.polygonCoords = coords;
  UI.btnSave.disabled = false;
  checkInsideOutside();
  showToast('✅ Boundary closed! Tap Save to persist.', 'success');
}

/* ── Polygon Rendering ───────────────────────────────── */
function renderPolygon(coords) {
  // Remove old
  if (state.polygon) {
    state.map.removeLayer(state.polygon);
    state.polygon = null;
  }

  state.polygon = L.polygon(coords, {
    color: '#06b6d4',
    weight: 2.5,
    dashArray: '8 5',
    fillColor: 'rgba(6,182,212,0.12)',
    fillOpacity: 1,
    opacity: 0.9,
    interactive: false,
  }).addTo(state.map);

  // Fit map to polygon
  state.map.fitBounds(state.polygon.getBounds(), { padding: [40, 40] });
}

function clearPolygon() {
  if (state.polygon) {
    state.map.removeLayer(state.polygon);
    state.polygon = null;
  }
  state.polygonCoords = [];
  if (state.isDrawing) cancelDrawMode();
  clearDrawPreview();
  localStorage.removeItem(LS_KEY);
  UI.btnSave.disabled = true;
  checkInsideOutside();
  showToast('🗑️ Boundary cleared', 'info');
}

/* ═══════════════════════════════════════════════════════
   LOCALSTORAGE — Save / Load
═══════════════════════════════════════════════════════ */
function saveBoundary() {
  if (state.polygonCoords.length < 3) {
    showToast('⚠️ No boundary to save', 'warn');
    return;
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state.polygonCoords));
    showToast('💾 Boundary saved to device', 'success');
    UI.btnSave.disabled = false;
  } catch (e) {
    showToast('❌ Save failed — storage full?', 'error');
  }
}

function loadSavedPolygon() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const coords = JSON.parse(raw);
    if (!Array.isArray(coords) || coords.length < 3) return;
    state.polygonCoords = coords;
    renderPolygon(coords);
    UI.btnSave.disabled = false;
    showToast('📂 Saved boundary restored', 'info', 3000);
  } catch (e) {
    localStorage.removeItem(LS_KEY);
  }
}

/* ═══════════════════════════════════════════════════════
   MAP EVENT HANDLERS
═══════════════════════════════════════════════════════ */
function onMapClick(e) {
  if (!state.isDrawing) return;
  addDrawVertex(e.latlng);
}

function onMapDblClick(e) {
  if (!state.isDrawing) return;
  // Add the last point then close
  if (state.drawVertices.length >= 2) {
    addDrawVertex(e.latlng);
  }
  closePolygon();
}

/* ═══════════════════════════════════════════════════════
   NAVIGATE — Center on user
═══════════════════════════════════════════════════════ */
function navigateToUser() {
  if (state.userPosition) {
    state.map.setView(
      [state.userPosition.lat, state.userPosition.lng],
      Math.max(state.map.getZoom(), 17),
      { animate: true }
    );
    showToast('📍 Centered on your location', 'info');
  } else {
    showToast('⏳ GPS not acquired yet', 'warn');
  }
}

/* ═══════════════════════════════════════════════════════
   LAYER TOGGLE
═══════════════════════════════════════════════════════ */
function toggleLayer() {
  if (state.currentLayer === 'satellite') {
    applyStreetLayer();
    UI.btnLayer.querySelector('.tool-btn__label').textContent = 'Sat';
    showToast('🗺️ Switched to Street Map', 'info');
  } else {
    applySatelliteLayer();
    UI.btnLayer.querySelector('.tool-btn__label').textContent = 'Layer';
    showToast('🛰️ Switched to Satellite', 'info');
  }
}

/* ═══════════════════════════════════════════════════════
   INFO PANEL TOGGLE
═══════════════════════════════════════════════════════ */
function toggleInfoPanel() {
  const isOpen = UI.infoPanel.classList.toggle('is-open');
  UI.infoPanel.setAttribute('aria-hidden', !isOpen);
}

/* ═══════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
═══════════════════════════════════════════════════════ */
let toastTimer = null;
function showToast(msg, type = 'info', duration = 2500) {
  clearTimeout(toastTimer);
  UI.toast.textContent = msg;
  UI.toast.className = 'toast show';

  // Color variants
  const colors = {
    info:    'rgba(26,34,54,0.96)',
    success: 'rgba(21,44,36,0.96)',
    warn:    'rgba(44,35,16,0.96)',
    error:   'rgba(44,16,16,0.96)',
  };
  UI.toast.style.background = colors[type] || colors.info;

  toastTimer = setTimeout(() => {
    UI.toast.classList.remove('show');
  }, duration);
}

/* ═══════════════════════════════════════════════════════
   EVENT LISTENERS
═══════════════════════════════════════════════════════ */
function bindEvents() {
  UI.btnDraw.addEventListener('click', () => {
    if (state.isDrawing) cancelDrawMode();
    else startDrawMode();
  });

  UI.btnClose.addEventListener('click', closePolygon);

  UI.btnSave.addEventListener('click', saveBoundary);

  UI.btnClear.addEventListener('click', () => {
    if (confirm('Clear the saved boundary? This cannot be undone.')) {
      clearPolygon();
    }
  });

  UI.btnNavigate.addEventListener('click', navigateToUser);

  UI.btnLayer.addEventListener('click', toggleLayer);

  UI.infoToggleBtn.addEventListener('click', toggleInfoPanel);
  UI.infoPanelClose.addEventListener('click', () => {
    UI.infoPanel.classList.remove('is-open');
    UI.infoPanel.setAttribute('aria-hidden', 'true');
  });

  // Close info panel on outside tap (mobile UX)
  document.addEventListener('click', (e) => {
    if (
      UI.infoPanel.classList.contains('is-open') &&
      !UI.infoPanel.contains(e.target) &&
      e.target !== UI.infoToggleBtn &&
      !UI.infoToggleBtn.contains(e.target)
    ) {
      UI.infoPanel.classList.remove('is-open');
      UI.infoPanel.setAttribute('aria-hidden', 'true');
    }
  });

  // Keyboard shortcut: Escape cancels draw mode
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.isDrawing) cancelDrawMode();
    if (e.key === 'Enter' && state.isDrawing && state.drawVertices.length >= 3) closePolygon();
    if (e.key === 'i') toggleInfoPanel();
  });
}

/* ═══════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  bindEvents();

  // Initial status
  setStatus('acquiring', '⏳', 'Acquiring GPS…');
});
