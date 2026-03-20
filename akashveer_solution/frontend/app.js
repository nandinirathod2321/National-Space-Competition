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

// ---------- STATE ----------
let scene, camera, renderer, controls, earthGroup, starField;
let clock = new THREE.Clock();
let objectMeshes = {};        // id -> THREE mesh
let objectData = {};          // id -> last known data
let selectedObjectId = null;
let autoTickInterval = null;
let tickCount = 0;
let gridHelper = null;
let showLabels = true;
let showGrid = true;
let labelSprites = {};
let pixi = null;

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

    // Earth sphere geometry
    const earthGeo = new THREE.SphereGeometry(EARTH_R, 64, 64);

    // Load high-res earth textures from unpkg CDN
    const textureLoader = new THREE.TextureLoader();
    const earthColorMap = textureLoader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg');
    const earthBumpMap = textureLoader.load('https://unpkg.com/three-globe/example/img/earth-topology.png');
    const earthWaterMap = textureLoader.load('https://unpkg.com/three-globe/example/img/earth-water.png');

    const earthMat = new THREE.MeshPhongMaterial({
        map: earthColorMap,
        bumpMap: earthBumpMap,
        bumpScale: 0.15,
        specularMap: earthWaterMap,
        specular: new THREE.Color(0x333333),
        shininess: 25,
    });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    // Align prime meridian correctly (optional depending on use case)
    earthMesh.rotation.y = -Math.PI / 2;
    earthGroup.add(earthMesh);

    // Atmosphere glow
    const atmosGeo = new THREE.SphereGeometry(EARTH_R * 1.015, 64, 64);
    const atmosMat = new THREE.MeshBasicMaterial({
        color: 0x44bbff,
        transparent: true,
        opacity: 0.15,
        side: THREE.BackSide,
    });
    earthGroup.add(new THREE.Mesh(atmosGeo, atmosMat));

    // Outer glow
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
//  GRID HELPER
// ============================================================
function createGrid() {
    gridHelper = new THREE.GridHelper(60, 60, 0x0a1a3a, 0x0a1a3a);
    gridHelper.position.y = -EARTH_R - 0.5;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.3;
    scene.add(gridHelper);
}

// ============================================================
//  PIXI.JS HUD
// ============================================================
function initPixiHUD() {
    setLoadProgress(65, 'Initializing Pixi.js HUD...');
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
    const color = isSat ? 0x00e4ff : 0xff6a3c;
    const size = isSat ? SAT_SCALE : DEBRIS_SCALE;

    // Glow point
    const geo = isSat
        ? new THREE.OctahedronGeometry(size, 1)
        : new THREE.TetrahedronGeometry(size, 0);
    const mat = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geo, mat);

    // Outer glow sprite
    const spriteMat = new THREE.SpriteMaterial({
        color,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(size * 5, size * 5, 1);
    mesh.add(sprite);

    const pos3 = eciToScene(obj.pos);
    mesh.position.copy(pos3);
    mesh.userData = { id: obj.id, type: obj.type };

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
    const mesh = objectMeshes[id];
    if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
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
        const color = isSat ? 0x00e4ff : 0xff6a3c;
        const maxPoints = 200;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(maxPoints * 3);
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setDrawRange(0, 0);
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.25 });
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
        if (oid === id) {
            mesh.material.emissiveIntensity = 1.5;
            mesh.scale.set(1.5, 1.5, 1.5);
        } else {
            mesh.material.emissiveIntensity = 0.8;
            mesh.scale.set(1, 1, 1);
        }
    });

    updateDetailPanel(id);
}

function deselectObject() {
    selectedObjectId = null;
    Object.values(objectMeshes).forEach(mesh => {
        mesh.material.emissiveIntensity = 0.8;
        mesh.scale.set(1, 1, 1);
    });
    document.querySelectorAll('.obj-list-item').forEach(el => el.classList.remove('selected'));
    document.getElementById('object-detail').innerHTML = '<p class="detail-placeholder">Click an object in the 3D view to inspect</p>';
}

function updateDetailPanel(id) {
    const obj = objectData[id];
    if (!obj) return;

    const isSat = obj.type === 'SATELLITE';
    const typeClass = isSat ? 'type-sat' : 'type-debris';
    const r = Math.sqrt(obj.pos[0] ** 2 + obj.pos[1] ** 2 + obj.pos[2] ** 2);
    const alt = r - EARTH_RADIUS;
    const speed = Math.sqrt(obj.vel[0] ** 2 + obj.vel[1] ** 2 + obj.vel[2] ** 2);

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
    `;
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

// ============================================================
//  SYNC STATE FROM API
// ============================================================
async function syncState() {
    const stateData = await fetchStates();
    const statusData = await fetchStatus();

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
        if (selectedObjectId) updateDetailPanel(selectedObjectId);
    }

    if (statusData) {
        updateDashboardStats(statusData, stateData);
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
//  BUTTON HANDLERS
// ============================================================
function setupControls() {
    // Tick
    document.getElementById('btn-tick').addEventListener('click', async () => {
        const dt = parseFloat(document.getElementById('dt-slider').value);
        const result = await postTick(dt);
        if (result) {
            tickCount++;
            addLog(`Tick ${tickCount}: Propagated ${result.new_states_count} objects (Δt=${dt}s)`, 'success');
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
        document.getElementById('dt-value').textContent = parseFloat(e.target.value).toFixed(1) + 's';
    });
    document.getElementById('interval-slider').addEventListener('input', (e) => {
        document.getElementById('interval-value').textContent = e.target.value + 'ms';
    });

    // Demo inject
    document.getElementById('btn-inject-demo').addEventListener('click', async () => {
        const payload = generateDemoPayload();
        const result = await postTelemetry(payload);
        if (result) {
            addLog(`Demo injected: ${result.processed_count} objects | CDM warnings: ${result.active_cdm_warnings}`, 'success');
            document.getElementById('stat-warnings').textContent = result.active_cdm_warnings;
            await syncState();
        } else {
            addLog('Injection failed — is the backend running?', 'danger');
        }
    });

    // Collision inject
    document.getElementById('btn-inject-collision').addEventListener('click', async () => {
        const payload = generateCollisionPayload();
        const result = await postTelemetry(payload);
        if (result) {
            addLog(`⚠️ COLLISION scenario injected! CDM warnings: ${result.active_cdm_warnings}`, 'danger');
            document.getElementById('stat-warnings').textContent = result.active_cdm_warnings;
            const warnFill = Math.min(100, result.active_cdm_warnings * 20);
            document.getElementById('warn-bar-fill').style.width = warnFill + '%';
            await syncState();
        } else {
            addLog('Injection failed — is the backend running?', 'danger');
        }
    });

    // Clear log
    document.getElementById('btn-clear-log').addEventListener('click', () => {
        document.getElementById('log-entries').innerHTML = '';
    });

    // Toggle grid
    document.getElementById('btn-toggle-grid').addEventListener('click', () => {
        showGrid = !showGrid;
        if (gridHelper) gridHelper.visible = showGrid;
    });

    // Toggle labels
    document.getElementById('btn-toggle-labels').addEventListener('click', () => {
        showLabels = !showLabels;
    });

    // Fullscreen
    document.getElementById('btn-fullscreen').addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
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
        createGrid();

        setLoadProgress(60, 'Initializing Pixi.js HUD...');
        initPixiHUD();

        setLoadProgress(75, 'Setting up controls...');
        setupControls();

        setLoadProgress(85, 'Connecting to backend...');
        await syncState();

        setLoadProgress(95, 'Starting render loop...');
        animate();

        // Clock
        updateClock();
        setInterval(updateClock, 1000);

        // Periodic sync
        setInterval(syncState, 5000);

        setLoadProgress(100, 'System ready.');

        // Fade out loading screen
        setTimeout(() => {
            loadingScreen.style.transition = 'opacity 0.8s ease';
            loadingScreen.style.opacity = '0';
            appDiv.style.opacity = '1';
            
            // Force a resize after reveal to ensure canvases fit perfectly
            setTimeout(() => {
                loadingScreen.style.display = 'none';
                onResize();
            }, 800);
        }, 600);

        addLog('Dashboard initialized. Backend connected.', 'info');
        addLog('Load a demo scenario to begin tracking objects.', 'info');
    } catch (err) {
        console.error('Boot error:', err);
        setLoadProgress(100, `Error: ${err.message}`);
    }
}

// Go!
boot();
