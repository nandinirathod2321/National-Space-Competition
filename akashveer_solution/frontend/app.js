// ============================================================
//  AKASHVEER — Space Situational Awareness Dashboard
//  Three.js 3D Orbit Visualization + Pixi.js HUD + API Client
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------- CONFIG ----------
const API_BASE = window.location.origin;
const EARTH_RADIUS = 6378.137;           // km  (real scale)
const SCALE = 1 / 1000;                  // 1 unit = 1000 km
const EARTH_R = EARTH_RADIUS * SCALE;    // ~6.378 units
const SAT_SCALE = 0.06;
const DEBRIS_SCALE = 0.03;

// ---------- UTILITY FUNCTIONS ----------
function subsatellitePoint(pos) {
    // pos = [x, y, z] in km (ECI)
    const [x, y, z] = pos;
    const r = Math.sqrt(x * x + y * y + z * z);
    const lat = Math.asin(z / r) * 180 / Math.PI;
    const lon = Math.atan2(y, x) * 180 / Math.PI;
    const alt = r - EARTH_RADIUS;
    return { lat, lon, alt_km: alt };
}

// ---------- STATE ----------
let scene, camera, renderer, controls, earthGroup, starField;
let clock = new THREE.Clock();
let objectMeshes = {};        // id -> THREE mesh
let objectData = {};          // id -> last known data
let orbitalData = {};         // id -> orbital elements
let orbitMeshes = {};         // id -> orbit ellipse mesh
let selectedObjectId = null;
let autoTickInterval = null;
let tickCount = 0;
let showLabels = true;
let labelSprites = {};
let pixi = null;
let showOrbits = true;

// ============================================================
//  LOADING
// ============================================================
const loaderBar = document.getElementById('loader-bar-fill');
const loaderStatus = document.getElementById('loader-status');
const loadingScreen = document.getElementById('loading-screen');
const appDiv = document.getElementById('app');

function setLoadProgress(pct, msg) {
    loaderBar.style.width = pct + '%';
    loaderStatus.textContent = msg;
}

// ============================================================
//  INIT THREE.JS
// ============================================================
function initThree() {
    setLoadProgress(10, 'Creating WebGL renderer...');

    const container = document.getElementById('viewport-3d');
    const w = container.clientWidth;
    const h = container.clientHeight;

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    container.appendChild(renderer.domElement);

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020408);
    scene.fog = new THREE.FogExp2(0x020408, 0.003);

    // Camera
    camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
    camera.position.set(15, 10, 15);
    camera.lookAt(0, 0, 0);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = EARTH_R + 0.5;
    controls.maxDistance = 100;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.8;

    // Resize
    window.addEventListener('resize', onResize);
}

function onResize() {
    const container = document.getElementById('viewport-3d');
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);

    if (pixi) {
        const hud = document.getElementById('hud-overlay');
        pixi.renderer.resize(hud.clientWidth, hud.clientHeight);
    }
}

// ============================================================
//  CREATE EARTH
// ============================================================
function createEarth() {
    setLoadProgress(30, 'Generating Earth model...');

    earthGroup = new THREE.Group();
    const earthGeo = new THREE.SphereGeometry(EARTH_R, 64, 64);

    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin('anonymous');

    // Create material immediately with fallback color
    const earthMat = new THREE.MeshPhongMaterial({
        color: 0x003366,
        emissive: 0x002244,
        shininess: 25,
        specular: new THREE.Color(0x333333),
        flatShading: true,
    });

    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    earthMesh.name = 'earth-sphere';
    earthMesh.rotation.y = -Math.PI / 2;
    earthGroup.add(earthMesh);

    // Atmosphere
    const atmosGeo = new THREE.SphereGeometry(EARTH_R * 1.015, 64, 64);
    const atmosMat = new THREE.MeshBasicMaterial({
        color: 0x44bbff,
        transparent: true,
        opacity: 0.15,
        side: THREE.BackSide,
    });
    earthGroup.add(new THREE.Mesh(atmosGeo, atmosMat));

    // Glow
    const glowGeo = new THREE.SphereGeometry(EARTH_R * 1.06, 64, 64);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0x2288ff,
        transparent: true,
        opacity: 0.08,
        side: THREE.BackSide,
    });
    earthGroup.add(new THREE.Mesh(glowGeo, glowMat));

    // Equator ring
    const eqGeo = new THREE.RingGeometry(EARTH_R * 1.003, EARTH_R * 1.006, 128);
    const eqMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
    const eqMesh = new THREE.Mesh(eqGeo, eqMat);
    eqMesh.rotation.x = -Math.PI / 2;
    earthGroup.add(eqMesh);

    scene.add(earthGroup);

    // Load textures asynchronously
    textureLoader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg', (tex) => {
        earthMat.map = tex;
        earthMat.color.setHex(0xffffff);
        earthMat.emissive.setHex(0x000000);
        earthMat.flatShading = false;
        earthMat.needsUpdate = true;
    });
    textureLoader.load('https://unpkg.com/three-globe/example/img/earth-topology.png', (tex) => {
        earthMat.bumpMap = tex;
        earthMat.bumpScale = 0.15;
        earthMat.needsUpdate = true;
    });
    textureLoader.load('https://unpkg.com/three-globe/example/img/earth-water.png', (tex) => {
        earthMat.specularMap = tex;
        earthMat.needsUpdate = true;
    });
}

// ============================================================
//  STARFIELD
// ============================================================
function createStarField() {
    setLoadProgress(45, 'Scattering star field...');
    const count = 8000;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const r = 400 + Math.random() * 600;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
        const c = 0.4 + Math.random() * 0.6;
        colors[i * 3] = c;
        colors[i * 3 + 1] = c;
        colors[i * 3 + 2] = c + Math.random() * 0.2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.4, vertexColors: true, transparent: true, opacity: 0.7 });
    starField = new THREE.Points(geo, mat);
    scene.add(starField);

    createPlanets();
}

function createPlanets() {
    // Add Mars and Moon to background
    const moonGeo = new THREE.SphereGeometry(EARTH_R * 0.27, 32, 32);
    const moonMat = new THREE.MeshPhongMaterial({ color: 0xcccccc, shininess: 5 });
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moon.position.set(EARTH_R * 30, EARTH_R * 10, -EARTH_R * 20); // Far away
    scene.add(moon);
    
    const marsGeo = new THREE.SphereGeometry(EARTH_R * 0.53, 32, 32);
    const marsMat = new THREE.MeshPhongMaterial({ color: 0xff4422, shininess: 5 });
    const mars = new THREE.Mesh(marsGeo, marsMat);
    mars.position.set(-EARTH_R * 40, -EARTH_R * 5, -EARTH_R * 10); // Far away differently
    scene.add(mars);

    // Add Jupiter
    const jupiterGeo = new THREE.SphereGeometry(EARTH_R * 2.5, 32, 32);
    const jupiterMat = new THREE.MeshPhongMaterial({ color: 0xd8ca9d, shininess: 5 });
    const jupiter = new THREE.Mesh(jupiterGeo, jupiterMat);
    jupiter.position.set(EARTH_R * 80, EARTH_R * 30, -EARTH_R * 50);
    scene.add(jupiter);

    // Add Venus
    const venusGeo = new THREE.SphereGeometry(EARTH_R * 0.95, 32, 32);
    const venusMat = new THREE.MeshPhongMaterial({ color: 0xffd700, shininess: 5 });
    const venus = new THREE.Mesh(venusGeo, venusMat);
    venus.position.set(-EARTH_R * 25, EARTH_R * 15, EARTH_R * 20);
    scene.add(venus);

    // Add some distant asteroids
    for (let i = 0; i < 20; i++) {
        const asteroidGeo = new THREE.SphereGeometry(Math.random() * 0.5 + 0.2, 8, 8);
        const asteroidMat = new THREE.MeshPhongMaterial({ color: 0x666666, shininess: 1 });
        const asteroid = new THREE.Mesh(asteroidGeo, asteroidMat);
        const distance = EARTH_R * (60 + Math.random() * 40);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        asteroid.position.set(
            distance * Math.sin(phi) * Math.cos(theta),
            distance * Math.sin(phi) * Math.sin(theta),
            distance * Math.cos(phi)
        );
        scene.add(asteroid);
    }
}


// ============================================================
//  LIGHTING
// ============================================================
function createLights() {
    setLoadProgress(55, 'Setting up lighting...');
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(50, 30, 20);
    scene.add(sun);

    const ambient = new THREE.AmbientLight(0x334466, 1.2);
    scene.add(ambient);

    const rim = new THREE.PointLight(0x0088ff, 1.5, 200);
    rim.position.set(-20, -15, -10);
    scene.add(rim);

    const fill = new THREE.PointLight(0x4466aa, 0.6, 200);
    fill.position.set(10, -20, 30);
    scene.add(fill);
}



// ============================================================
//  PIXI.JS HUD
// ============================================================
function initPixiHUD() {
    setLoadProgress(65, 'Initializing Pixi.js HUD...');
    if (typeof PIXI === 'undefined') {
        console.warn('PIXI.js not loaded, HUD overlay disabled');
        return;
    }
    const hudEl = document.getElementById('hud-overlay');
    const w = hudEl.clientWidth;
    const h = hudEl.clientHeight;

    const app = new PIXI.Application({
        width: w,
        height: h,
        transparent: true,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
    });
    hudEl.appendChild(app.view);
    pixi = app;

    // Draw corner brackets
    drawCornerBrackets(app);

    // Crosshair at center
    drawCrosshair(app);

    // Info text
    const infoStyle = new PIXI.TextStyle({
        fontFamily: 'Share Tech Mono',
        fontSize: 10,
        fill: 0x3a5a8a,
        letterSpacing: 2,
    });
    const infoText = new PIXI.Text('ECI REFERENCE FRAME | J2 PERTURBATION MODEL | RK4 PROPAGATOR', infoStyle);
    infoText.anchor.set(0.5, 1);
    infoText.x = w / 2;
    infoText.y = h - 12;
    app.stage.addChild(infoText);
}

function drawCornerBrackets(app) {
    const g = new PIXI.Graphics();
    const w = app.screen.width;
    const h = app.screen.height;
    const s = 30;
    const p = 15;

    g.lineStyle(1.5, 0x00ccff, 0.3);

    // Top-left
    g.moveTo(p, p + s); g.lineTo(p, p); g.lineTo(p + s, p);
    // Top-right
    g.moveTo(w - p - s, p); g.lineTo(w - p, p); g.lineTo(w - p, p + s);
    // Bottom-left
    g.moveTo(p, h - p - s); g.lineTo(p, h - p); g.lineTo(p + s, h - p);
    // Bottom-right
    g.moveTo(w - p - s, h - p); g.lineTo(w - p, h - p); g.lineTo(w - p, h - p - s);

    app.stage.addChild(g);
}

function drawCrosshair(app) {
    const g = new PIXI.Graphics();
    const cx = app.screen.width / 2;
    const cy = app.screen.height / 2;

    g.lineStyle(1, 0x00ccff, 0.15);

    // Horizontal
    g.moveTo(cx - 20, cy); g.lineTo(cx - 6, cy);
    g.moveTo(cx + 6, cy); g.lineTo(cx + 20, cy);
    // Vertical
    g.moveTo(cx, cy - 20); g.lineTo(cx, cy - 6);
    g.moveTo(cx, cy + 6); g.lineTo(cx, cy + 20);

    app.stage.addChild(g);
}

// ============================================================
//  OBJECT MANAGEMENT (3D)
// ============================================================
function eciToScene(pos) {
    // pos = [x, y, z] in km (ECI)
    return new THREE.Vector3(pos[0] * SCALE, pos[2] * SCALE, -pos[1] * SCALE);
}

function createObjectMesh(obj) {
    const isSat = obj.type === 'SATELLITE';
    const color = isSat ? 0x4a7fa5 : 0xff6a3c;
    const size = isSat ? SAT_SCALE : DEBRIS_SCALE;

    const mesh = new THREE.Group();

    if (isSat) {
        // Main body with tiny highlight dot (reflection)
        const bodyGeo = new THREE.BoxGeometry(size * 1.5, size * 1.5, size * 1.5);
        const bodyMat = new THREE.MeshPhongMaterial({
            color: color,
            emissive: 0xffffff,
            emissiveIntensity: 0.2, // Tiny dot reflection
            shininess: 100,
            specular: 0xffffff
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        mesh.add(body);

        // Solar panels (arms)
        const panelGeo = new THREE.BoxGeometry(size * 6, size * 0.2, size * 2);
        const panelMat = new THREE.MeshPhongMaterial({
            color: 0x224466,
            emissive: 0x112233,
            emissiveIntensity: 0.5,
            side: THREE.DoubleSide
        });
        const panels = new THREE.Mesh(panelGeo, panelMat);
        mesh.add(panels);
    } else {
        const geo = new THREE.TetrahedronGeometry(size, 0);
        const mat = new THREE.MeshPhongMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.95,
        });
        mesh.add(new THREE.Mesh(geo, mat));
    }

    const pos3 = eciToScene(obj.pos);
    mesh.position.copy(pos3);
    mesh.userData = { id: obj.id, type: obj.type, isSat };

    scene.add(mesh);
    objectMeshes[obj.id] = mesh;
}

function updateObjectMesh(obj) {
    const mesh = objectMeshes[obj.id];
    if (!mesh) {
        createObjectMesh(obj);
        return;
    }
    const pos3 = eciToScene(obj.pos);
    mesh.position.lerp(pos3, 0.3);
}

function removeObjectMesh(id) {
    const obj = objectMeshes[id];
    if (obj) {
        scene.remove(obj);
        obj.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });
        delete objectMeshes[id];
    }
}

// ============================================================
//  ORBIT TRAIL LINES
// ============================================================
const orbitTrails = {};

function updateOrbitTrail(obj) {
    if (!orbitTrails[obj.id]) {
        const isSat = obj.type === 'SATELLITE';
        const color = isSat ? 0xC4956A : 0xff6a3c; // Warm amber for tracking
        const maxPoints = isSat ? 15 : 10;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(maxPoints * 3);
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setDrawRange(0, 0);
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 });
        const line = new THREE.Line(geo, mat);
        scene.add(line);
        orbitTrails[obj.id] = { line, points: [], maxPoints };
    }

    const trail = orbitTrails[obj.id];
    const pos3 = eciToScene(obj.pos);
    trail.points.push(pos3.clone());
    if (trail.points.length > trail.maxPoints) trail.points.shift();

    const posArr = trail.line.geometry.attributes.position.array;
    for (let i = 0; i < trail.points.length; i++) {
        posArr[i * 3] = trail.points[i].x;
        posArr[i * 3 + 1] = trail.points[i].y;
        posArr[i * 3 + 2] = trail.points[i].z;
    }
    trail.line.geometry.attributes.position.needsUpdate = true;
    trail.line.geometry.setDrawRange(0, trail.points.length);
}

// ============================================================
//  RAYCASTING (object selection)
// ============================================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onViewportClick(e) {
    const container = document.getElementById('viewport-3d');
    const rect = container.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const meshes = Object.values(objectMeshes);
    const intersects = raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
        const hit = intersects[0].object;
        selectObject(hit.userData.id);
    } else {
        deselectObject();
    }
}

function selectObject(id) {
    selectedObjectId = id;

    // Highlight in list
    document.querySelectorAll('.obj-list-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.id === id);
    });

    // Highlight mesh
    Object.entries(objectMeshes).forEach(([oid, mesh]) => {
        if (mesh.userData.id === id) {
            mesh.children.forEach(c => {
                if (c.material && c.material.emissiveIntensity !== undefined) {
                    c.material.emissiveIntensity = 1.0;
                }
            });
            mesh.scale.set(1.5, 1.5, 1.5);
        } else {
            mesh.children.forEach(c => {
                if (c.material && c.material.emissiveIntensity !== undefined) {
                    c.material.emissiveIntensity = mesh.userData.isSat ? 0.2 : 0.5;
                }
            });
            mesh.scale.set(1, 1, 1);
        }
    });

    updateDetailPanel(id);
    
    // Update orbits if enabled
    if (showOrbits) {
        drawAllOrbits();
    }
    
    // Highlight in coordinates panel and scroll to it
    document.querySelectorAll('.coord-item').forEach(el => el.classList.remove('selected'));
    const coordEl = document.querySelector(`.coord-item[data-id="${id}"]`);
    if (coordEl) {
        coordEl.classList.add('selected');
        coordEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
}

function deselectObject() {
    selectedObjectId = null;
    Object.values(objectMeshes).forEach(mesh => {
        mesh.children.forEach(c => {
            if (c.material && c.material.emissiveIntensity !== undefined) {
                c.material.emissiveIntensity = mesh.userData.isSat ? 0.2 : 0.5;
            }
        });
        mesh.scale.set(1, 1, 1);
    });
    document.querySelectorAll('.obj-list-item').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.coord-item').forEach(el => el.classList.remove('selected'));
    document.getElementById('object-detail').innerHTML = '<p class="detail-placeholder">Click an object in the 3D view to inspect</p>';
    
    // Clear orbits when nothing is selected
    if (showOrbits) {
        drawAllOrbits();
    }
}

function updateDashboardStats(status, stateData) {
    const sats = status.satellites || 0;
    const debris = status.debris || 0;
    const total = status.total_objects || 0;
    const fuel = status.total_fuel_kg || 0;

    document.getElementById('stat-satellites').textContent = sats;
    document.getElementById('stat-debris').textContent = debris;
    document.getElementById('stat-fuel').textContent = fuel.toFixed(1) + ' kg';

    // Bar fills
    const maxObjs = Math.max(total, 1);
    document.getElementById('sat-bar-fill').style.width = ((sats / Math.max(sats + debris, 1)) * 100) + '%';
    document.getElementById('debris-bar-fill').style.width = ((debris / Math.max(sats + debris, 1)) * 100) + '%';
    document.getElementById('fuel-bar-fill').style.width = Math.min(100, (fuel / (sats * 50 || 1)) * 100) + '%';
}

// updateDetailPanel() exists later with orbit + maneuver details.
// This placeholder must not duplicate name if the real function exists below.
function updateDetailPanelSync(id) {
    // No-op; the full updateDetailPanel is defined later.
}

// ============================================================
//  OBJECT LIST
// ============================================================
function renderObjectList() {
    const listEl = document.getElementById('object-list');
    const ids = Object.keys(objectData);
    if (ids.length === 0) {
        listEl.innerHTML = '<p class="detail-placeholder">No objects tracked</p>';
        return;
    }

    listEl.innerHTML = ids.map(id => {
        const obj = objectData[id];
        const isSat = obj.type === 'SATELLITE';
        const dotClass = isSat ? 'sat' : 'debris';
        const tagClass = isSat ? 'sat' : 'debris';
        const sel = id === selectedObjectId ? 'selected' : '';
        return `<div class="obj-list-item ${sel}" data-id="${id}">
            <span class="obj-dot ${dotClass}"></span>
            <span class="obj-name">${id}</span>
            <span class="obj-type-tag ${tagClass}">${isSat ? 'SAT' : 'DBR'}</span>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.obj-list-item').forEach(el => {
        el.addEventListener('click', () => selectObject(el.dataset.id));
    });
}

function updateCoordinatesDisplay() {
    const displayEl = document.getElementById('coordinates-display');
    const ids = Object.keys(objectData);
    if (ids.length === 0) {
        displayEl.innerHTML = '<p class="detail-placeholder">No objects tracked</p>';
        return;
    }

    const coords = ids.map(id => {
        const obj = objectData[id];
        const coords = subsatellitePoint(obj.pos);
        const isSat = obj.type === 'SATELLITE';
        const sel = id === selectedObjectId ? 'selected' : '';
        return `<div class="coord-item ${sel}" data-id="${id}">
            <span class="coord-name">${id}</span>
            <span class="coord-type">${isSat ? 'SAT' : 'DBR'}</span>
            <span class="coord-lat">Lat: ${coords.lat.toFixed(2)}°</span>
            <span class="coord-lon">Lon: ${coords.lon.toFixed(2)}°</span>
            <span class="coord-alt">Alt: ${coords.alt_km.toFixed(0)} km</span>
        </div>`;
    }).join('');

    displayEl.innerHTML = coords;

    displayEl.querySelectorAll('.coord-item').forEach(el => {
        el.addEventListener('click', () => selectObject(el.dataset.id));
    });
}

// ============================================================
//  API CALLS
// ============================================================
async function fetchStates() {
    try {
        const res = await fetch(`${API_BASE}/api/states`);
        const data = await res.json();
        return data;
    } catch (e) {
        return null;
    }
}

async function fetchStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/status`);
        return await res.json();
    } catch (e) {
        return null;
    }
}

async function postTick(dt) {
    try {
        const res = await fetch(`${API_BASE}/api/tick?dt=${dt}`, { method: 'POST' });
        return await res.json();
    } catch (e) {
        return null;
    }
}

async function postTelemetry(payload) {
    try {
        const res = await fetch(`${API_BASE}/api/telemetry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return await res.json();
    } catch (e) {
        return null;
    }
}

async function fetchOrbits() {
    try {
        const res = await fetch(`${API_BASE}/api/orbits`);
        return await res.json();
    } catch (e) {
        console.error('Error fetching orbits:', e);
        return { orbits: [] };
    }
}

async function planManeuver(satelliteId, targetAltitudeKm) {
    try {
        const res = await fetch(`${API_BASE}/api/maneuver/plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                satellite_id: satelliteId,
                target_altitude_km: targetAltitudeKm,
            }),
        });
        return await res.json();
    } catch (e) {
        console.error('Error planning maneuver:', e);
        return null;
    }
}

async function executeManeuver(satelliteId, targetAltitudeKm) {
    try {
        const res = await fetch(`${API_BASE}/api/maneuver/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                satellite_id: satelliteId,
                target_altitude_km: targetAltitudeKm,
            }),
        });
        return await res.json();
    } catch (e) {
        console.error('Error executing maneuver:', e);
        return null;
    }
}

// ============================================================
//  SYNC STATE FROM API
// ============================================================
async function syncState() {
    const stateData = await fetchStates();
    const statusData = await fetchStatus();
    const orbitsData = await fetchOrbits();

    if (stateData && stateData.objects) {
        const newIds = new Set();
        for (const obj of stateData.objects) {
            newIds.add(obj.id);
            objectData[obj.id] = obj;
            updateObjectMesh(obj);
            updateOrbitTrail(obj);
        }
        // Remove stale
        for (const id of Object.keys(objectMeshes)) {
            if (!newIds.has(id)) {
                removeObjectMesh(id);
                delete objectData[id];
            }
        }
        renderObjectList();
        updateCoordinatesDisplay();
        if (selectedObjectId) updateDetailPanel(selectedObjectId);
    }

    if (statusData) {
        updateDashboardStats(statusData, stateData);
        
        // Handle debris warning feature based on calculated global threshold
        const warningEl = document.getElementById('debris-warning');
        if (statusData.critical_warnings > 0) {
            if (warningEl) warningEl.style.display = 'block';
        } else {
            if (warningEl) warningEl.style.display = 'none';
        }
    }

    if (orbitsData && orbitsData.orbits) {
        for (const orbit of orbitsData.orbits) {
            orbitalData[orbit.id] = orbit.elements;
        }
        if (showOrbits) drawAllOrbits();
    }
}

// ============================================================
//  ORBIT VISUALIZATION
// ============================================================
function drawAllOrbits() {
    // Remove old orbit meshes
    Object.values(orbitMeshes).forEach(mesh => {
        scene.remove(mesh);
    });
    orbitMeshes = {};

    // Only draw orbit for the currently selected object if it's a satellite
    if (selectedObjectId) {
        const obj = objectData[selectedObjectId];
        const elements = orbitalData[selectedObjectId];
        if (elements && elements.a && obj && obj.type === 'SATELLITE') {
            drawOrbit(selectedObjectId, elements);
        }
    }
}

function drawOrbit(satId, elements) {
    const MU = 398600.4418;  // km^3/s^2
    const a = elements.a;
    const e = elements.e;
    const i = elements.i;
    const raan = elements.raan;
    const w = elements.w;

    // Create ellipse geometry
    const perigee = a * (1 - e);
    const apogee = a * (1 + e);
    const semiMinor = Math.sqrt(a * a * (1 - e * e));

    // Number of points to draw the orbit
    const points = [];
    const segments = 256;

    for (let i = 0; i <= segments; i++) {
        const nu = (i / segments) * Math.PI * 2;  // True anomaly

        // Position in orbital frame
        const p = a * (1 - e * e);
        const r = p / (1 + e * Math.cos(nu));

        const x = r * Math.cos(nu);
        const y = r * Math.sin(nu);
        const z = 0;

        // Rotation matrices
        const cosW = Math.cos(w), sinW = Math.sin(w);
        const cosI = Math.cos(i), sinI = Math.sin(i);
        const cosRaan = Math.cos(raan), sinRaan = Math.sin(raan);

        // Rotate to ECI frame
        const x1 = cosW * x - sinW * y;
        const y1 = sinW * x + cosW * y;
        const z1 = z;

        const x2 = x1;
        const y2 = cosI * y1 - sinI * z1;
        const z2 = sinI * y1 + cosI * z1;

        const xEci = cosRaan * x2 - sinRaan * y2;
        const yEci = sinRaan * x2 + cosRaan * y2;
        const zEci = z2;

        // Convert to 3D space (scale down)
        points.push(new THREE.Vector3(xEci * SCALE, yEci * SCALE, zEci * SCALE));
    }

    // Create line geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints(points);

    const material = new THREE.LineDashedMaterial({
        color: 0x6B8FA3,   // subdued
        transparent: true,
        opacity: 0.35,
        linewidth: 1,
        dashSize: 250,
        gapSize: 150
    });

    const orbit = new THREE.Line(geometry, material);
    orbit.computeLineDistances();
    scene.add(orbit);
    orbitMeshes[satId] = orbit;
}

// ============================================================
//  MANEUVER PANEL
// ============================================================
function updateDetailPanel(id) {
    const obj = objectData[id];
    if (!obj) return;

    const isSat = obj.type === 'SATELLITE';
    const typeClass = isSat ? 'type-sat' : 'type-debris';
    const r = Math.sqrt(obj.pos[0] ** 2 + obj.pos[1] ** 2 + obj.pos[2] ** 2);
    const alt = r - EARTH_RADIUS;
    const speed = Math.sqrt(obj.vel[0] ** 2 + obj.vel[1] ** 2 + obj.vel[2] ** 2);

    const elements = orbitalData[id];
    let orbitalDetails = '';
    
    if (elements && isSat) {
        orbitalDetails = `
            <div class="detail-section">
                <h4>Orbital Elements</h4>
                <div class="detail-row"><span class="detail-key">SMA</span><span class="detail-val">${(elements.a || 0).toFixed(2)} km</span></div>
                <div class="detail-row"><span class="detail-key">ECC</span><span class="detail-val">${(elements.e || 0).toFixed(4)}</span></div>
                <div class="detail-row"><span class="detail-key">INC</span><span class="detail-val">${((elements.i || 0) * 180 / Math.PI).toFixed(2)}°</span></div>
                <div class="detail-row"><span class="detail-key">PERIOD</span><span class="detail-val">${(elements.period_minutes || 0).toFixed(1)} min</span></div>
                <div class="detail-row"><span class="detail-key">PERI</span><span class="detail-val">${(elements.periapsis_km || 0).toFixed(0)} km</span></div>
                <div class="detail-row"><span class="detail-key">APOGEE</span><span class="detail-val">${(elements.apoapsis_km || 0).toFixed(0)} km</span></div>
            </div>
        `;
    }

    // Get metadata
    const metadata = obj.metadata || {};
    const metadataDetails = metadata.name || metadata.norad_id || metadata.country || metadata.launch_date ? `
        <div class="detail-section">
            <h4>Object Information</h4>
            ${metadata.name ? `<div class="detail-row"><span class="detail-key">NAME</span><span class="detail-val">${metadata.name}</span></div>` : ''}
            ${metadata.norad_id ? `<div class="detail-row"><span class="detail-key">NORAD ID</span><span class="detail-val">${metadata.norad_id}</span></div>` : ''}
            ${metadata.country ? `<div class="detail-row"><span class="detail-key">COUNTRY</span><span class="detail-val">${metadata.country}</span></div>` : ''}
            ${metadata.launch_date ? `<div class="detail-row"><span class="detail-key">LAUNCH</span><span class="detail-val">${metadata.launch_date}</span></div>` : ''}
            ${metadata.rcs_size ? `<div class="detail-row"><span class="detail-key">RCS SIZE</span><span class="detail-val">${metadata.rcs_size}</span></div>` : ''}
            ${metadata.classification ? `<div class="detail-row"><span class="detail-key">CLASS</span><span class="detail-val">${metadata.classification}</span></div>` : ''}
        </div>
    ` : '';

    const maneuverPanel = isSat ? `
        <div class="detail-section">
            <h4>Orbital Maneuver</h4>
            <div style="display:flex; gap:8px; margin-bottom:10px;">
                <input type="number" id="target-alt" placeholder="Target Alt (km)" min="0" max="50000" value="400" style="flex:1; padding:6px; border:1px solid var(--accent-cyan); background:transparent; color:white; border-radius:3px;">
                <button id="btn-maneuver-plan" style="padding:6px 12px; background:rgba(0,240,255,0.2); border:1px solid var(--accent-cyan); color:var(--accent-cyan); cursor:pointer; border-radius:3px;">PLAN</button>
            </div>
            <div id="maneuver-info" style="font-size:12px; color:var(--text-dim);"></div>
            <button id="btn-maneuver-execute" style="display:none; width:100%; padding:8px; margin-top:8px; background:rgba(255,100,100,0.3); border:1px solid #ff6464; color:#ff6464; cursor:pointer; border-radius:3px; font-weight:bold;">EXECUTE BURN</button>
        </div>
    ` : '';

    document.getElementById('object-detail').innerHTML = `
        <div class="detail-id">${obj.id}</div>
        <div class="detail-row"><span class="detail-key">TYPE</span><span class="detail-val ${typeClass}">${obj.type}</span></div>
        <div class="detail-row"><span class="detail-key">ALTITUDE</span><span class="detail-val">${alt.toFixed(2)} km</span></div>
        <div class="detail-row"><span class="detail-key">SPEED</span><span class="detail-val">${speed.toFixed(4)} km/s</span></div>
        <div class="detail-row"><span class="detail-key">POS X</span><span class="detail-val">${obj.pos[0].toFixed(3)} km</span></div>
        <div class="detail-row"><span class="detail-key">POS Y</span><span class="detail-val">${obj.pos[1].toFixed(3)} km</span></div>
        <div class="detail-row"><span class="detail-key">POS Z</span><span class="detail-val">${obj.pos[2].toFixed(3)} km</span></div>
        <div class="detail-row"><span class="detail-key">VEL X</span><span class="detail-val">${obj.vel[0].toFixed(5)} km/s</span></div>
        <div class="detail-row"><span class="detail-key">VEL Y</span><span class="detail-val">${obj.vel[1].toFixed(5)} km/s</span></div>
        <div class="detail-row"><span class="detail-key">VEL Z</span><span class="detail-val">${obj.vel[2].toFixed(5)} km/s</span></div>
        ${isSat ? `<div class="detail-row"><span class="detail-key">FUEL</span><span class="detail-val" style="color:var(--fuel-color)">${obj.fuel_kg.toFixed(2)} kg</span></div>` : ''}
        ${isSat ? `<div class="detail-row"><span class="detail-key">MASS</span><span class="detail-val">${obj.mass_kg.toFixed(2)} kg</span></div>` : ''}
        ${metadataDetails}
        ${orbitalDetails}
        ${maneuverPanel}
    `;

    // Attach maneuver listeners if satellite
    if (isSat) {
        const planBtn = document.getElementById('btn-maneuver-plan');
        const execBtn = document.getElementById('btn-maneuver-execute');
        const infoDiv = document.getElementById('maneuver-info');
        const targetAltInput = document.getElementById('target-alt');

        let lastPlan = null;

        planBtn.addEventListener('click', async () => {
            const targetAlt = parseFloat(targetAltInput.value);
            if (isNaN(targetAlt) || targetAlt < 0) {
                infoDiv.textContent = 'Invalid target altitude';
                return;
            }

            infoDiv.textContent = 'Planning...';
            const plan = await planManeuver(id, targetAlt);
            lastPlan = plan;

            if (plan) {
                infoDiv.innerHTML = `
                    ΔV: ${plan.dv_required.toFixed(3)} km/s<br>
                    Fuel: ${plan.fuel_required_kg.toFixed(2)} kg<br>
                    ${plan.can_execute ? '<span style="color:#4f4">✓ Ready</span>' : '<span style="color:#f44">✗ ' + plan.reason + '</span>'}
                `;
                if (plan.can_execute) {
                    execBtn.style.display = 'block';
                } else {
                    execBtn.style.display = 'none';
                }
            }
        });

        execBtn.addEventListener('click', async () => {
            if (!lastPlan || !lastPlan.can_execute) return;
            const result = await executeManeuver(id, parseFloat(targetAltInput.value));
            if (result && result.status === 'EXECUTED') {
                addLog(`✈️  ${id}: Maneuver executed! ΔV=${result.dv_applied.toFixed(3)} km/s`, 'success');
                infoDiv.textContent = 'Maneuver executed!';
                execBtn.style.display = 'none';
                setTimeout(() => syncState(), 500);
            }
        });
    }
}

// ============================================================
//  DEMO DATA INJECTION
// ============================================================
function generateDemoPayload() {
    const now = new Date().toISOString();
    const objects = [];

    // LEO Satellites (altitude ~400-800 km)
    const satNames = ['SAT-ALPHA', 'SAT-BRAVO', 'SAT-CHARLIE', 'SAT-DELTA', 'SAT-ECHO'];
    for (let i = 0; i < satNames.length; i++) {
        const alt = EARTH_RADIUS + 400 + i * 100;
        const angle = (i / satNames.length) * Math.PI * 2 + Math.random() * 0.3;
        const incl = 0.3 + Math.random() * 0.5;
        const x = alt * Math.cos(angle) * Math.cos(incl);
        const y = alt * Math.sin(angle) * Math.cos(incl);
        const z = alt * Math.sin(incl) * (i % 2 === 0 ? 1 : -1);

        // Orbital velocity  ~ sqrt(MU/r) in km/s
        const v_mag = Math.sqrt(398600.4418 / alt);
        const vx = -v_mag * Math.sin(angle);
        const vy = v_mag * Math.cos(angle);
        const vz = v_mag * 0.1 * (i % 2 === 0 ? 1 : -1);

        objects.push({
            id: satNames[i],
            type: 'SATELLITE',
            r: { x, y, z },
            v: { x: vx, y: vy, z: vz },
        });
    }

    // Debris field
    for (let i = 0; i < 15; i++) {
        const alt = EARTH_RADIUS + 300 + Math.random() * 600;
        const angle = Math.random() * Math.PI * 2;
        const incl = (Math.random() - 0.5) * Math.PI * 0.6;
        const x = alt * Math.cos(angle) * Math.cos(incl);
        const y = alt * Math.sin(angle) * Math.cos(incl);
        const z = alt * Math.sin(incl);

        const v_mag = Math.sqrt(398600.4418 / alt);
        const vx = -v_mag * Math.sin(angle) + (Math.random() - 0.5) * 0.1;
        const vy = v_mag * Math.cos(angle) + (Math.random() - 0.5) * 0.1;
        const vz = (Math.random() - 0.5) * 0.3;

        objects.push({
            id: `DEBRIS-${String(i + 1).padStart(3, '0')}`,
            type: 'DEBRIS',
            r: { x, y, z },
            v: { x: vx, y: vy, z: vz },
        });
    }

    return { timestamp: now, objects };
}

function generateCollisionPayload() {
    const now = new Date().toISOString();
    const alt = EARTH_RADIUS + 500;
    const angle = Math.random() * Math.PI * 2;
    const x = alt * Math.cos(angle);
    const y = alt * Math.sin(angle);
    const z = 200;

    const v_mag = Math.sqrt(398600.4418 / alt);

    return {
        timestamp: now,
        objects: [
            {
                id: 'SAT-TANGO',
                type: 'SATELLITE',
                r: { x, y, z },
                v: { x: -v_mag * Math.sin(angle), y: v_mag * Math.cos(angle), z: 0.01 },
            },
            {
                id: 'DEBRIS-CRITICAL',
                type: 'DEBRIS',
                r: { x: x + 0.05, y: y + 0.03, z: z + 0.01 },  // very close!
                v: { x: -v_mag * Math.sin(angle) + 0.5, y: v_mag * Math.cos(angle) - 0.3, z: 0.1 },
            },
        ],
    };
}

// ============================================================
//  EVENT LOG
// ============================================================
function addLog(msg, type = 'info') {
    const entries = document.getElementById('log-entries');
    const time = `T+${tickCount}`;
    const div = document.createElement('div');
    div.className = `log-entry log-${type}`;
    div.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${msg}</span>`;
    entries.prepend(div);

    // Keep max 100 entries
    while (entries.children.length > 100) {
        entries.removeChild(entries.lastChild);
    }
}

// ============================================================
//  ANIMATION LOOP
// ============================================================
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    // Rotate Earth slowly
    if (earthGroup) earthGroup.rotation.y += dt * 0.02;

    // Rotate star field slowly
    if (starField) starField.rotation.y += dt * 0.003;

    // Pulse selected object
    if (selectedObjectId && objectMeshes[selectedObjectId]) {
        const mesh = objectMeshes[selectedObjectId];
        const pulse = 1.3 + Math.sin(clock.elapsedTime * 3) * 0.2;
        mesh.scale.set(pulse, pulse, pulse);
    }

    // Spin debris meshes
    Object.entries(objectMeshes).forEach(([id, mesh]) => {
        if (mesh.userData.type === 'DEBRIS') {
            mesh.rotation.x += dt * 1.5;
            mesh.rotation.z += dt * 0.8;
        }
    });

    controls.update();
    renderer.render(scene, camera);
}

// ============================================================
//  UTC CLOCK
// ============================================================
function updateClock() {
    const now = new Date();
    const utc = now.toISOString().slice(11, 19);
    document.getElementById('utc-clock').textContent = `UTC ${utc}`;
}

// ============================================================
//  REAL-TIME TELEMETRY (WebSockets)
// ============================================================
let telemetryWS = null;

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;
    
    console.log(`📡 Connecting to Telemetry Uplink: ${wsUrl}`);
    telemetryWS = new WebSocket(wsUrl);

    telemetryWS.onopen = () => {
        addLog('UPLINK ESTABLISHED: Real-time telemetry active.', 'success');
        const pill = document.getElementById('uplink-pill');
        if (pill) { pill.className = 'pill-status pill-ok'; pill.textContent = 'UPLINK: LIVE'; }
    };

    telemetryWS.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'TELEMETRY_UPDATE') {
                handleLiveTelemetry(msg.data);
            } else if (msg.type === 'INIT_SNAPSHOT') {
                Object.values(msg.data).forEach(handleLiveTelemetry);
            }
        } catch (e) {
            console.error('WS Data Error:', e);
        }
    };

    telemetryWS.onclose = () => {
        addLog('UPLINK LOST: Attempting reconnection...', 'warn');
        const pill = document.getElementById('uplink-pill');
        if (pill) { pill.className = 'pill-status pill-err'; pill.textContent = 'UPLINK: LOST'; }
        setTimeout(initWebSocket, 3000); // Reconnect in 3s
    };

    telemetryWS.onerror = (err) => {
        console.error('WS Flux error:', err);
    };
}

function handleLiveTelemetry(data) {
    // data = { satellite_id, timestamp, pos: [x,y,z], vel, fuel_kg }
    const id = data.satellite_id;
    
    // 1. Update internal state
    objectData[id] = {
        id: id,
        type: 'SATELLITE',
        r: { x: data.pos[0], y: data.pos[1], z: data.pos[2] },
        v: { x: data.vel[0], y: data.vel[1], z: data.vel[2] },
        fuel_kg: data.fuel_kg
    };

    // 2. Update 3D mesh
    const obj = {
        id: id,
        type: 'SATELLITE',
        pos: data.pos
    };
    updateObjectMesh(obj);

    // 3. Update Trail if active
    if (showOrbits) {
        updateOrbitTrail(obj);
    }

    // 4. Update HUD if this object is selected
    if (selectedObjectId === id) {
        // Debounce or immediate update of detail panel if needed?
        // For high frequency, we update critical values only
        const distEl = document.getElementById('detail-dist');
        const velEl = document.getElementById('detail-vel');
        const fuelEl = document.getElementById('detail-fuel');
        
        if (distEl) distEl.textContent = (Math.sqrt(data.pos[0]**2 + data.pos[1]**2 + data.pos[2]**2) - EARTH_RADIUS).toFixed(2) + ' km';
        if (velEl) velEl.textContent = Math.sqrt(data.vel[0]**2 + data.vel[1]**2 + data.vel[2]**2).toFixed(3) + ' km/s';
        if (fuelEl) fuelEl.textContent = data.fuel_kg.toFixed(2) + ' kg';
    }
}

// ============================================================
//  BUTTON HANDLERS
// ============================================================
function setupControls() {
    // Toggle orbits
    document.getElementById('btn-toggle-orbits').addEventListener('click', () => {
        showOrbits = !showOrbits;
        if (showOrbits) {
            drawAllOrbits();
            addLog('Orbits enabled', 'info');
        } else {
            Object.values(orbitMeshes).forEach(mesh => scene.remove(mesh));
            orbitMeshes = {};
            addLog('Orbits disabled', 'info');
        }
    });

    // Tick
    document.getElementById('btn-tick').addEventListener('click', async () => {
        const dt = parseFloat(document.getElementById('dt-slider').value);
        const result = await postTick(dt);
        if (result) {
            tickCount++;
            addLog(`Simulation progressed by ${dt}s`, 'info');
            await syncState();
        } else {
            addLog('Tick failed — is the backend running?', 'danger');
        }
    });

    // Auto tick
    document.getElementById('btn-auto-tick').addEventListener('click', () => {
        if (autoTickInterval) return;
        const intervalMs = parseInt(document.getElementById('interval-slider').value);
        document.getElementById('btn-auto-tick').style.display = 'none';
        document.getElementById('btn-stop').style.display = 'flex';
        addLog(`Auto-tick started (interval: ${intervalMs}ms)`, 'info');

        autoTickInterval = setInterval(async () => {
            const dt = parseFloat(document.getElementById('dt-slider').value);
            const result = await postTick(dt);
            if (result) {
                tickCount++;
                await syncState();
            }
        }, intervalMs);
    });

    // Stop
    document.getElementById('btn-stop').addEventListener('click', () => {
        if (autoTickInterval) {
            clearInterval(autoTickInterval);
            autoTickInterval = null;
        }
        document.getElementById('btn-auto-tick').style.display = 'flex';
        document.getElementById('btn-stop').style.display = 'none';
        addLog('Auto-tick stopped', 'warn');
    });

    // Slider labels
    document.getElementById('dt-slider').addEventListener('input', (e) => {
        document.getElementById('dt-display').textContent = parseFloat(e.target.value).toFixed(1) + 's';
    });
    document.getElementById('interval-slider').addEventListener('input', (e) => {
        document.getElementById('interval-display').textContent = e.target.value + 'ms';
    });

    // Demo inject - buttons not in HTML, skip for now
    // document.getElementById('btn-inject-demo').addEventListener('click', async () => {
    //     const payload = generateDemoPayload();
    //     const result = await postTelemetry(payload);
    //     if (result) {
    //         addLog(`Demo injected: ${result.processed_count} objects | CDM warnings: ${result.active_cdm_warnings}`, 'success');
    //         // document.getElementById('stat-warnings').textContent = result.active_cdm_warnings; // not in HTML
    //         await syncState();
    //     } else {
    //         addLog('Injection failed — is the backend running?', 'danger');
    //     }
    // });

    // Collision inject - buttons not in HTML, skip for now
    // document.getElementById('btn-inject-collision').addEventListener('click', async () => {
    //     const payload = generateCollisionPayload();
    //     const result = await postTelemetry(payload);
    //     if (result) {
    //         addLog(`⚠️ COLLISION scenario injected! CDM warnings: ${result.active_cdm_warnings}`, 'danger');
    //         // document.getElementById('stat-warnings').textContent = result.active_cdm_warnings; // not in HTML
    //         // const warnFill = Math.min(100, result.active_cdm_warnings * 20);
    //         // document.getElementById('warn-bar-fill').style.width = warnFill + '%'; // not in HTML
    //         await syncState();
    //     } else {
    //         addLog('Injection failed — is the backend running?', 'danger');
    //     }
    // });

    // Clear log
    document.getElementById('btn-clear-log').addEventListener('click', () => {
        document.getElementById('log-entries').innerHTML = '';
    });



    // Toggle labels
    document.getElementById('btn-toggle-labels').addEventListener('click', () => {
        showLabels = !showLabels;
        document.getElementById('btn-toggle-labels').classList.toggle('active', showLabels);
    });

    // Toggle orbits
    document.getElementById('btn-toggle-orbits').addEventListener('click', () => {
        showOrbits = !showOrbits;
        document.getElementById('btn-toggle-orbits').classList.toggle('active', showOrbits);
        if (showOrbits) {
            drawAllOrbits();
            addLog('Orbits enabled', 'info');
        } else {
            Object.values(orbitMeshes).forEach(mesh => scene.remove(mesh));
            orbitMeshes = {};
            addLog('Orbits disabled', 'info');
        }
    });

    // Refresh data
    document.getElementById('btn-refresh-data').addEventListener('click', async () => {
        addLog('Refreshing data...', 'info');
        try {
            const response = await fetch(`${API_BASE}/api/reload-data`, { method: 'POST' });
            if (response.ok) {
                addLog('Data refreshed successfully', 'success');
                setTimeout(() => syncState(), 1000);
            } else {
                addLog('Failed to refresh data', 'error');
            }
        } catch (error) {
            addLog('Error refreshing data: ' + error.message, 'error');
        }
    });

    // System info
    document.getElementById('btn-system-info').addEventListener('click', async () => {
        try {
            const response = await fetch(`${API_BASE}/api/status`);
            if (response.ok) {
                const status = await response.json();
                addLog(`System: ${status.status}, Objects: ${status.object_count}, Uptime: ${status.uptime_seconds}s`, 'info');
            } else {
                addLog('Failed to get system status', 'error');
            }
        } catch (error) {
            addLog('Error getting system info: ' + error.message, 'error');
        }
    });

    // Fullscreen
    document.getElementById('btn-fullscreen').addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
            document.getElementById('btn-fullscreen').classList.add('active');
        } else {
            document.exitFullscreen();
            document.getElementById('btn-fullscreen').classList.remove('active');
        }
    });

    // Viewport click for raycasting
    document.getElementById('viewport-3d').addEventListener('click', onViewportClick);
}

// ============================================================
//  BOOT SEQUENCE
// ============================================================
async function boot() {
    try {
        setLoadProgress(5, 'Starting boot sequence...');
        initThree();
        createEarth();
        createStarField();
        createLights();

        setLoadProgress(60, 'Initializing Pixi.js HUD...');
        initPixiHUD();

        setLoadProgress(75, 'Setting up controls...');
        setupControls();

        setLoadProgress(85, 'Connecting to backend...');
        await syncState();
        
        setLoadProgress(90, 'Establishing Telemetry Uplink...');
        initWebSocket();

        setLoadProgress(95, 'Starting render loop...');
        animate();

        // Clock
        updateClock();
        setInterval(updateClock, 1000);

        // Periodic sync
        setInterval(syncState, 5000);

        setLoadProgress(100, 'System ready. Awaiting connection sequence...');

        // Enable Space-Mode button instead of auto-fading
        const spaceBtn = document.getElementById('btn-space-mode');
        if (spaceBtn) {
            spaceBtn.disabled = false;
            spaceBtn.textContent = 'SPACE-MODE';
            
            spaceBtn.addEventListener('click', () => {
                spaceBtn.textContent = 'LAUNCHING...';
                loadingScreen.style.transition = 'opacity 0.8s ease';
                loadingScreen.style.opacity = '0';
                appDiv.style.opacity = '1';
                
                // Force a resize after reveal to ensure canvases fit perfectly
                setTimeout(() => {
                    loadingScreen.style.display = 'none';
                    onResize();
                }, 800);
            });
        }

        addLog('Mission control initialized. Uplink stable.', 'info');
        addLog('Telemetry received: Initial state synced.', 'info');
    } catch (err) {
        console.error('Boot error:', err);
        setLoadProgress(100, `Error: ${err.message}`);
        showErrorOnScreen(err);
        forceFinishLoading();
    }
}

function showErrorOnScreen(err) {
    const errEl = document.createElement('div');
    errEl.style.cssText = 'position: fixed; bottom: 10px; left: 10px; right: 10px; background: rgba(255,0,0,0.8); color: white; padding: 10px; border-radius: 4px; z-index: 10000; font-family: monospace; font-size: 0.9rem;';
    errEl.textContent = `Startup error: ${err.message}`;
    document.body.appendChild(errEl);
    setTimeout(() => errEl.remove(), 15000);
}

function forceFinishLoading() {
    loadingScreen.style.display = 'none';
    appDiv.style.opacity = '1';
}

window.addEventListener('error', (event) => {
    console.error('Global error caught:', event.error || event.message);
    setLoadProgress(100, `JS error: ${event.error ? event.error.message : event.message}`);
    showErrorOnScreen(event.error || new Error(event.message));
    forceFinishLoading();
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    setLoadProgress(100, `Promise error: ${event.reason}`);
    showErrorOnScreen(event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
    forceFinishLoading();
});

// Safety fallback: enable button after 8s if still loading
setTimeout(() => {
    if (loadingScreen.style.display !== 'none' && loadingScreen.style.opacity !== '0') {
        const spaceBtn = document.getElementById('btn-space-mode');
        if (spaceBtn && spaceBtn.disabled) {
            spaceBtn.disabled = false;
            spaceBtn.textContent = 'SPACE-MODE (FORCE LAUNCH)';
            spaceBtn.addEventListener('click', () => {
                spaceBtn.textContent = 'LAUNCHING...';
                loadingScreen.style.transition = 'opacity 0.8s ease';
                loadingScreen.style.opacity = '0';
                appDiv.style.opacity = '1';
                setTimeout(() => {
                    loadingScreen.style.display = 'none';
                    onResize();
                }, 800);
            });
            addLog('Loading timeout fallback applied to button', 'warn');
        }
    }
}, 8000);

// Go!
boot();
