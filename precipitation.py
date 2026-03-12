"""
Real-Time Precipitation & Discharge Estimation
Uses Open-Meteo API for real precipitation + Rational Method for discharge
Río Mendiguaca, Santa Marta, Colombia

Rational Method: Q = C × i × A
- C = runoff coefficient (0.45 for semi-urban mountainous terrain)
- i = rainfall intensity (mm/h → m/s)
- A = basin area (60 km²)

Also includes base flow (groundwater contribution) even without rain.
"""
import requests
from datetime import datetime, timedelta

# Basin parameters
BASIN_AREA_KM2 = 60.0
BASIN_AREA_M2 = BASIN_AREA_KM2 * 1e6   # 60,000,000 m²
RUNOFF_COEFF = 0.45                      # Semi-urban mountainous, Sierra Nevada
BASE_FLOW = 1.8                          # m³/s — minimum groundwater flow
CONCENTRATION_TIME_H = 1.5              # Time for runoff to reach crossing (~1.5h)

# Open-Meteo endpoint
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
LAT = 11.27
LON = -73.86

# Cache to avoid excessive API calls
_cache = {"data": None, "fetched_at": None}
CACHE_TTL_SECONDS = 300  # 5 minutes


def fetch_precipitation():
    """
    Fetch hourly precipitation from Open-Meteo API.
    Returns list of {time, precipitation_mm, rain_mm} for last 48h + 24h forecast.
    """
    now = datetime.now()
    
    # Cache check
    if _cache["data"] and _cache["fetched_at"]:
        elapsed = (now - _cache["fetched_at"]).total_seconds()
        if elapsed < CACHE_TTL_SECONDS:
            return _cache["data"]
    
    try:
        params = {
            "latitude": LAT,
            "longitude": LON,
            "hourly": "precipitation,rain,temperature_2m,cloud_cover,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m",
            "past_days": 2,
            "forecast_days": 1,
            "timezone": "America/Bogota",
        }
        r = requests.get(OPEN_METEO_URL, params=params, timeout=10)
        r.raise_for_status()
        data = r.json()
        
        hourly = data.get("hourly", {})
        times = hourly.get("time", [])
        precip = hourly.get("precipitation", [])
        rain = hourly.get("rain", [])
        temp = hourly.get("temperature_2m", [])
        clouds = hourly.get("cloud_cover", [])
        humidity = hourly.get("relative_humidity_2m", [])
        pressure = hourly.get("surface_pressure", [])
        wind_spd = hourly.get("wind_speed_10m", [])
        wind_dir = hourly.get("wind_direction_10m", [])
        
        result = []
        for i in range(len(times)):
            result.append({
                "time": times[i],
                "precipitation_mm": precip[i] if i < len(precip) else 0,
                "rain_mm": rain[i] if i < len(rain) else 0,
                "temperature_c": temp[i] if i < len(temp) else None,
                "cloud_cover_pct": clouds[i] if i < len(clouds) else None,
                "relative_humidity_pct": humidity[i] if i < len(humidity) else None,
                "surface_pressure_hpa": pressure[i] if i < len(pressure) else None,
                "wind_speed_kmh": wind_spd[i] if i < len(wind_spd) else None,
                "wind_direction_deg": wind_dir[i] if i < len(wind_dir) else None,
            })
        
        _cache["data"] = result
        _cache["fetched_at"] = now
        return result
        
    except Exception as e:
        print(f"Open-Meteo API error: {e}")
        return _cache.get("data") or []


def precipitation_to_discharge(precip_mm_h):
    """
    Rational Method: Q = C × i × A
    
    precip_mm_h: rainfall intensity in mm/h
    Returns estimated discharge in m³/s
    """
    if precip_mm_h <= 0:
        return BASE_FLOW
    
    # Convert mm/h to m/s: 1 mm/h = 1e-3 m / 3600 s = 2.778e-7 m/s
    i_m_s = precip_mm_h * 2.778e-7
    
    # Q = C × i × A (m³/s)
    Q_runoff = RUNOFF_COEFF * i_m_s * BASIN_AREA_M2
    
    # Add base flow
    Q_total = BASE_FLOW + Q_runoff
    
    return round(Q_total, 2)


def calculate_predictive_risk(data_list, current_time_str):
    """
    Calculates a predictive risk index (0-100) for heavy rain based on synoptic conditions.
    Uses: pressure drop, high humidity, cloud cover, and onshore wind (from Caribbean text).
    """
    if not data_list:
        return {"score": 0, "level": "Desconocido", "factors": []}
    
    # 1. Find current and past data
    current_idx = next((i for i, x in enumerate(data_list) if x["time"] == current_time_str), -1)
    if current_idx == -1:
        current_idx = len(data_list) - 25 # Fallback to latest past hour
        
    current = data_list[current_idx]
    past_3h_idx = max(0, current_idx - 3)
    past_3h = data_list[past_3h_idx]
    
    score = 0
    factors = []
    
    # A. Pressure dropping
    press_curr = current.get("surface_pressure_hpa")
    press_past = past_3h.get("surface_pressure_hpa")
    if press_curr and press_past:
        drop = press_past - press_curr
        if drop >= 3.0:
            score += 35
            factors.append(f"Fuerte caída de presión ({drop:.1f} hPa)")
        elif drop >= 1.5:
            score += 20
            factors.append(f"Caída de presión ({drop:.1f} hPa)")
            
    # B. Humidity
    rh = current.get("relative_humidity_pct")
    if rh:
        if rh >= 90:
            score += 25
            factors.append("Alta humedad (>90%)")
        elif rh >= 80:
            score += 15
            factors.append("Humedad elevada (>80%)")
            
    # C. Cloud Cover
    clouds = current.get("cloud_cover_pct")
    if clouds:
        if clouds >= 85:
            score += 20
            factors.append("Cielo muy cubierto (>85%)")
        elif clouds >= 60:
            score += 10
            factors.append("Cielo nublado")
            
    # D. Wind (Orographic lift trigger: From sea to mountains: NW to N to NE: 300 to 60 deg)
    wdir = current.get("wind_direction_deg")
    wspd = current.get("wind_speed_kmh")
    if wdir is not None and wspd is not None:
        if (wdir >= 300 or wdir <= 60) and wspd >= 10:
            score += 20
            factors.append(f"Viento húmedo del mar ({wspd} km/h)")
            
    # E. Current rain amplifies risk
    precip = current.get("precipitation_mm") or 0
    if precip > 0:
        score += min(20, int(precip * 5))
        factors.append("Precipitación activa")

    score = min(100, score)
    
    level = "Bajo"
    if score >= 80:
        level = "Crítico"
    elif score >= 60:
        level = "Alto"
    elif score >= 35:
        level = "Moderado"
        
    return {
        "score": score,
        "level": level,
        "factors": factors,
        "current_conditions": {
            "pressure": press_curr,
            "humidity": rh,
            "cloud_cover": clouds,
            "wind_speed": wspd,
            "wind_direction": wdir
        }
    }


def get_realtime_discharge():
    """
    Get real-time discharge estimate based on current precipitation.
    Accounts for concentration time (uses rainfall from ~1.5h ago).
    """
    data = fetch_precipitation()
    if not data:
        return {
            "discharge": BASE_FLOW,
            "precipitation_mm": 0,
            "source": "fallback",
            "message": "No precipitation data available",
        }
    
    now = datetime.now()
    now_str = now.strftime("%Y-%m-%dT%H:00")
    
    # Find current hour and concentration-time-lagged hour
    lag_time = now - timedelta(hours=CONCENTRATION_TIME_H)
    lag_str = lag_time.strftime("%Y-%m-%dT%H:00")
    
    current_precip = 0
    lagged_precip = 0
    
    current_entry = None
    
    for entry in data:
        if entry["time"] == now_str:
            current_precip = entry["precipitation_mm"] or 0
            current_entry = entry
        if entry["time"] == lag_str:
            lagged_precip = entry["precipitation_mm"] or 0
    
    # Use the max of current and lagged (for conservative estimate)
    effective_precip = max(current_precip, lagged_precip)
    
    # Also consider accumulated rain in last 6 hours (saturated soil increases runoff)
    recent_accum = 0
    for entry in data:
        try:
            t = datetime.strptime(entry["time"], "%Y-%m-%dT%H:%M")
            if (now - t).total_seconds() <= 6 * 3600 and (now - t).total_seconds() >= 0:
                recent_accum += (entry["precipitation_mm"] or 0)
        except:
            pass
    
    # Increase runoff coefficient if soil is saturated (>10mm in 6h)
    adjusted_C = RUNOFF_COEFF
    if recent_accum > 10:
        adjusted_C = min(0.70, RUNOFF_COEFF + 0.10)  # Saturated soil
    elif recent_accum > 5:
        adjusted_C = min(0.60, RUNOFF_COEFF + 0.05)
    
    # Calculate discharge
    if effective_precip > 0:
        i_m_s = effective_precip * 2.778e-7
        Q = BASE_FLOW + adjusted_C * i_m_s * BASIN_AREA_M2
    else:
        # Recession from accumulated rain
        if recent_accum > 0:
            Q = BASE_FLOW + recent_accum * 0.05  # Slow recession
        else:
            Q = BASE_FLOW
    
    
    # Calculate predictive risk
    risk = calculate_predictive_risk(data, now_str)
    
    return {
        "discharge": round(Q, 2),
        "precipitation_mm": current_precip,
        "precipitation_lagged_mm": lagged_precip,
        "accumulated_6h_mm": round(recent_accum, 1),
        "temperature_c": current_entry.get("temperature_c") if current_entry else None,
        "cloud_cover_pct": current_entry.get("cloud_cover_pct") if current_entry else None,
        "relative_humidity_pct": current_entry.get("relative_humidity_pct") if current_entry else None,
        "surface_pressure_hpa": current_entry.get("surface_pressure_hpa") if current_entry else None,
        "wind_speed_kmh": current_entry.get("wind_speed_kmh") if current_entry else None,
        "wind_direction_deg": current_entry.get("wind_direction_deg") if current_entry else None,
        "runoff_coefficient": adjusted_C,
        "predictive_risk": risk,
        "source": "Open-Meteo",
        "timestamp": now.isoformat(),
    }


def get_precipitation_timeseries():
    """
    Get full precipitation + discharge time series (48h past + 24h forecast).
    For the frontend chart.
    """
    data = fetch_precipitation()
    if not data:
        return {"hours": [], "source": "unavailable"}
    
    hours = []
    for i, entry in enumerate(data):
        precip = entry["precipitation_mm"] or 0
        
        # Look back for accumulated (simple 3h window)
        accum_3h = precip
        for j in range(max(0, i - 2), i):
            accum_3h += (data[j]["precipitation_mm"] or 0)
        
        Q = precipitation_to_discharge(precip)
        
        # Boost if accumulated recent rain
        if accum_3h > 5:
            boost = 1 + (accum_3h - 5) * 0.03
            Q = round(Q * boost, 2)
        
        hours.append({
            "time": entry["time"],
            "precipitation_mm": precip,
            "temperature_c": entry.get("temperature_c"),
            "cloud_cover_pct": entry.get("cloud_cover_pct"),
            "relative_humidity_pct": entry.get("relative_humidity_pct"),
            "surface_pressure_hpa": entry.get("surface_pressure_hpa"),
            "wind_speed_kmh": entry.get("wind_speed_kmh"),
            "wind_direction_deg": entry.get("wind_direction_deg"),
            "discharge_estimated": Q,
        })
        
    # Also attach the current predictive risk to the timeseries response
    now_str = datetime.now().strftime("%Y-%m-%dT%H:00")
    risk_now = calculate_predictive_risk(data, now_str)
    
    return {
        "hours": hours,
        "current_predictive_risk": risk_now,
        "source": "Open-Meteo (api.open-meteo.com)",
        "basin_area_km2": BASIN_AREA_KM2,
        "base_flow": BASE_FLOW,
        "runoff_coefficient": RUNOFF_COEFF,
        "method": "Rational Method (Q = C × i × A)",
    }


if __name__ == "__main__":
    print("=== Fetching precipitation from Open-Meteo ===")
    ts = get_precipitation_timeseries()
    print(f"Source: {ts['source']}")
    print(f"Hours: {len(ts['hours'])}")
    
    for h in ts["hours"][-12:]:
        print(f"  {h['time']}: P={h['precipitation_mm']:.1f}mm -> Q={h['discharge_estimated']:.2f}m3/s | Nubes: {h['cloud_cover_pct']}% HR: {h['relative_humidity_pct']}% Viento: {h['wind_speed_kmh']}kmh")
    
    print()
    rt = get_realtime_discharge()
    print(f"Real-time: Q={rt['discharge']} m3/s, precip={rt['precipitation_mm']} mm/h")
    risk = rt["predictive_risk"]
    print(f"Riesgo de Crecida: {risk['level']} ({risk['score']}/100) - Factores: {', '.join(risk['factors'])}")
