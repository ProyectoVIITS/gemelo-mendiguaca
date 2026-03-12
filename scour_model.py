"""
Provisional Culvert Crossing Model — Puente Mendiguaca
Manning Equation for pipe battery capacity.

Structure: Earth embankment (pedraplén) across 51m river.
- 11 corrugated metal pipes, 45" (1.143m) diameter, covering 21m
- 30m sandbag dike wall
- 60cm fill material thickness above pipes
- Coordinates: 11.268873°N, 73.861232°W

Q = (1/n) × A × R^(2/3) × S^(1/2)
"""
import math

# ============================================================
# STRUCTURE PARAMETERS
# ============================================================
NUM_TUBES = 11
TUBE_DIAMETER_IN = 45          # inches
TUBE_DIAMETER_M = TUBE_DIAMETER_IN * 0.0254  # 1.143 m
MANNING_N = 0.024              # corrugated metal
SLOPE = 0.015                  # 1.5% (mountain river)
FILL_THICKNESS_M = 0.60       # fill above pipes
EMBANKMENT_HEIGHT_M = TUBE_DIAMETER_M + FILL_THICKNESS_M  # ~1.74m

RIVER_WIDTH_M = 51.0
TUBES_SPAN_M = 21.0
DIKE_SPAN_M = 30.0

# Location
CROSSING_LAT = 11.268873
CROSSING_LON = -73.861232

# ============================================================
# MANNING EQUATION — Full pipe capacity
# ============================================================
def pipe_full_capacity():
    """Calculate discharge Q for one pipe flowing full."""
    D = TUBE_DIAMETER_M
    A = math.pi * D**2 / 4          # cross-section area
    P = math.pi * D                  # wetted perimeter
    R = A / P                        # hydraulic radius = D/4
    Q = (1.0 / MANNING_N) * A * R**(2.0/3.0) * SLOPE**(1.0/2.0)
    V = Q / A                        # velocity
    return {
        "Q_per_tube": round(Q, 3),
        "V_per_tube": round(V, 2),
        "A_per_tube": round(A, 4),
        "R": round(R, 4),
        "D": round(D, 3),
    }


def total_capacity():
    """Total discharge capacity of all tubes."""
    pipe = pipe_full_capacity()
    Q_total = pipe["Q_per_tube"] * NUM_TUBES
    return {
        **pipe,
        "num_tubes": NUM_TUBES,
        "Q_total": round(Q_total, 2),
    }


# ============================================================
# ALERT LEVELS
# ============================================================
def get_alert(pct_capacity):
    """Alert level based on % capacity used."""
    if pct_capacity < 30:
        return "safe", "Normal"
    elif pct_capacity < 60:
        return "caution", "Precaución"
    elif pct_capacity < 85:
        return "warning", "Alerta"
    elif pct_capacity < 100:
        return "danger", "Peligro"
    elif pct_capacity < 150:
        return "overflow", "DESBORDAMIENTO"
    else:
        return "collapse", "COLAPSO TERRAPLÉN"


# ============================================================
# CURRENT STATE
# ============================================================
def get_current_state(river_discharge=2.5):
    """Calculate current state of the culvert crossing."""
    cap = total_capacity()
    Q_total = cap["Q_total"]
    
    pct = (river_discharge / Q_total) * 100
    alert_code, alert_label = get_alert(pct)
    
    # Water level estimation
    if river_discharge <= Q_total:
        # Below capacity — water level proportional
        water_level = TUBE_DIAMETER_M * (river_discharge / Q_total) ** 0.5
    else:
        # Above capacity — water rises above embankment
        overflow_factor = river_discharge / Q_total
        water_level = EMBANKMENT_HEIGHT_M * overflow_factor ** 0.4
    
    # Overflow volume
    overflow_Q = max(0, river_discharge - Q_total)
    
    return {
        "river_discharge": round(river_discharge, 2),
        "tube_capacity": Q_total,
        "pct_capacity": round(pct, 1),
        "alert": alert_code,
        "alert_label": alert_label,
        "water_level": round(water_level, 2),
        "embankment_height": round(EMBANKMENT_HEIGHT_M, 2),
        "overflow_Q": round(overflow_Q, 2),
        "velocity": cap["V_per_tube"],
        "num_tubes": NUM_TUBES,
        "tube_diameter": round(TUBE_DIAMETER_M, 3),
    }


# ============================================================
# FLOOD SIMULATION (24 hours)
# ============================================================
def simulate_flood():
    """
    Simulate a flood event like Feb 2026.
    Shows hour-by-hour when the crossing would be overwhelmed.
    
    Normal: 2.5 m³/s → Peak: ~35 m³/s → Recovery
    """
    timesteps = []
    cap = total_capacity()
    Q_max = cap["Q_total"]
    overflow_hour = None
    
    for hour in range(0, 25):
        # Hydrograph: gradual rise, sustained peak, slow fall
        if hour <= 3:
            factor = (hour / 3) ** 1.3 * 0.15
        elif hour <= 6:
            factor = 0.15 + ((hour - 3) / 3) ** 1.5 * 0.35
        elif hour <= 9:
            factor = 0.50 + ((hour - 6) / 3) ** 1.2 * 0.40
        elif hour <= 13:
            factor = 0.90 + 0.10 * math.sin((hour - 9) * 0.6)
            factor = min(factor, 1.0)
        elif hour <= 18:
            factor = 1.0 - ((hour - 13) / 5) ** 0.7 * 0.55
        else:
            factor = 0.45 - ((hour - 18) / 6) * 0.25
        
        factor = max(0.05, min(1.0, factor))
        
        # Normal=2.5 → Peak=35 m³/s
        discharge = 2.5 + factor * (35.0 - 2.5)
        
        pct = (discharge / Q_max) * 100
        alert_code, alert_label = get_alert(pct)
        overflow_Q = max(0, discharge - Q_max)
        
        if pct >= 100 and overflow_hour is None:
            overflow_hour = hour
        
        # Water level
        if discharge <= Q_max:
            water_level = TUBE_DIAMETER_M * (discharge / Q_max) ** 0.5
        else:
            water_level = EMBANKMENT_HEIGHT_M * (discharge / Q_max) ** 0.4
        
        timesteps.append({
            "hour": hour,
            "label": f"Hora {hour}:00",
            "discharge": round(discharge, 1),
            "pct_capacity": round(pct, 1),
            "alert": alert_code,
            "alert_label": alert_label,
            "overflow_Q": round(overflow_Q, 1),
            "water_level": round(water_level, 2),
        })
    
    return {
        "type": "flood",
        "tube_capacity": Q_max,
        "num_tubes": NUM_TUBES,
        "timesteps": timesteps,
        "overflow_hour": overflow_hour,
        "embankment_height": round(EMBANKMENT_HEIGHT_M, 2),
    }


if __name__ == "__main__":
    cap = total_capacity()
    print(f"=== Paso Provisional Mendiguaca ===")
    print(f"Tubos: {NUM_TUBES} × {TUBE_DIAMETER_IN}\" ({TUBE_DIAMETER_M:.3f}m)")
    print(f"Q por tubo: {cap['Q_per_tube']} m³/s (V={cap['V_per_tube']} m/s)")
    print(f"Q total: {cap['Q_total']} m³/s")
    print(f"Altura terraplén: {EMBANKMENT_HEIGHT_M:.2f}m")
    print()
    
    for q in [2.5, 5, 10, 15, 18.5, 20, 25, 30, 35]:
        s = get_current_state(q)
        marker = " ← DESBORDAMIENTO!" if s['overflow_Q'] > 0 else ""
        print(f"  Q={q:5.1f} m3/s -> {s['pct_capacity']:5.1f}% [{s['alert_label']:20s}] overflow={s['overflow_Q']:.1f}{marker}")
    
    print()
    flood = simulate_flood()
    print(f"Simulación crecida: desbordamiento en hora {flood['overflow_hour']}")
