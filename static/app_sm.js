const API_BASE = window.location.origin;

// ============================================================
// MANNING EQUATION — Culvert Capacity (client-side)
// ============================================================
const NUM_TUBES = 11;
const TUBE_D = 45 * 0.0254;      // 1.143 m
const MANNING_N = 0.024;         // corrugated metal
const SLOPE = 0.015;             // 1.5%
const FILL_M = 0.60;            // fill above pipes
const EMBANKMENT_H = TUBE_D + FILL_M;  // ~1.74m

const TUBE_A = Math.PI * TUBE_D * TUBE_D / 4;
const TUBE_R = TUBE_D / 4;
const Q_PER_TUBE = (1.0 / MANNING_N) * TUBE_A * Math.pow(TUBE_R, 2/3) * Math.pow(SLOPE, 0.5);
let Q_TOTAL = Q_PER_TUBE * NUM_TUBES; // Max clean capacity

// Sedimentation tracking (0.0 to 1.0)
let tubeSediment = Array(NUM_TUBES).fill(0).map(() => 0.05 + Math.random() * 0.15); // Random 5-20% initial sediment

function getEffectiveCapacity() {
    let cap = 0;
    for (let s of tubeSediment) {
        if (s < 0.95) cap += Q_PER_TUBE * (1.0 - s); // Simplification: capacity proportional to remaining height
    }
    return cap;
}

// Show capacity on load
document.addEventListener('DOMContentLoaded', () => {
    initTubesUI();
    updateTubesUI(0);
});

const ALERT_COLORS = { safe:'#00cc55', caution:'#eebb00', warning:'#ff8800', danger:'#ff3322', overflow:'#ff0000', collapse:'#cc0000' };

function getAlert(pct) {
    if (pct < 30) return ['safe', 'Normal'];
    if (pct < 60) return ['caution', 'Precaución'];
    if (pct < 85) return ['warning', 'Alerta'];
    if (pct < 100) return ['danger', 'Peligro'];
    if (pct < 150) return ['overflow', 'DESBORDAMIENTO'];
    return ['collapse', 'COLAPSO TERRAPLÉN'];
}

// Simulate natural discharge based on time of day
function riverDischarge(date) {
    const h = date.getHours();
    const m = date.getMinutes();
    const t = h + m / 60;
    const daySeed = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
    const pr = (x) => ((Math.sin(x * 127.1 + daySeed * 0.0173) * 43758.5453) % 1 + 1) % 1;

    // Daily pattern: slightly higher in afternoon (convective rain)
    const cycle = 1.0 + 0.2 * Math.sin((t - 6) * Math.PI / 12);
    const noise = 0.15 * (pr(h * 60 + m) - 0.5) + 0.05 * Math.sin(m * 0.7 + h * 2.1);

    // Base: ~2.5 m³/s mean
    const Q = Math.max(0.5, 2.5 * cycle + noise);
    return Math.round(Q * 100) / 100;
}

// ============================================================
// CLOCK
// ============================================================
function updateClock() {
    const now = new Date();
    document.getElementById('clock').textContent =
        `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    document.getElementById('date-display').textContent = `${dias[now.getDay()]} ${now.getDate()} de ${meses[now.getMonth()]} ${now.getFullYear()}`;
}
setInterval(updateClock, 1000);
updateClock();

// ============================================================
// CHARTS
// ============================================================
// Hourly Chart
const ctxHourly = document.getElementById('hourly-chart').getContext('2d');
const hourlyChart = new Chart(ctxHourly, {
    type: 'line',
    data: { labels: [], datasets: [
        { label: '% Capacidad Tubos', data: [], borderColor: '#ff9900', backgroundColor: 'rgba(255,153,0,0.1)', borderWidth: 2.5, tension: 0.3, pointRadius: 0, fill: true },
        { label: 'Caudal (m³/s)', data: [], borderColor: '#00bbff', borderWidth: 2, borderDash: [5, 4], tension: 0.3, pointRadius: 0, fill: false, yAxisID: 'y2' }
    ]},
    options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 200 },
        scales: {
            x: { ticks: { color: '#666', font: { size: 8 }, maxTicksLimit: 12 }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { title: { display: true, text: '% Capacidad', color: '#ff9900', font: { size: 9 } }, ticks: { color: '#666', font: { size: 8 } }, grid: { color: 'rgba(255,255,255,0.08)' }, min: 0, max: 120, suggestedMax: 120 },
            y2: { position: 'right', title: { display: true, text: 'Q (m³/s)', color: '#00bbff', font: { size: 9 } }, ticks: { color: '#666', font: { size: 8 } }, grid: { display: false }, min: 0, max: 40 }
        },
        plugins: { legend: { labels: { color: '#ccc', font: { size: 9 }, boxWidth: 10, padding: 4 }, position: 'top' } }
    },
    plugins: [{
        id: 'overflowLineHourly',
        afterDraw: (c) => {
            const y = c.scales.y.getPixelForValue(100);
            const ctx2 = c.ctx;
            ctx2.save(); ctx2.strokeStyle = '#ff0000'; ctx2.lineWidth = 1.5; ctx2.setLineDash([8, 4]);
            ctx2.beginPath(); ctx2.moveTo(c.chartArea.left, y); ctx2.lineTo(c.chartArea.right, y);
            ctx2.stroke(); ctx2.fillStyle = '#ff4444'; ctx2.font = 'bold 8px Segoe UI';
            ctx2.fillText('⚠ DESBORDE 100%', c.chartArea.left + 4, y - 5);
            ctx2.restore();
        }
    }]
});

// Weekly Chart
const ctxWeekly = document.getElementById('weekly-chart').getContext('2d');
const weeklyChart = new Chart(ctxWeekly, {
    type: 'bar',
    data: { 
        labels: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'], 
        datasets: [{ label: 'Caudal Medio (m³/s)', data: [0,0,0,0,0,0,0], backgroundColor: '#00bbff', borderRadius: 4 }]
    },
    options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 200 },
        scales: {
            x: { ticks: { color: '#666', font: { size: 8 } }, grid: { display: false } },
            y: { title: { display: false }, ticks: { color: '#666', font: { size: 8 } }, grid: { color: 'rgba(255,255,255,0.08)' }, min: 0, suggestedMax: 20 }
        },
        plugins: { legend: { display: false } }
    }
});

let weeklyDataSums = [0,0,0,0,0,0,0];
let weeklyDataCounts = [0,0,0,0,0,0,0];

function clearChart() {
    hourlyChart.data.labels = [];
    hourlyChart.data.datasets.forEach(ds => ds.data = []);
    hourlyChart.update('none');
    
    weeklyDataSums = [0,0,0,0,0,0,0];
    weeklyDataCounts = [0,0,0,0,0,0,0];
    weeklyChart.data.datasets[0].data = [0,0,0,0,0,0,0];
    weeklyChart.update('none');
}

function updateWeeklyChart(dateObj, Q) {
    if (!dateObj) return;
    let day = dateObj.getDay(); // 0 is Sunday
    let idx = day === 0 ? 6 : day - 1; // 0=Monday, 6=Sunday
    weeklyDataSums[idx] += Q;
    weeklyDataCounts[idx] += 1;
    weeklyChart.data.datasets[0].data[idx] = Math.round((weeklyDataSums[idx] / weeklyDataCounts[idx]) * 100) / 100;
    weeklyChart.update();
}

function addPointHourly(label, pct, Q) {
    hourlyChart.data.labels.push(label);
    hourlyChart.data.datasets[0].data.push(pct);
    hourlyChart.data.datasets[1].data.push(Q);
    if (hourlyChart.data.labels.length > 144) { // Keep last 144 points
        hourlyChart.data.labels.shift();
        hourlyChart.data.datasets.forEach(ds => ds.data.shift());
    }
    hourlyChart.update();
}

// ============================================================
// UI UPDATES
// ============================================================
function updateGauge(pct, alertCode) {
    const fill = document.getElementById('gauge-fill');
    const pctEl = document.getElementById('gauge-pct');
    fill.style.width = Math.min(pct, 200) / 2 + '%'; // scale: 200% = full bar
    fill.textContent = pct + '%';
    fill.className = `gauge-bar-fill ${alertCode}`;
    pctEl.textContent = pct + '%';
}

function updateAlert(alertCode, alertLabel) {
    const box = document.getElementById('alert-box');
    const icons = { safe: '●', caution: '⚠', warning: '⚠', danger: '🔴', overflow: '🌊', collapse: '💀' };
    box.className = `alert-box ${alertCode}`;
    box.textContent = `${icons[alertCode] || '●'} ${alertLabel}`;
}

let lastPrecipVal = null;
function checkPrecipJump(currentPrecip) {
    const precipInfo = document.getElementById('info-precip');
    if (!precipInfo) return;
    precipInfo.textContent = currentPrecip;
    
    if (lastPrecipVal !== null) {
        const diff = currentPrecip - lastPrecipVal;
        if (diff >= 5) { // Súbito aumento de +5mm/h
            precipInfo.classList.add('precip-alert');
            updateAlert('warning', `🌧 ¡ALERTA! Aumento súbito de lluvias (+${diff.toFixed(1)} mm/h)`);
        } else if (diff < 0 || currentPrecip < 5) {
            precipInfo.classList.remove('precip-alert');
        }
    }
    lastPrecipVal = currentPrecip;
}

function updateFlowInfo(Q, waterLevel, overflow) {
    document.getElementById('info-q').textContent = Q;
    document.getElementById('info-wl').textContent = waterLevel;
    document.getElementById('info-overflow').textContent = overflow;
}

function processReading(Q, label, forcedPrecip = null, dateObj = null) {
    const effCap = getEffectiveCapacity();
    const pct = Math.round((Q / effCap) * 1000) / 10;
    const [alertCode, alertLabel] = getAlert(pct);
    const overflow = Math.max(0, Q - effCap);
    let wl;
    if (Q <= effCap) wl = TUBE_D * Math.pow(Q / effCap, 0.5);
    else wl = EMBANKMENT_H * Math.pow(Q / effCap, 0.4);

    // Sedimentation model: higher discharge brings more sediment
    // If Q > 15 m3/s, considerable sediment transport.
    const sedimentRate = (Q > 15) ? 0.005 : 0.0005; 
    for (let i = 0; i < NUM_TUBES; i++) {
        // Randomly increase sediment slightly
        if (Math.random() < 0.3) {
            tubeSediment[i] = Math.min(1.0, tubeSediment[i] + sedimentRate * Math.random());
        }
    }

    addPointHourly(label, pct, Q);
    if (dateObj) updateWeeklyChart(dateObj, Q);
    updateGauge(pct, alertCode);
    updateAlert(alertCode, alertLabel);
    
    // Default or forced precipitation UI update
    if (forcedPrecip !== null) {
        checkPrecipJump(forcedPrecip);
    }
    
    updateFlowInfo(Math.round(Q * 100) / 100, Math.round(wl * 100) / 100, Math.round(overflow * 10) / 10);
    updateTubesUI(wl);

    // Update crossing marker color
    const el = document.getElementById('crossing-marker');
    if (el) {
        el.style.backgroundColor = ALERT_COLORS[alertCode] || '#888';
        if (alertCode === 'overflow' || alertCode === 'collapse') {
            el.style.boxShadow = '0 0 16px rgba(255,0,0,0.8)';
        } else {
            el.style.boxShadow = '0 0 6px rgba(0,0,0,0.5)';
        }
    }
}

// ============================================================
// CROSSING MARKER
// ============================================================
let crossingMarker = null;
function createCrossingMarker() {
    if (crossingMarker) crossingMarker.remove();
    const el = document.createElement('div');
    el.id = 'crossing-marker';
    el.style.cssText = 'width:14px;height:14px;border-radius:50%;border:2px solid white;background:#888;transition:background-color 0.5s ease, box-shadow 0.5s ease;box-shadow:0 0 6px rgba(0,0,0,0.5);';
    crossingMarker = new maplibregl.Marker({ element: el })
        .setLngLat([-73.861232, 11.268873])
        .setPopup(new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(
            `<div style="color:#222;font-size:11px;font-weight:600">Paso Provisional</div>
             <div style="color:#444;font-size:10px">11 tubos × 45" | Cap Limpia: ${Q_TOTAL.toFixed(1)} m³/s</div>
             <div style="color:#444;font-size:10px">Río: 51m (tubos 21m + dique 30m)</div>`
        ))
        .addTo(map);
}

// ============================================================
// TUBES UI
// ============================================================
function initTubesUI() {
    const grid = document.getElementById('tubes-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 0; i < NUM_TUBES; i++) {
        grid.innerHTML += `
            <div class="tube-wrapper">
                <div class="tube" id="tube-${i}">
                    <div class="tube-sediment" id="tube-sed-${i}"></div>
                    <div class="tube-water" id="tube-wat-${i}"></div>
                </div>
                <div class="tube-label">T${i+1}</div>
            </div>
        `;
    }
}

function updateTubesUI(waterLevelMeters) {
    const effCap = getEffectiveCapacity();
    document.getElementById('capacity-val').textContent = effCap.toFixed(1);

    let avgSed = 0;
    for (let i = 0; i < NUM_TUBES; i++) {
        const sedPct = tubeSediment[i] * 100;
        avgSed += sedPct;
        
        const sedEl = document.getElementById(`tube-sed-${i}`);
        const watEl = document.getElementById(`tube-wat-${i}`);
        
        if (sedEl) {
            sedEl.style.height = `${sedPct}%`;
            if (sedPct > 90) sedEl.classList.add('plugged');
            else sedEl.classList.remove('plugged');
        }
        
        if (watEl) {
            // Water sits on top of sediment.
            // waterLevelMeters is max ~1.14 inside tube.
            const waterTotalPct = (waterLevelMeters / TUBE_D) * 100;
            const visWaterPct = Math.max(0, Math.min(100 - sedPct, waterTotalPct - sedPct)); // Approximated visual
            watEl.style.height = `${visWaterPct + sedPct}%`;
        }
    }
    
    avgSed /= NUM_TUBES;
    const stat = document.getElementById('tubes-status');
    if (stat) {
        stat.textContent = `Taponamiento prom: ${avgSed.toFixed(1)}%`;
        if (avgSed > 50) stat.style.color = '#ff4444';
        else if (avgSed > 25) stat.style.color = '#ff9900';
        else stat.style.color = '#00ddff';
    }
}

// ============================================================
// METEO PREDICTOR UI
// ============================================================
function updateMeteoUI(riskObj) {
    const pnl = document.getElementById('meteo-panel');
    const lvl = document.getElementById('meteo-risk-level');
    const clo = document.getElementById('meteo-clouds');
    const hum = document.getElementById('meteo-hum');
    const pre = document.getElementById('meteo-press');
    const wnd = document.getElementById('meteo-wind');
    const fac = document.getElementById('meteo-factors');
    
    if(!pnl || !riskObj) return;
    
    pnl.className = `meteo-panel ${riskObj.level}`;
    lvl.textContent = `${riskObj.level.toUpperCase()} (${riskObj.score}/100)`;
    
    const cond = riskObj.current_conditions || {};
    clo.textContent = (cond.cloud_cover !== null ? cond.cloud_cover : '--') + '%';
    hum.textContent = (cond.humidity !== null ? cond.humidity : '--') + '%';
    pre.textContent = cond.pressure !== null ? cond.pressure : '--';
    
    if (cond.wind_speed !== null && cond.wind_direction !== null) {
        // Rotate down arrow to match wind direction (wind direction is where it blows FROM, so 0=N blows South)
        wnd.innerHTML = `${cond.wind_speed} <span style="font-size:8px">km/h</span> <div style="display:inline-block; font-size:10px; transform:rotate(${cond.wind_direction}deg)">↓</div>`;
    } else {
        wnd.textContent = '--';
    }
    
    if (riskObj.factors && riskObj.factors.length > 0) {
        fac.innerHTML = `⚠️ ` + riskObj.factors.join(' &nbsp;|&nbsp; ');
    } else {
        fac.textContent = 'Condiciones estables';
    }
}

// Synthetic weather generator for simulated modes (Future/Flood)
function generateSyntheticPredictiveRisk(Q) {
    let clouds, hum, press, wspd, wdir, lvl, score, factors = [];
    
    // Normal baseline
    clouds = 40 + Math.random() * 30; // 40-70%
    hum = 60 + Math.random() * 20;    // 60-80%
    press = 1010 + Math.random() * 4; // 1010-1014
    wspd = 5 + Math.random() * 10;    // 5-15
    wdir = 90 + Math.random() * 180;  // 90-270 (not onshore)
    score = 20;
    lvl = "Bajo";
    let precip_mm = 0;

    // As Q increases (simulating that rain ALREADY happened or is happening)
    if (Q > 15) {
        clouds = 80 + Math.random() * 20;
        hum = 85 + Math.random() * 15;
        press = 1005 + Math.random() * 3; // Dropping
        wspd = 12 + Math.random() * 15;
        wdir = 300 + Math.random() * 60;  // Onshore NW to N
        
        if (Q > 30) precip_mm = 20 + Math.random() * 30; // Extreme rain
        else if (Q > 20) precip_mm = 10 + Math.random() * 15; // Heavy rain
        else precip_mm = 2 + Math.random() * 8; // Moderate rain
        
        if (Q > 25) {
            score = 85 + Math.random() * 10;
            lvl = "Crítico";
            factors = ["Alta humedad (>90%)", "Cielo muy cubierto (>85%)", `Viento húmedo del mar (${Math.round(wspd)} km/h)`, "Fuerte caída de presión"];
        } else {
            score = 65 + Math.random() * 10;
            lvl = "Alto";
            factors = ["Humedad elevada (>80%)", "Caída de presión", "Viento húmedo del mar"];
        }
    } else if (Q > 8) {
        clouds = 60 + Math.random() * 25;
        hum = 75 + Math.random() * 10;
        press = 1008 + Math.random() * 3;
        score = 40 + Math.random() * 15;
        lvl = "Moderado";
        precip_mm = Math.random() * 2; // Light rain
        factors = ["Cielo nublado", "Presión inestable"];
    }

    return {
        score: Math.round(score),
        level: lvl,
        factors: factors,
        precipitation_mm: Math.round(precip_mm * 10) / 10,
        current_conditions: {
            cloud_cover: Math.round(clouds),
            humidity: Math.round(hum),
            pressure: Math.round(press * 10) / 10,
            wind_speed: Math.round(wspd),
            wind_direction: Math.round(wdir)
        }
    };
}

let modeInterval = null;
function stopMode() { if (modeInterval) { clearInterval(modeInterval); modeInterval = null; } }

function startLiveMode() {
    stopMode(); clearChart(); createCrossingMarker();

    updateAlert('safe', '⏳ Conectando con Open-Meteo...');

    fetch(`${API_BASE}/api/precipitation/timeseries`)
        .then(r => r.json())
        .then(data => {
            if (!data.hours || data.hours.length === 0) {
                updateAlert('warning', '⚠ Sin datos de precipitación — usando respaldo');
                throw new Error("Empty hours array from backend API");
            }

            // Find the current hour index
            const now = new Date();
            const nowStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:00`;
            let currentIdx = data.hours.findIndex(h => h.time >= nowStr);
            if (currentIdx < 0) currentIdx = data.hours.length - 1;

            // Show past hours (up to 48h before now)
            const startIdx = Math.max(0, currentIdx - 48);
            for (let i = startIdx; i <= currentIdx; i++) {
                const h = data.hours[i];
                const t = h.time.slice(11, 16); // HH:MM
                const date = h.time.slice(5, 10); // MM-DD
                const label = i < currentIdx - 24 ? `${date} ${t}` : t;
                const Q = h.discharge_estimated;
                const dateObj = new Date(h.time);
                processReading(Q, label, null, dateObj);
            }

            // Update flow info with precipitation details
            const currentHour = data.hours[currentIdx];
            checkPrecipJump(currentHour.precipitation_mm || 0);
            
            const tempInfo = document.getElementById('info-temp');
            if (tempInfo) tempInfo.textContent = currentHour.temperature_c || '--';

            updateAlert('safe', `● EN VIVO — Datos satelitales Open-Meteo (${data.source})`);

            if (data.current_predictive_risk) {
                updateMeteoUI(data.current_predictive_risk);
            }

            // Show future forecast hours (lighter, after current)
            let futIdx = currentIdx + 1;
            modeInterval = setInterval(() => {
                if (futIdx < data.hours.length) {
                    // Forecast data
                    const h = data.hours[futIdx];
                    const dateObj = new Date(h.time);
                    processReading(h.discharge_estimated, h.time.slice(11, 16) + ' ⟶', null, dateObj);
                    futIdx++;
                } else {
                    // After running through forecast, poll for updated real-time
                    fetch(`${API_BASE}/api/precipitation/realtime`)
                        .then(r => r.json())
                        .then(rt => {
                            const t = new Date();
                            const lbl = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
                            processReading(rt.discharge, lbl, null, t);
                            if (document.getElementById('info-precip'))
                                checkPrecipJump(rt.precipitation_mm || 0);
                            if (rt.temperature_c !== undefined && document.getElementById('info-temp'))
                                document.getElementById('info-temp').textContent = rt.temperature_c;
                            if (rt.predictive_risk)
                                updateMeteoUI(rt.predictive_risk);
                        })
                        .catch(() => {});
                }
            }, 5000); // Every 5 seconds for forecast, then poll
        })
        .catch(err => {
            console.error("Precipitation API error:", err);
            updateAlert('warning', '⚠ Error conectando Open-Meteo — usando datos simulados');
            // Fallback to simulated
            const now = new Date();
            for (let m = 120; m >= 1; m--) {
                const past = new Date(now.getTime() - m * 60000);
                processReading(riverDischarge(past), `${String(past.getHours()).padStart(2,'0')}:${String(past.getMinutes()).padStart(2,'0')}`, null, past);
            }
            processReading(riverDischarge(now), `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`, null, now);
        });
}

function startFutureMode() {
    stopMode(); clearChart(); createCrossingMarker();
    const today = new Date();
    let day = 0;
    modeInterval = setInterval(() => {
        if (day > 30) { stopMode(); updateAlert('safe', 'Simulación completa — 30 días'); return; }
        const d = new Date(today.getTime() + day * 86400000); d.setHours(12, 0, 0);
        const Q = riverDischarge(d);
        
        // Update Meteo UI synthetically
        const synth = generateSyntheticPredictiveRisk(Q);
        updateMeteoUI(synth);
        
        // Pass the generated precip_mm to processReading so it updates the UI accurately
        processReading(Q, `Día ${day + 1} (${d.getDate()}/${d.getMonth() + 1})`, synth.precipitation_mm, d);
        
        day++;
    }, 1000);
}

function startFloodMode() {
    stopMode(); clearChart(); createCrossingMarker();
    let hour = 0;
    let overflowAnnounced = false;

    modeInterval = setInterval(() => {
        if (hour > 24) {
            stopMode();
            updateAlert('warning', '● Simulación de crecida completada');
            return;
        }

        // Hydrograph
        let f;
        if (hour <= 3) f = Math.pow(hour / 3, 1.3) * 0.15;
        else if (hour <= 6) f = 0.15 + Math.pow((hour - 3) / 3, 1.5) * 0.35;
        else if (hour <= 9) f = 0.50 + Math.pow((hour - 6) / 3, 1.2) * 0.40;
        else if (hour <= 13) f = Math.min(1.0, 0.90 + 0.10 * Math.sin((hour - 9) * 0.6));
        else if (hour <= 18) f = 1.0 - Math.pow((hour - 13) / 5, 0.7) * 0.55;
        else f = 0.45 - ((hour - 18) / 6) * 0.25;
        f = Math.max(0.05, Math.min(1.0, f));

        const Q = 2.5 + f * 32.5; // Normal→35 m³/s
        const pct = (Q / Q_TOTAL) * 100;

        // Update Meteo UI synthetically
        const synth = generateSyntheticPredictiveRisk(Q);
        updateMeteoUI(synth);
        
        // Update reading with forced synthetic precip
        const d = new Date(); d.setHours(hour, 0, 0);
        processReading(Q, `${hour}:00`, synth.precipitation_mm, d);

        if (pct >= 100 && !overflowAnnounced) {
            overflowAnnounced = true;
            updateAlert('overflow', `🌊 DESBORDAMIENTO — Hora ${hour}:00`);
        }

        hour++;
    }, 1500);
}


// ============================================================
// MAP
// ============================================================
const map = new maplibregl.Map({
    container: 'map',
    style: {
        'version': 8,
        'glyphs': 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        'sources': { 'raster-tiles': { 'type': 'raster', 'tiles': ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'], 'tileSize': 256 } },
        'layers': [{ 'id': 'base-tiles', 'type': 'raster', 'source': 'raster-tiles', 'minzoom': 0, 'maxzoom': 22 }]
    },
    center: [-73.861232, 11.268873], zoom: 16, pitch: 45, bearing: -30
});
map.addControl(new maplibregl.NavigationControl());

map.on('load', async () => {
    // Buildings
    try {
        const res = await fetch(`${API_BASE}/api/buildings`);
        const data = await res.json();
        map.addSource('sm-buildings', { type: 'geojson', data });
        map.addLayer({ 'id': 'sm-buildings-layer', 'type': 'fill-extrusion', 'source': 'sm-buildings', 'paint': { 'fill-extrusion-color': ['step', ['get', 'height'], '#800080', 5, '#2980b9', 10, '#27ae60', 20, '#f1c40f'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.8 } });
        document.getElementById('building-count').textContent = data.features.length;
    } catch (err) { console.error("Buildings:", err); }

    // Network
    try {
        const res = await fetch(`${API_BASE}/api/network`);
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            map.addSource('sm-network', { type: 'geojson', data });
            map.addLayer({ 'id': 'sm-junctions', 'type': 'fill', 'source': 'sm-network', 'filter': ['==', 'type', 'junction'], 'paint': { 'fill-color': '#2a2a2a', 'fill-opacity': 1.0 } });
            map.addLayer({ 'id': 'sm-lanes-base', 'type': 'line', 'source': 'sm-network', 'filter': ['==', 'type', 'lane'], 'layout': { 'line-cap': 'butt', 'line-join': 'round' }, 'paint': { 'line-color': '#3a3a3a', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['*', ['get', 'width'], 0.5], 15, ['*', ['get', 'width'], 2], 20, ['*', ['get', 'width'], 8]] } });
            map.addLayer({ 'id': 'sm-lanes-markings', 'type': 'line', 'source': 'sm-network', 'filter': ['==', 'type', 'lane'], 'paint': { 'line-color': '#fff', 'line-width': 1, 'line-dasharray': [2, 4], 'line-opacity': 0.3 } });
            document.getElementById('network-count').textContent = data.features.length;
        }
    } catch (err) { console.error("Network:", err); }

    // River
    try {
        const res = await fetch(`${API_BASE}/api/river`);
        const rd = await res.json();
        if (rd.features && rd.features.length > 0) {
            const areas = { type: 'FeatureCollection', features: rd.features.filter(f => f.properties.type === 'river_area') };
            const lines = { type: 'FeatureCollection', features: rd.features.filter(f => f.properties.type === 'river_centerline') };
            const pts = { type: 'FeatureCollection', features: rd.features.filter(f => f.properties.type === 'depth_point') };
            if (areas.features.length) { map.addSource('river-areas', { type: 'geojson', data: areas }); map.addLayer({ 'id': 'river-areas-layer', 'type': 'fill', 'source': 'river-areas', 'paint': { 'fill-color': '#0a2a4a', 'fill-opacity': 0.6 } }); }
            if (pts.features.length) {
                map.addSource('river-depth', { type: 'geojson', data: pts });
                map.addLayer({ 'id': 'river-depth-heatmap', 'type': 'heatmap', 'source': 'river-depth', 'paint': { 'heatmap-weight': ['interpolate', ['linear'], ['get', 'depth'], 0.01, 0.15, 0.55, 0.35, 1.09, 0.6, 1.63, 0.85, 2.17, 1.0], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 13, 1.2, 15, 1.8, 18, 2.5], 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.05, 'rgba(0,20,80,0.3)', 0.15, 'rgba(0,60,200,0.5)', 0.3, 'rgba(0,128,255,0.65)', 0.45, 'rgba(0,200,150,0.7)', 0.6, 'rgba(100,230,50,0.75)', 0.75, 'rgba(255,255,0,0.8)', 0.88, 'rgba(255,160,0,0.88)', 1.0, 'rgba(255,30,0,1.0)'], 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 13, 6, 15, 12, 18, 20], 'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 15, 0.85, 18, 0.95] } });
                document.getElementById('river-count').textContent = pts.features.length;
            }
            if (lines.features.length) { map.addSource('river-centerline', { type: 'geojson', data: lines }); map.addLayer({ 'id': 'river-centerline-layer', 'type': 'line', 'source': 'river-centerline', 'paint': { 'line-color': '#4488ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 2, 18, 3], 'line-opacity': 0.5 } }); }
            if (pts.features.length) {
                const fp = { type: 'FeatureCollection', features: pts.features.filter((_, i) => i % 4 === 0).map(f => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [...f.geometry.coordinates] }, properties: { ...f.properties, phase: Math.random(), oLon: f.geometry.coordinates[0], oLat: f.geometry.coordinates[1] } })) };
                map.addSource('flow-particles', { type: 'geojson', data: fp });
                map.addLayer({ 'id': 'flow-particles-layer', 'type': 'circle', 'source': 'flow-particles', 'paint': { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 2, 18, 3], 'circle-color': '#88ccff', 'circle-opacity': 0.5 } });
                (function animate() {
                    const t = Date.now() * 0.001;
                    fp.features.forEach(f => {
                        const a = (f.properties.flow_angle || 0) * Math.PI / 180;
                        const d = Math.sin(((t * (f.properties.velocity || 0.5) * 0.3 + f.properties.phase) % 1) * Math.PI * 2) * 0.00005;
                        f.geometry.coordinates[0] = f.properties.oLon + Math.cos(a) * d;
                        f.geometry.coordinates[1] = f.properties.oLat + Math.sin(a) * d;
                    });
                    if (map.getSource('flow-particles')) map.getSource('flow-particles').setData(fp);
                    requestAnimationFrame(animate);
                })();
            }
        }
    } catch (err) { console.error("River:", err); }

    // 3D context
    map.addSource('openmaptiles', { 'type': 'vector', 'tiles': ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'] });
    map.addLayer({ 'id': '3d-buildings-context', 'source': 'openmaptiles', 'source-layer': 'building', 'type': 'fill-extrusion', 'minzoom': 13, 'paint': { 'fill-extrusion-color': '#1a1a2e', 'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, ['get', 'render_height']], 'fill-extrusion-base': ['get', 'render_min_height'], 'fill-extrusion-opacity': 0.4 } });

    // Traffic
    initTraffic();

    // Auto-start LIVE mode
    startLiveMode();
});


// ============================================================
// TRAFFIC SIMULATION
// ============================================================
let trafficRoutes = [];
let vehicles = [];
const VEHICLE_COUNT = 30;
const BRIDGE_CENTER = [-73.861232, 11.268873];
const TRAFFIC_RADIUS = 0.008;

function initTraffic() {
    const src = map.getSource('sm-network');
    if (!src || !src._data || !src._data.features) return;
    const lanes = src._data.features.filter(f => f.properties && f.properties.type === 'lane' && f.geometry && f.geometry.type === 'LineString' && f.geometry.coordinates.length >= 2);
    const nearLanes = lanes.filter(f => {
        const mid = f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)];
        return Math.sqrt(Math.pow(mid[0] - BRIDGE_CENTER[0], 2) + Math.pow(mid[1] - BRIDGE_CENTER[1], 2)) < TRAFFIC_RADIUS;
    });
    if (!nearLanes.length) return;
    trafficRoutes = nearLanes.map(l => {
        const c = l.geometry.coordinates; let total = 0; const segs = [];
        for (let i = 0; i < c.length - 1; i++) { const len = Math.sqrt(Math.pow(c[i+1][0]-c[i][0], 2) + Math.pow(c[i+1][1]-c[i][1], 2)); segs.push({ s: c[i], e: c[i+1], len }); total += len; }
        return { coords: c, segs, total };
    });
    vehicles = Array.from({ length: VEHICLE_COUNT }, () => ({
        r: Math.floor(Math.random() * trafficRoutes.length),
        p: Math.random(), spd: 0.0003 + Math.random() * 0.0004, dir: Math.random() > 0.5 ? 1 : -1
    }));
    map.addSource('traffic', { type: 'geojson', data: buildVGeo() });
    map.addLayer({ 'id': 'traffic-layer', 'type': 'circle', 'source': 'traffic', 'paint': { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2, 15, 4, 18, 7], 'circle-color': '#ff2222', 'circle-opacity': 0.9, 'circle-stroke-width': 1, 'circle-stroke-color': '#ff8888', 'circle-stroke-opacity': 0.5 } });
    animTraffic();
}

function posOnRoute(route, progress) {
    const td = progress * route.total; let acc = 0;
    for (const s of route.segs) { if (acc + s.len >= td) { const t = (td - acc) / s.len; return [s.s[0] + t * (s.e[0] - s.s[0]), s.s[1] + t * (s.e[1] - s.s[1])]; } acc += s.len; }
    return route.coords[route.coords.length - 1];
}

function buildVGeo() {
    return { type: 'FeatureCollection', features: vehicles.map((v, i) => {
        const pos = posOnRoute(trafficRoutes[v.r], v.dir > 0 ? v.p : 1 - v.p);
        return { type: 'Feature', geometry: { type: 'Point', coordinates: pos }, properties: { id: i } };
    })};
}

function animTraffic() {
    for (const v of vehicles) {
        v.p += v.spd;
        if (v.p > 1) { v.p = 0; v.r = Math.floor(Math.random() * trafficRoutes.length); v.spd = 0.0003 + Math.random() * 0.0004; v.dir = Math.random() > 0.5 ? 1 : -1; }
    }
    const s = map.getSource('traffic'); if (s) s.setData(buildVGeo());
    requestAnimationFrame(animTraffic);
}
