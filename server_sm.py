import asyncio
import json
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import xml.etree.ElementTree as ET
import uvicorn

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "data"))
RIVER_FILE = os.path.join(DATA_DIR, "mendihuaca_river.geojson")

# Santa Marta building files
BUILDING_FILES = [
    os.path.join(DATA_DIR, "santamarta_gba.poly.xml"),
    os.path.join(DATA_DIR, "santamarta_osm_buildings.poly.xml"),
    os.path.join(DATA_DIR, "santamarta_all_buildings.poly.xml"),
]

# Try to load SUMO network for Santa Marta
SANTAMARTA_NET = os.path.join(DATA_DIR, "santamarta.net.xml.gz")
sumo_net = None


@app.on_event("startup")
async def startup_event():
    global sumo_net
    if os.path.exists(SANTAMARTA_NET):
        try:
            from sumo_utils import SumoNetwork
            sumo_net = SumoNetwork(SANTAMARTA_NET)
            print("Santa Marta SUMO network loaded.")
        except Exception as e:
            print(f"Warning: Could not load SUMO network: {e}")
            print("Network visualization will not be available.")


@app.get("/api/buildings")
def get_buildings():
    """Serves Santa Marta building data from poly.xml files"""
    features = []

    for file_path in BUILDING_FILES:
        if not os.path.exists(file_path):
            print(f"File not found: {file_path}")
            continue

        try:
            tree = ET.parse(file_path)
            root = tree.getroot()

            for poly in root.findall('.//poly'):
                pid = poly.get('id', '')
                shape_str = poly.get('shape', '')
                height = float(poly.get('height', '5.0'))
                geo = poly.get('geo', 'true')

                if not shape_str:
                    continue

                coords = []
                for pair in shape_str.split(' '):
                    parts = pair.split(',')
                    if len(parts) >= 2:
                        try:
                            lon, lat = float(parts[0]), float(parts[1])
                            coords.append([lon, lat])
                        except ValueError:
                            continue

                if len(coords) >= 3:
                    if coords[0] != coords[-1]:
                        coords.append(coords[0])

                    features.append({
                        "type": "Feature",
                        "geometry": {"type": "Polygon", "coordinates": [coords]},
                        "properties": {"id": pid, "height": height}
                    })

        except Exception as e:
            print(f"Error parsing {file_path}: {e}")

    return {"type": "FeatureCollection", "features": features}


@app.get("/api/network")
def get_network():
    """Serves the Santa Marta SUMO network geometry"""
    if not sumo_net:
        return {"type": "FeatureCollection", "features": []}
    return sumo_net.get_network_geojson()


@app.get("/api/river")
async def get_river():
    """Serves the Rio Mendihuaca river flow simulation data"""
    try:
        if os.path.exists(RIVER_FILE):
            with open(RIVER_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data
        else:
            return {"type": "FeatureCollection", "features": [], "error": "River data not found"}
    except Exception as e:
        return {"type": "FeatureCollection", "features": [], "error": str(e)}


@app.get("/api/crossing")
async def get_crossing(discharge: float = 2.5):
    """Current state of the provisional culvert crossing"""
    from scour_model import get_current_state
    return get_current_state(discharge)


@app.get("/api/crossing/flood")
async def flood_crossing():
    """Simulate a flood event on the culvert crossing (24 hours)"""
    from scour_model import simulate_flood
    return simulate_flood()


@app.get("/api/crossing/capacity")
async def crossing_capacity():
    """Get pipe battery capacity specs"""
    from scour_model import total_capacity
    return total_capacity()


@app.get("/api/precipitation/realtime")
async def precipitation_realtime():
    """Real-time discharge estimate from Open-Meteo precipitation"""
    from precipitation import get_realtime_discharge
    return get_realtime_discharge()


@app.get("/api/precipitation/timeseries")
async def precipitation_timeseries():
    """72h precipitation + discharge time series from Open-Meteo"""
    from precipitation import get_precipitation_timeseries
    return get_precipitation_timeseries()

# Serve frontend statically
app.mount("/", StaticFiles(directory="static", html=True), name="static")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8082)
