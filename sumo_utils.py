import sumolib
import os

class SumoNetwork:
    def __init__(self, net_file):
        print(f"Loading network from {net_file}...")
        self.net = sumolib.net.readNet(net_file)
        print("Network loaded.")

    def xy_to_lonlat(self, x, y):
        return self.net.convertXY2LonLat(x, y)

    def get_bounds(self):
        # Get bounding box of the network
        bbox = self.net.getBBoxXY()
        min_x, min_y = bbox[0]
        max_x, max_y = bbox[1]
        
        lon_min, lat_min = self.xy_to_lonlat(min_x, min_y)
        lon_max, lat_max = self.xy_to_lonlat(max_x, max_y)
        
        center_x = (min_x + max_x) / 2
        center_y = (min_y + max_y) / 2
        center_lon, center_lat = self.xy_to_lonlat(center_x, center_y)
        
        return {
            "center": [center_lon, center_lat],
            "bounds": [[lon_min, lat_min], [lon_max, lat_max]]
        }

    def get_edge_center(self, edge_id):
        if not self.net.hasEdge(edge_id):
            return None
        edge = self.net.getEdge(edge_id)
        shape = edge.getShape()
        # Simple center of the shape (average of all points)
        avg_x = sum(p[0] for p in shape) / len(shape)
        avg_y = sum(p[1] for p in shape) / len(shape)
        return self.xy_to_lonlat(avg_x, avg_y)

    def get_network_geojson(self):
        """Exports lanes and junctions as GeoJSON Features"""
        features = []
        
        # 1. Export Lanes (for visualization)
        for edge in self.net.getEdges():
            for lane in edge.getLanes():
                shape = lane.getShape()
                width = lane.getWidth()
                
                # Convert XY to LonLat
                coords = []
                for p in shape:
                    lon, lat = self.xy_to_lonlat(p[0], p[1])
                    coords.append([lon, lat])
                
                feature = {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": coords
                    },
                    "properties": {
                        "id": lane.getID(),
                        "type": "lane",
                        "width": width,
                    }
                }
                features.append(feature)

        # 2. Export Junctions
        for node in self.net.getNodes():
            shape = node.getShape()
            coords = []
            for p in shape:
                lon, lat = self.xy_to_lonlat(p[0], p[1])
                coords.append([lon, lat])
            
            # Close polygon if not closed
            if coords and coords[0] != coords[-1]:
                coords.append(coords[0])
                
            if len(coords) >= 3:
                feature = {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [coords]
                    },
                    "properties": {
                        "id": node.getID(),
                        "type": "junction"
                    }
                }
                features.append(feature)
                
        return {"type": "FeatureCollection", "features": features}

    def get_traffic_lights(self):
        """
        Returns a list of traffic light features (stop lines) with their current state.
        This allows the frontend to draw red/green lines at intersections.
        """
        tls_features = []
        for tls_id in traci.trafficlight.getIDList():
            try:
                # 'GrGr' string
                state_string = traci.trafficlight.getRedYellowGreenState(tls_id)
                controlled_lanes = traci.trafficlight.getControlledLanes(tls_id)
                
                # Logic: Map each character of state_string to a lane
                # Warning: complex junctions might have multiple links per lane or valid states
                # State string length usually matches controlled links, not necessarily lanes 1:1 if links share lanes
                # But typically len(controlled_lanes) matches logic of links.
                # Simplification: Iterate controlled links
                
                links = traci.trafficlight.getControlledLinks(tls_id)
                # links is list of list: [[(lane, via, prio), (lane, via, prio)], ...]
                
                if not links:
                    continue

                for i, link_group in enumerate(links):
                    if i >= len(state_string): break
                    
                    state_char = state_string[i]
                    color = "#ccc"
                    if state_char in ['r', 'R']: color = "#e74c3c" # Red
                    elif state_char in ['g', 'G']: color = "#2ecc71" # Green
                    elif state_char in ['y', 'Y']: color = "#f1c40f" # Yellow
                    else: continue # 'O' off?

                    # Draw stop line for distinct lanes in this link group
                    # Usually just one lane effectively
                    processed_lanes = set()
                    for link in link_group:
                        lane_id = link[0].getID() # Incoming lane
                        if lane_id in processed_lanes: continue
                        processed_lanes.add(lane_id)
                        
                        lane = self.net.getLane(lane_id)
                        shape = lane.getShape()
                        
                        # Get last segment (stop line area)
                        if len(shape) >= 2:
                            p1 = shape[-1]
                            p2 = shape[-2]
                            
                            # Just draw the very end of the lane? 
                            # Or perpendicular line? 
                            # Simple: Draw last 3 meters of the lane trace 
                            # Calculate point 3 meters back
                            # For now: Draw segment between last 2 points if short, or interpolate.
                            
                            l1, la1 = self.xy_to_lonlat(p1[0], p1[1])
                            l2, la2 = self.xy_to_lonlat(p2[0], p2[1])
                            
                            tls_features.append({
                                "type": "Feature",
                                "geometry": {
                                    "type": "LineString",
                                    "coordinates": [[l2, la2], [l1, la1]]
                                },
                                "properties": {
                                    "color": color,
                                    "tls_id": tls_id,
                                    "lane_id": lane_id
                                }
                            })
                            
            except Exception as e:
                # TLS might not be active or other error
                continue
                
                continue
                
        return tls_features

    def get_traffic_lights_static(self):
        """
        Returns a GeoJSON of traffic light nodes (junctions of type traffic_light).
        """
        features = []
        for node in self.net.getNodes():
            if node.getType() == "traffic_light":
                x, y = node.getCoord()
                lon, lat = self.xy_to_lonlat(x, y)
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon, lat]
                    },
                    "properties": {
                        "id": node.getID(),
                        "type": "traffic_light"
                    }
                })
        return {"type": "FeatureCollection", "features": features}
