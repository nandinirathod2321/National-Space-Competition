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

        // Clear old markers
        map.eachLayer(layer => {
            if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                map.removeLayer(layer);
            }
        });

        // Plot current positions
        for (const sat of data.satellites) {
            const curr = sat.current_position;

            // Current position marker
            L.circleMarker([curr.latitude, curr.longitude], {
                radius: 6,
                fillColor: '#00e4ff',
                color: '#00f0ff',
                weight: 2,
                opacity: 0.9,
                fillOpacity: 0.8
            })
            .bindPopup(`<b>${sat.satellite_id}</b><br>Alt: ${curr.alt_km.toFixed(0)} km<br>Fuel: ${sat.fuel_kg.toFixed(1)} kg`)
            .addTo(map);

            // Historical trail (faded)
            const hist_coords = sat.historical_track.map(p => [p.latitude, p.longitude]);
            if (hist_coords.length > 1) {
                L.polyline(hist_coords, {
                    color: '#7b2fff',
                    weight: 1,
                    opacity: 0.3,
                    dashArray: '5, 5'
                }).addTo(map);
            }

            // Predicted trajectory (dashed, bright)
            const pred_coords = sat.predicted_track.map(p => [p.latitude, p.longitude]);
            if (pred_coords.length > 1) {
                L.polyline(pred_coords, {
                    color: '#00e4ff',
                    weight: 2,
                    opacity: 0.6,
                    dashArray: '3, 3'
                }).addTo(map);
            }
        }

        // Terminator line (day/night boundary)
        if (data.terminator_line && data.terminator_line.length > 1) {
            const term_coords = data.terminator_line.map(p => [p[0], p[1]]);
            L.polyline(term_coords, {
                color: '#ffaa00',
                weight: 2,
                opacity: 0.5,
                dashArray: '8, 4'
            })
            .bindPopup('Terminator Line (Day/Night)')
            .addTo(map);
        }

    } catch (e) {
        console.error('Error updating ground track map:', e);
    }
}

// ============================================================
// 2. CONJUNCTION BULLSEYE PLOT (Polar Chart)
// ============================================================
let bullseyeChart = null;

function drawBullseyeChart(conjunctions) {
    const canvas = document.getElementById('bullseye-canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth;
    const h = canvas.height = canvas.offsetHeight;

    // Clear
    ctx.fillStyle = 'rgba(5, 8, 15, 0.9)';
    ctx.fillRect(0, 0, w, h);

    const centerX = w / 2;
    const centerY = h / 2;
    const radius = Math.min(w, h) / 2 - 40;

    // Draw grid circles (TCA in hours)
    for (let hours = 1; hours <= 6; hours++) {
        const r = (radius / 6) * hours;
        ctx.strokeStyle = `rgba(0, 228, 255, ${0.15 + hours * 0.05})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.stroke();

        // Label
        ctx.fillStyle = '#7b8fbb';
        ctx.font = '10px monospace';
        ctx.fillText(`${hours}h`, centerX + r + 5, centerY - 5);
    }

    // Draw angle grid (radial lines every 30 degrees)
    ctx.strokeStyle = 'rgba(0, 228, 255, 0.1)';
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
    ctx.fillStyle = '#00e4ff';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
    ctx.fill();

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
    ctx.fillStyle = '#7b8fbb';
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
        drawBullseyeChart(data.conjunctions);
    } catch (e) {
        console.error('Error updating bullseye chart:', e);
    }
}

// ============================================================
// 3. TELEMETRY & RESOURCE HEATMAP
// ============================================================
async function updateTelemetryHeatmap() {
    try {
        const response = await fetch(`${API_BASE}/api/telemetry-heatmap`);
        const data = await response.json();
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
            <hr style="border: 1px solid rgba(0,228,255,0.2); margin: 12px 0;">
            <div style="padding: 8px; color: #00e4ff;">
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
async function updateManeuverTimeline() {
    try {
        const response = await fetch(`${API_BASE}/api/maneuver-timeline`);
        const data = await response.json();
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
// MAIN UPDATE LOOP
// ============================================================
async function updateAllModules() {
    try {
        const response = await fetch(`${API_BASE}/api/status`);
        const status = await response.json();

        document.getElementById('status-sats').textContent = `${status.satellites} Satellites`;
        document.getElementById('status-debris').textContent = `${status.debris} Debris`;

        await updateGroundTrackMap();
        await updateBullseyeChart();
        await updateTelemetryHeatmap();
        await updateManeuverTimeline();
    } catch (e) {
        console.error('Dashboard update error:', e);
    }
}

// ============================================================
// INTERACTIVE CONTROLS
// ============================================================
function createControlPanel() {
    const header = document.querySelector('.module-header');
    
    const controlsHTML = `
        <div style="margin-left: auto; display: flex; gap: 8px;">
            <button id="btn-refresh" class="control-btn" title="Refresh all data">
                🔄 REFRESH
            </button>
            <button id="btn-fullscreen" class="control-btn" title="Toggle fullscreen">
                ⛶ VIEW
            </button>
            <button id="btn-export" class="control-btn" title="Export mission data">
                💾 EXPORT
            </button>
        </div>
    `;
    
    header.insertAdjacentHTML('beforeend', controlsHTML);
    
    // Add button styles dynamically
    if (!document.getElementById('btn-styles')) {
        const style = document.createElement('style');
        style.id = 'btn-styles';
        style.textContent = `
            .control-btn {
                padding: 8px 14px;
                background: linear-gradient(135deg, rgba(0,228,255,0.1), rgba(123,47,255,0.1));
                border: 1px solid rgba(0, 228, 255, 0.4);
                color: #00e4ff;
                font-family: 'Orbitron', sans-serif;
                font-size: 0.75em;
                letter-spacing: 1px;
                cursor: pointer;
                border-radius: 4px;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                display: flex;
                align-items: center;
                gap: 4px;
                font-weight: 600;
                position: relative;
                overflow: hidden;
            }
            
            .control-btn::before {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
                transition: left 0.5s ease;
            }
            
            .control-btn:hover {
                background: linear-gradient(135deg, rgba(0,228,255,0.2), rgba(123,47,255,0.2));
                border-color: #00e4ff;
                box-shadow: 0 0 12px rgba(0, 228, 255, 0.4), inset 0 0 8px rgba(0, 228, 255, 0.1);
                transform: translateY(-1px);
            }
            
            .control-btn:hover::before {
                left: 100%;
            }
            
            .control-btn:active {
                transform: translateY(0px);
                box-shadow: 0 0 8px rgba(0, 228, 255, 0.3), inset 0 0 12px rgba(0, 228, 255, 0.2);
            }
        `;
        document.head.appendChild(style);
    }
    
    // Attach event listeners
    document.getElementById('btn-refresh').addEventListener('click', updateAllModules);
    
    document.getElementById('btn-fullscreen').addEventListener('click', () => {
        const grid = document.querySelector('.dashboard-grid');
        grid.style.gap = grid.style.gap === '4px' ? '12px' : '4px';
    });
    
    document.getElementById('btn-export').addEventListener('click', exportData);
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
        background: ${type === 'success' ? 'rgba(76,255,159,0.9)' : type === 'error' ? 'rgba(255,60,94,0.9)' : 'rgba(0,228,255,0.9)'};
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

    // Periodic updates (every 2 seconds)
    setInterval(updateAllModules, 2000);

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
