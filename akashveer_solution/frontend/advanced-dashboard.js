/**
 * AKASHVEER Advanced Mission Control Dashboard
 * 4-Module Visualization System:
 * 1. Ground Track Map (Leaflet.js - Mercator Projection)
 * 2. Conjunction Bullseye Plot (Canvas - Polar Chart)
 * 3. Telemetry Heatmap (SVG - Fleet Health)
 * 4. Maneuver Timeline (Gantt - Schedule)
 */

const API_BASE = window.location.origin;
let map = null;
let selectedSatelliteId = null;
let lastMapData = null;
let mapMarkers = {};
let updateInProgress = false;

// ============================================================
// 1. GROUND TRACK MAP (Mercator Projection)
// ============================================================
function initGroundTrackMap() {
    map = L.map('map', {
        center: [0, 0],
        zoom: 2,
        attributionControl: false,
        zoomControl: true
    });

    // Dark theme basemap
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(map);

    // Add tile layer with labels
    L.tileLayer('https://stamen-tiles-{s}.a.ssl.fastly.net/terrain-labels/{z}/{x}/{y}.png', {
        maxZoom: 16,
        opacity: 0.3
    }).addTo(map);
}

async function updateGroundTrackMap() {
    try {
        const response = await fetch(`${API_BASE}/api/ground-track`);
        const data = await response.json();

        // Only update if data actually changed
        if (lastMapData && JSON.stringify(lastMapData) === JSON.stringify(data)) {
            return; // No changes, skip redraw
        }
        lastMapData = data;

        // Update existing markers instead of clearing all
        const currentSatIds = new Set(data.satellites.map(s => s.satellite_id));
        const existingSatIds = new Set(Object.keys(mapMarkers));

        // Remove markers for satellites no longer in data
        for (const satId of existingSatIds) {
            if (!currentSatIds.has(satId)) {
                mapMarkers[satId].forEach(item => map.removeLayer(item));
                delete mapMarkers[satId];
            }
        }

        function getSplitCoords(track) {
            const lines = [];
            let currentLine = [];
            for (let i = 0; i < track.length; i++) {
                const point = track[i];
                if (i > 0) {
                    const prev = track[i-1];
                    if (Math.abs(point.longitude - prev.longitude) > 180) {
                        lines.push(currentLine);
                        currentLine = [];
                    }
                }
                currentLine.push([point.latitude, point.longitude]);
            }
            if (currentLine.length > 0) lines.push(currentLine);
            return lines;
        }

        // Update or create markers
        for (const sat of data.satellites) {
            if (!mapMarkers[sat.satellite_id]) mapMarkers[sat.satellite_id] = [];
            
            const curr = sat.current_position;

            // Update or create current position marker
            if (mapMarkers[sat.satellite_id].length === 0) {
                const marker = L.circleMarker([curr.latitude, curr.longitude], {
                    radius: 7,
                    fillColor: '#c084fc',
                    color: '#a855f7',
                    weight: 2,
                    opacity: 0.95,
                    fillOpacity: 0.9
                }).bindPopup(`<b>${sat.satellite_id}</b><br>Alt: ${curr.altitude.toFixed(0)} km<br>Fuel: ${sat.fuel_kg.toFixed(1)} kg`);
                marker.addTo(map);
                mapMarkers[sat.satellite_id].push(marker);

                const histSplit = getSplitCoords(sat.historical_track);
                if (histSplit.length > 0) {
                    const line = L.polyline(histSplit, {
                        color: '#7b2fff',
                        weight: 2,
                        opacity: 0.55,
                        dashArray: '5, 5'
                    }).addTo(map);
                    mapMarkers[sat.satellite_id].push(line);
                }

                const predSplit = getSplitCoords(sat.predicted_track);
                if (predSplit.length > 0) {
                    const line = L.polyline(predSplit, {
                        color: '#c084fc',
                        weight: 2,
                        opacity: 0.65,
                        dashArray: '3, 3'
                    }).addTo(map);
                    mapMarkers[sat.satellite_id].push(line);
                }
            } else {
                // Just update marker position
                mapMarkers[sat.satellite_id][0].setLatLng([curr.latitude, curr.longitude]);
                // Update history and predicted lines
                if (mapMarkers[sat.satellite_id][1]) {
                    mapMarkers[sat.satellite_id][1].setLatLngs(getSplitCoords(sat.historical_track));
                }
                if (mapMarkers[sat.satellite_id][2]) {
                    mapMarkers[sat.satellite_id][2].setLatLngs(getSplitCoords(sat.predicted_track));
                }
            }
        }

        // Draw terminator shadow overlay (night zone)
        const existingTerminator = map._terminator;
        if (!existingTerminator && data.terminator_line && data.terminator_line.length > 1) {
            const term_coords = data.terminator_line.map(p => [p[0], p[1]]);
            const shadow = L.polygon(term_coords, {
                color: 'transparent',
                fillColor: '#000000',
                fillOpacity: 0.5,
                weight: 0,
                interactive: false
            }).addTo(map);
            map._terminator = shadow;
        } else if (existingTerminator && data.terminator_line) {
            existingTerminator.setLatLngs(data.terminator_line.map(p => [p[0], p[1]]));
        }

    } catch (e) {
        console.error('Error updating ground track map:', e);
    }
}

// ============================================================
// 2. CONJUNCTION BULLSEYE PLOT (Polar Chart)
// ============================================================
let bullseyeChart = null;
let lastBullseyeData = null;

function drawBullseyeChart(conjunctions) {
    const canvas = document.getElementById('bullseye-canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth;
    const h = canvas.height = canvas.offsetHeight;

    // Clear
    ctx.fillStyle = 'rgba(9, 8, 14, 0.96)';
    ctx.fillRect(0, 0, w, h);

    const centerX = w / 2;
    const centerY = h / 2;
    const radius = Math.min(w, h) / 2 - 40;

    // Draw grid circles (TCA in hours)
    for (let hours = 1; hours <= 6; hours++) {
        const r = (radius / 6) * hours;
        ctx.strokeStyle = `rgba(123, 47, 255, ${0.15 + hours * 0.06})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.stroke();

        // Label
        ctx.fillStyle = '#6b4faa';
        ctx.font = '10px monospace';
        ctx.fillText(`${hours}h`, centerX + r + 5, centerY - 5);
    }

    // Draw angle grid (radial lines every 30 degrees)
    ctx.strokeStyle = 'rgba(123, 47, 255, 0.15)';
    for (let deg = 0; deg < 360; deg += 30) {
        const rad = (deg * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(
            centerX + Math.cos(rad) * radius,
            centerY + Math.sin(rad) * radius
        );
        ctx.stroke();
    }

    // Draw center point (selected satellite)
    // Central satellite dot — bright purple
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#c084fc';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Plot debris
    for (const conj of conjunctions.slice(0, 15)) {
        const tca_hours = conj.time_to_ca_seconds / 3600;
        const angle = conj.approach_angle_deg;
        const r = (radius / 6) * Math.min(6, tca_hours);
        const rad = (angle * Math.PI) / 180;

        const x = centerX + Math.cos(rad) * r;
        const y = centerY + Math.sin(rad) * r;

        // Color by risk
        let color = '#4cff9f';
        if (conj.risk_level === 'red') color = '#ff3c5e';
        else if (conj.risk_level === 'yellow') color = '#ffca28';
        else if (conj.risk_level === 'orange') color = '#ffa500';

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();

        // Label
        ctx.fillStyle = color;
        ctx.font = 'bold 8px monospace';
        ctx.fillText(conj.debris_id.substring(0, 6), x + 8, y - 2);
    }

    // Legend
    ctx.fillStyle = '#6b4faa';
    ctx.font = '9px monospace';
    ctx.fillText('● Green = Safe', 20, h - 40);
    ctx.fillText('● Yellow = <5 km', 20, h - 25);
    ctx.fillText('● Red = <1 km', 20, h - 10);
}

async function updateBullseyeChart() {
    if (!selectedSatelliteId || !map.getContainer()) return;

    try {
        const response = await fetch(`${API_BASE}/api/conjunctions/${selectedSatelliteId}`);
        const data = await response.json();
        
        // Skip redraw if data hasn't changed
        if (lastBullseyeData && JSON.stringify(data.conjunctions.slice(0,5)) === JSON.stringify(lastBullseyeData.conjunctions.slice(0,5))) {
            return;
        }
        lastBullseyeData = data;
        
        drawBullseyeChart(data.conjunctions);
    } catch (e) {
        console.error('Error updating bullseye chart:', e);
    }
}

// ============================================================
// 3. TELEMETRY & RESOURCE HEATMAP
// ============================================================
let lastHeatmapData = null;

async function updateTelemetryHeatmap() {
    try {
        const response = await fetch(`${API_BASE}/api/telemetry-heatmap`);
        const data = await response.json();
        
        // Skip if no meaningful change
        if (lastHeatmapData && lastHeatmapData.fleet_fuel_total_kg === data.fleet_fuel_total_kg) {
            return;
        }
        lastHeatmapData = data;
        
        const container = document.getElementById('heatmap-container');
        container.innerHTML = '';

        for (const sat of data.satellites) {
            const percent = sat.fuel_percent;
            const color = percent > 50 ? '#4cff9f' : percent > 25 ? '#ffca28' : '#ff3c5e';

            const html = `
                <div class="fuel-bar">
                    <div class="fuel-bar-label">${sat.satellite_id}</div>
                    <div class="fuel-bar-fill" style="background: linear-gradient(90deg, #ff3c5e 0%, #ffca28 50%, #4cff9f 100%); width: ${percent}%;"></div>
                    <div class="fuel-bar-value">${sat.fuel_kg.toFixed(1)} kg</div>
                </div>
            `;
            container.innerHTML += html;
        }

        // Summary
        container.innerHTML += `
            <hr style="border: 1px solid rgba(123,47,255,0.25); margin: 12px 0;">
            <div style="padding: 8px; color: #c084fc;">
                <strong>Fleet Health</strong><br>
                Total Fuel: ${data.fleet_fuel_total_kg.toFixed(1)} kg<br>
                Average: ${data.fleet_health_percent.toFixed(1)}%
            </div>
        `;
    } catch (e) {
        console.error('Error updating telemetry heatmap:', e);
    }
}

// ============================================================
// 4. MANEUVER TIMELINE (Gantt Scheduler)
// ============================================================
let lastGanttData = null;

async function updateManeuverTimeline() {
    try {
        const response = await fetch(`${API_BASE}/api/maneuver-timeline`);
        const data = await response.json();
        
        // Skip if no changes
        if (lastGanttData && data.maneuvers.length === lastGanttData.maneuvers.length) {
            return;
        }
        lastGanttData = data;
        
        const container = document.getElementById('gantt-container');

        container.innerHTML = '';

        // Group by satellite
        const bySat = {};
        for (const event of data.maneuvers) {
            if (!bySat[event.satellite_id]) bySat[event.satellite_id] = [];
            bySat[event.satellite_id].push(event);
        }

        for (const [satId, events] of Object.entries(bySat)) {
            let html = `<div class="gantt-row">
                <div class="gantt-label">${satId}</div>
                <div class="gantt-timeline">`;

            for (const event of events) {
                const cls = event.event_type === 'COOLDOWN' ? 'cooldown-block' : 'burn-block';
                const width = Math.max(20, event.duration_seconds * 100 / 600) + 'px';

                html += `<div class="gantt-block ${cls}" style="width: ${width};" title="${event.event_type}: ${event.duration_seconds}s">${event.event_type.substring(0, 3)}</div>`;
            }

            html += '</div></div>';
            container.innerHTML += html;
        }

        if (!Object.keys(bySat).length) {
            container.innerHTML = '<p style="padding: 12px; color: #7b8fbb;">No maneuvers scheduled</p>';
        }
    } catch (e) {
        console.error('Error updating maneuver timeline:', e);
    }
}

// ============================================================
// MAIN UPDATE LOOP (Optimized)
// ============================================================
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 4000; // 4 seconds instead of 2

async function updateAllModules() {
    // Prevent overlapping updates
    if (updateInProgress) return;
    
    const now = Date.now();
    if (now - lastUpdateTime < UPDATE_INTERVAL) return;
    lastUpdateTime = now;
    
    updateInProgress = true;
    showLoadingIndicator(true);

    try {
        // Fetch status first
        const statusRes = await fetch(`${API_BASE}/api/status`);
        const status = await statusRes.json();
        document.getElementById('status-sats').textContent = `${status.satellites} Satellites`;
        document.getElementById('status-debris').textContent = `${status.debris} Debris`;

        // Fetch all data in parallel
        const [mapRes, bullsRes, heatRes, ganttRes] = await Promise.all([
            fetch(`${API_BASE}/api/ground-track`),
            fetch(`${API_BASE}/api/conjunctions/${selectedSatelliteId || 'SAT-001'}`),
            fetch(`${API_BASE}/api/telemetry-heatmap`),
            fetch(`${API_BASE}/api/maneuver-timeline`)
        ]);

        // Update modules independently (don't wait for all)
        updateGroundTrackMap();
        if (selectedSatelliteId) updateBullseyeChart();
        updateTelemetryHeatmap();
        updateManeuverTimeline();

    } catch (e) {
        console.error('Dashboard update error:', e);
    } finally {
        updateInProgress = false;
        showLoadingIndicator(false);
    }
}

function showLoadingIndicator(show) {
    const header = document.querySelector('.module-header');
    let indicator = document.getElementById('load-indicator');
    
    if (show) {
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'load-indicator';
            indicator.textContent = '⟳';
            indicator.style.cssText = `
                position: absolute;
                right: 20px;
                top: 50%;
                transform: translateY(-50%);
                color: #a855f7;
                font-size: 1.2em;
                animation: spin 1s linear infinite;
            `;
            header.style.position = 'relative';
            header.appendChild(indicator);
            
            if (!document.getElementById('spin-style')) {
                const style = document.createElement('style');
                style.id = 'spin-style';
                style.textContent = `
                    @keyframes spin {
                        from { transform: translateY(-50%) rotate(0deg); }
                        to { transform: translateY(-50%) rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }
        }
    } else if (indicator) {
        indicator.remove();
    }
}

// ============================================================
// INTERACTIVE CONTROLS
// ============================================================

// ── Toggle state (module-level so other functions can read it)
const toggleState = { grid: false, labels: false, orbits: true, info: false };
let gridLayer = null;

function createControlPanel() {
    const header = document.querySelector('.module-header');

    header.insertAdjacentHTML('beforeend', `
        <div style="margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <button id="btn-grid"    class="control-btn" title="Toggle lat/lon graticule">⊞ GRID</button>
            <button id="btn-labels"  class="control-btn" title="Toggle satellite labels">🏷 LABELS</button>
            <button id="btn-orbits"  class="control-btn btn-active" title="Toggle orbit tracks">🛸 ORBITS</button>
            <div style="width:1px;height:22px;background:rgba(123,47,255,0.3)"></div>
            <button id="btn-refresh" class="control-btn" title="Force refresh all data">↺ REFRESH</button>
            <button id="btn-info"    class="control-btn" title="Fleet info overlay">ℹ INFO</button>
        </div>
    `);

    // ── Shared button styles ──────────────────────────────────
    if (!document.getElementById('btn-styles')) {
        const s = document.createElement('style');
        s.id = 'btn-styles';
        s.textContent = `
            .control-btn {
                padding: 7px 13px;
                background: linear-gradient(135deg,rgba(123,47,255,.12),rgba(74,15,159,.08));
                border: 1px solid rgba(123,47,255,.45);
                color: #a855f7;
                font-family: 'Orbitron', sans-serif;
                font-size: .72em;
                letter-spacing: 1px;
                cursor: pointer;
                border-radius: 4px;
                transition: all .25s cubic-bezier(.4,0,.2,1);
                display: flex;
                align-items: center;
                gap: 5px;
                font-weight: 600;
                position: relative;
                overflow: hidden;
                white-space: nowrap;
            }
            .control-btn::before {
                content:'';
                position:absolute;
                top:0;left:-100%;
                width:100%;height:100%;
                background:linear-gradient(90deg,transparent,rgba(168,85,247,.2),transparent);
                transition:left .45s ease;
            }
            .control-btn:hover {
                background:linear-gradient(135deg,rgba(123,47,255,.22),rgba(74,15,159,.16));
                border-color:#a855f7;
                box-shadow:0 0 14px rgba(123,47,255,.4),inset 0 0 8px rgba(123,47,255,.1);
                color:#c084fc;
                transform:translateY(-1px);
            }
            .control-btn:hover::before{left:100%;}
            .control-btn:active{transform:translateY(0);box-shadow:0 0 8px rgba(123,47,255,.3);}
            .control-btn:disabled{opacity:.45;cursor:not-allowed;transform:none;}
            /* toggled-on */
            .btn-active {
                background:linear-gradient(135deg,rgba(123,47,255,.32),rgba(74,15,159,.26))!important;
                border-color:#c084fc!important;
                color:#e8d5ff!important;
                box-shadow:0 0 16px rgba(168,85,247,.4),inset 0 0 10px rgba(123,47,255,.18)!important;
            }
            .btn-active::after {
                content:'';
                position:absolute;
                bottom:0;left:0;right:0;
                height:2px;
                background:linear-gradient(90deg,#7b2fff,#c084fc,#7b2fff);
                background-size:200% 100%;
                animation:btnBar 2s linear infinite;
            }
            @keyframes btnBar{0%{background-position:0%}100%{background-position:200%}}

            /* ── Satellite label tooltips ── */
            .sat-tip {
                background:rgba(9,8,14,.9)!important;
                border:1px solid rgba(123,47,255,.6)!important;
                border-radius:3px!important;
                color:#c084fc!important;
                font-family:'Share Tech Mono',monospace!important;
                font-size:10px!important;
                padding:2px 6px!important;
                box-shadow:0 0 8px rgba(123,47,255,.3)!important;
                white-space:nowrap;
            }
            .sat-tip::before,.sat-tip::after{display:none!important;}

            /* ── Info overlay ── */
            #info-overlay {
                position:fixed;
                top:78px;right:18px;
                width:272px;
                background:rgba(9,8,14,.97);
                border:1px solid rgba(123,47,255,.5);
                border-radius:8px;
                box-shadow:0 0 40px rgba(123,47,255,.3),0 8px 32px rgba(0,0,0,.8);
                z-index:9000;
                font-family:'Share Tech Mono',monospace;
                overflow:hidden;
                animation:infoIn .2s ease-out;
            }
            @keyframes infoIn{
                from{opacity:0;transform:translateY(-8px) scale(.97)}
                to  {opacity:1;transform:translateY(0)    scale(1)}
            }
            #info-overlay.hidden{display:none}
            .io-header{
                padding:9px 14px;
                background:linear-gradient(90deg,rgba(123,47,255,.22),rgba(74,15,159,.1));
                border-bottom:1px solid rgba(123,47,255,.28);
                color:#c084fc;
                font-size:.76em;
                letter-spacing:2px;
                display:flex;justify-content:space-between;align-items:center;
            }
            .io-close{cursor:pointer;color:#6b4faa;font-size:1.1em;transition:color .2s}
            .io-close:hover{color:#c084fc}
            .io-body{padding:11px 14px}
            .io-row{
                display:flex;justify-content:space-between;align-items:center;
                padding:5px 0;
                border-bottom:1px solid rgba(123,47,255,.1);
                font-size:.73em;
            }
            .io-row:last-child{border-bottom:none}
            .io-k{color:#6b4faa;letter-spacing:1px}
            .io-v{color:#c084fc;font-weight:700}
            .io-v.warn{color:#f97316}
            .io-v.safe{color:#a855f7}
            .io-v.danger{color:#ef4444}
            .io-sep{
                height:1px;
                background:linear-gradient(90deg,transparent,rgba(123,47,255,.28),transparent);
                margin:7px 0;
            }
            .io-sec{color:#5a4880;font-size:.6em;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px}
        `;
        document.head.appendChild(s);
    }

    // ── 1. GRID ───────────────────────────────────────────────
    function buildGrid() {
        if (gridLayer) { map.removeLayer(gridLayer); gridLayer = null; }
        const layers = [];
        // Latitude parallels every 30°
        for (let lat = -90; lat <= 90; lat += 30) {
            const pts = [];
            for (let lng = -180; lng <= 180; lng += 4) pts.push([lat, lng]);
            layers.push(L.polyline(pts, {
                color: lat === 0 ? 'rgba(168,85,247,0.55)' : 'rgba(123,47,255,0.28)',
                weight: lat === 0 ? 1.5 : 1,
                dashArray: lat === 0 ? null : '5,5',
                interactive: false
            }));
        }
        // Longitude meridians every 30°
        for (let lng = -180; lng <= 180; lng += 30) {
            const pts = [];
            for (let lat = -90; lat <= 90; lat += 4) pts.push([lat, lng]);
            layers.push(L.polyline(pts, {
                color: lng === 0 ? 'rgba(168,85,247,0.55)' : 'rgba(123,47,255,0.28)',
                weight: lng === 0 ? 1.5 : 1,
                dashArray: lng === 0 ? null : '5,5',
                interactive: false
            }));
        }
        // Degree labels
        for (let lat = -60; lat <= 60; lat += 30) {
            for (let lng = -150; lng <= 150; lng += 60) {
                layers.push(L.marker([lat, lng], {
                    icon: L.divIcon({
                        className: '',
                        html: `<span style="color:rgba(168,85,247,.5);font-size:9px;font-family:monospace;white-space:nowrap;pointer-events:none">${lat>0?'+':''}${lat}°/${lng>0?'+':''}${lng}°</span>`,
                        iconAnchor: [0, 0]
                    }),
                    interactive: false
                }));
            }
        }
        gridLayer = L.layerGroup(layers).addTo(map);
    }

    document.getElementById('btn-grid').addEventListener('click', () => {
        toggleState.grid = !toggleState.grid;
        document.getElementById('btn-grid').classList.toggle('btn-active', toggleState.grid);
        if (toggleState.grid) {
            buildGrid();
            showNotification('📐 Graticule grid ON', 'info');
        } else {
            if (gridLayer) { map.removeLayer(gridLayer); gridLayer = null; }
            showNotification('📐 Graticule grid OFF', 'info');
        }
    });

    // ── 2. LABELS ────────────────────────────────────────────
    function applyLabels() {
        for (const satId of Object.keys(mapMarkers)) {
            const marker = mapMarkers[satId][0];
            if (!marker || typeof marker.getLatLng !== 'function') continue;
            if (toggleState.labels) {
                marker.bindTooltip(satId, {
                    permanent: true, direction: 'right',
                    className: 'sat-tip', offset: [10, 0]
                }).openTooltip();
            } else {
                if (marker.getTooltip()) marker.unbindTooltip();
            }
        }
    }

    document.getElementById('btn-labels').addEventListener('click', () => {
        toggleState.labels = !toggleState.labels;
        document.getElementById('btn-labels').classList.toggle('btn-active', toggleState.labels);
        applyLabels();
        showNotification(toggleState.labels ? '🏷 Labels ON' : '🏷 Labels OFF', 'info');
    });

    // ── 3. ORBITS ────────────────────────────────────────────
    function applyOrbits() {
        for (const satId of Object.keys(mapMarkers)) {
            const layers = mapMarkers[satId];
            // index 1 = historical dashed, index 2 = predicted dashed
            for (let i = 1; i < layers.length; i++) {
                const layer = layers[i];
                if (!layer || typeof layer.setStyle !== 'function') continue;
                layer.setStyle({
                    opacity: toggleState.orbits ? (i === 1 ? 0.55 : 0.65) : 0
                });
            }
        }
    }

    document.getElementById('btn-orbits').addEventListener('click', () => {
        toggleState.orbits = !toggleState.orbits;
        const btn = document.getElementById('btn-orbits');
        btn.classList.toggle('btn-active', toggleState.orbits);
        applyOrbits();
        showNotification(toggleState.orbits ? '🛸 Orbit tracks visible' : '🛸 Orbit tracks hidden', 'info');
    });

    // ── 4. REFRESH ───────────────────────────────────────────
    document.getElementById('btn-refresh').addEventListener('click', async () => {
        const btn = document.getElementById('btn-refresh');
        btn.disabled = true;
        btn.textContent = '↻ LOADING…';
        btn.classList.add('btn-active');

        // Hard-reset all data caches so updateAllModules fetches fresh
        lastUpdateTime   = 0;
        lastMapData      = null;
        lastBullseyeData = null;
        lastHeatmapData  = null;
        lastGanttData    = null;

        await updateAllModules();

        // Re-apply visual toggles after fresh data renders
        applyOrbits();
        if (toggleState.labels) applyLabels();
        if (toggleState.grid && gridLayer) { map.removeLayer(gridLayer); buildGrid(); }

        btn.disabled = false;
        btn.textContent = '↺ REFRESH';
        btn.classList.remove('btn-active');
        showNotification('✓ All modules refreshed', 'info');
    });

    // ── 5. INFO overlay ──────────────────────────────────────
    async function fetchInfoData() {
        const [statusRes, heatRes] = await Promise.all([
            fetch(`${API_BASE}/api/status`),
            fetch(`${API_BASE}/api/telemetry-heatmap`)
        ]);
        return {
            status : await statusRes.json(),
            heat   : await heatRes.json()
        };
    }

    async function renderInfoOverlay() {
        const body = document.getElementById('io-body');
        if (!body) return;
        try {
            const { status, heat } = await fetchInfoData();
            const avgFuel   = heat.fleet_health_percent.toFixed(1);
            const totalFuel = heat.fleet_fuel_total_kg.toFixed(1);
            const warnCls   = status.critical_warnings > 0 ? 'danger' : 'safe';

            const satRows = heat.satellites.map(s => {
                const cls = s.fuel_percent < 25 ? 'danger' : s.fuel_percent < 50 ? 'warn' : 'safe';
                return `<div class="io-row">
                    <span class="io-k">${s.satellite_id}</span>
                    <span class="io-v ${cls}">${s.fuel_percent.toFixed(1)}%&nbsp;&nbsp;${s.fuel_kg.toFixed(1)} kg</span>
                </div>`;
            }).join('');

            body.innerHTML = `
                <div class="io-sec">Fleet Status</div>
                <div class="io-row"><span class="io-k">TOTAL OBJECTS</span><span class="io-v">${status.total_objects}</span></div>
                <div class="io-row"><span class="io-k">SATELLITES</span><span class="io-v safe">${status.satellites}</span></div>
                <div class="io-row"><span class="io-k">DEBRIS TRACKED</span><span class="io-v warn">${status.debris}</span></div>
                <div class="io-row"><span class="io-k">CDM WARNINGS</span><span class="io-v ${warnCls}">${status.critical_warnings}</span></div>
                <div class="io-sep"></div>
                <div class="io-sec">Fuel Budget</div>
                <div class="io-row"><span class="io-k">TOTAL FUEL</span><span class="io-v">${totalFuel} kg</span></div>
                <div class="io-row"><span class="io-k">FLEET AVG</span><span class="io-v ${avgFuel < 40 ? 'warn' : 'safe'}">${avgFuel}%</span></div>
                <div class="io-sep"></div>
                <div class="io-sec">Per Satellite</div>
                ${satRows}
                <div class="io-sep"></div>
                <div style="color:#5a4880;font-size:.6em;text-align:right;padding-top:3px">
                    ${new Date().toUTCString().slice(17,25)} UTC
                </div>
            `;
        } catch(e) {
            if (body) body.innerHTML = `<div style="color:#ef4444;font-size:.72em;padding:8px">⚠ Could not load fleet data</div>`;
        }
    }

    function showInfoOverlay() {
        let el = document.getElementById('info-overlay');
        if (!el) {
            el = document.createElement('div');
            el.id = 'info-overlay';
            el.innerHTML = `
                <div class="io-header">
                    ◈ FLEET TELEMETRY
                    <span class="io-close" id="io-close">✕</span>
                </div>
                <div class="io-body" id="io-body">
                    <div style="color:#5a4880;font-size:.72em;text-align:center;padding:10px">Fetching…</div>
                </div>
            `;
            document.body.appendChild(el);
            document.getElementById('io-close').addEventListener('click', () => {
                toggleState.info = false;
                el.classList.add('hidden');
                document.getElementById('btn-info').classList.remove('btn-active');
            });
        }
        el.classList.remove('hidden');
        renderInfoOverlay();
    }

    document.getElementById('btn-info').addEventListener('click', () => {
        toggleState.info = !toggleState.info;
        document.getElementById('btn-info').classList.toggle('btn-active', toggleState.info);
        if (toggleState.info) {
            showInfoOverlay();
        } else {
            const el = document.getElementById('info-overlay');
            if (el) el.classList.add('hidden');
        }
    });

    // Auto-refresh info data every 8 s while panel is open
    setInterval(() => {
        if (toggleState.info) renderInfoOverlay();
    }, 8000);
}

async function exportData() {
    try {
        const response = await fetch(`${API_BASE}/api/states`);
        const states = await response.json();
        
        const dataStr = JSON.stringify(states, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `akashveer-export-${new Date().toISOString().slice(0,10)}.json`;
        link.click();
        
        showNotification('✓ Data exported successfully', 'success');
    } catch (e) {
        showNotification('✗ Export failed', 'error');
    }
}

function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 16px;
        background: ${type === 'success' ? 'rgba(123,47,255,0.9)' : type === 'error' ? 'rgba(255,60,94,0.9)' : 'rgba(74,15,159,0.92)'};
        color: #05080f;
        border-radius: 4px;
        font-family: 'Rajdhani', sans-serif;
        font-weight: 600;
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
    `;
    notif.textContent = message;
    document.body.appendChild(notif);
    
    setTimeout(() => {
        notif.style.animation = 'slideOut 0.3s ease-out forwards';
        setTimeout(() => notif.remove(), 300);
    }, 2500);
}

// Add notification animations
if (!document.getElementById('notif-styles')) {
    const style = document.createElement('style');
    style.id = 'notif-styles';
    style.textContent = `
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateX(100px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
        
        @keyframes slideOut {
            from {
                opacity: 1;
                transform: translateX(0);
            }
            to {
                opacity: 0;
                transform: translateX(100px);
            }
        }
    `;
    document.head.appendChild(style);
}

// ============================================================
// INITIALIZATION
// ============================================================
window.addEventListener('load', async () => {
    createControlPanel();
    initGroundTrackMap();

    // Select first satellite by default
    const response = await fetch(`${API_BASE}/api/states`);
    const states = await response.json();
    if (states.objects.length > 0) {
        const sats = states.objects.filter(o => o.type === 'SATELLITE');
        if (sats.length > 0) selectedSatelliteId = sats[0].id;
    }

    // Initial updates with fade-in
    showNotification('🚀 Dashboard initialized', 'success');
    await updateAllModules();

    // Periodic updates (every 4 seconds - optimized for performance)
    setInterval(updateAllModules, 4000);

    // Allow clicking on satellites to select them
    map.on('click', async (e) => {
        const response = await fetch(`${API_BASE}/api/states`);
        const states = await response.json();
        
        for (const obj of states.objects) {
            if (obj.type !== 'SATELLITE') continue;
            
            // Simple distance check
            const dist = Math.pow(e.latlng.lat - obj.pos[2]/6378.137, 2) + Math.pow(e.latlng.lng - obj.pos[0]/6378.137, 2);
            if (dist < 0.01) {
                selectedSatelliteId = obj.id;
                await updateBullseyeChart();
                showNotification(`📡 Selected: ${selectedSatelliteId}`, 'info');
                break;
            }
        }
    });
});
