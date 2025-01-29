import { useEffect, useRef } from "react";
import type { Game } from "@db/schema";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import type { Feature, Polygon } from "geojson";
import "leaflet-draw";
import "leaflet-geometryutil";

// Zone visualization constants
const ZONE_COLORS = [
  { color: '#3b82f6', name: 'Initial Zone' },    // Blue
  { color: '#10b981', name: 'First Shrink' },    // Green
  { color: '#f59e0b', name: 'Second Shrink' },   // Orange
  { color: '#ef4444', name: 'Final Zone' }       // Red
];

const ZONE_STYLE = {
  weight: 2,
  opacity: 0.9,
  dashArray: '5, 10',
  fillOpacity: 0.1
};

const SHRINK_MULTIPLIERS = [1, 0.75, 0.5, 0.25];

function createZones(map: L.Map, center: L.LatLng, initialRadius: number) {
  const zonesLayer = L.layerGroup().addTo(map);

  // Create concentric circles for each zone
  SHRINK_MULTIPLIERS.forEach((multiplier, index) => {
    L.circle(center, {
      radius: initialRadius * multiplier,
      color: ZONE_COLORS[index].color,
      fillColor: ZONE_COLORS[index].color,
      ...ZONE_STYLE
    }).addTo(zonesLayer);
  });

  return zonesLayer;
}

// Zone legend control
class ZoneLegend extends L.Control {
  onAdd(map: L.Map) {
    const div = L.DomUtil.create('div', 'info legend');
    div.style.cssText = `
      background: white;
      padding: 8px;
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      font-size: 12px;
    `;

    div.innerHTML = '<div style="font-weight: 600; margin-bottom: 4px;">Zone Phases</div>';

    ZONE_COLORS.forEach(zone => {
      div.innerHTML += `
        <div style="display: flex; align-items: center; margin: 2px 0;">
          <span style="width: 12px; height: 12px; background: ${zone.color}; 
                       display: inline-block; margin-right: 5px; border-radius: 2px;">
          </span>
          <span>${zone.name}</span>
        </div>
      `;
    });

    return div;
  }
}

interface MapViewProps {
  game?: Game;
  mode?: "view" | "draw";
  onAreaSelect?: (area: Feature<Polygon>) => void;
  selectedArea?: Feature<Polygon> | null;
  defaultCenter?: { lat: number; lng: number };
  defaultRadiusMiles?: number;
}

export function MapView({
  game,
  mode = "view",
  onAreaSelect,
  selectedArea,
  defaultCenter = { lat: 35.8462, lng: -86.3928 },
  defaultRadiusMiles = 1,
}: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);
  const drawLayerRef = useRef<L.FeatureGroup | null>(null);

  useEffect(() => {
    if (!mapRef.current) {
      const map = L.map("map", {
        zoomControl: true,
        doubleClickZoom: false,
      }).setView([defaultCenter.lat, defaultCenter.lng], 13);

      // Add the base tile layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;

      // Add draw controls if in draw mode
      if (mode === "draw") {
        const drawLayer = new L.FeatureGroup().addTo(map);
        drawLayerRef.current = drawLayer;

        const drawControl = new L.Control.Draw({
          draw: {
            polygon: {
              shapeOptions: {
                color: ZONE_COLORS[0].color,
                fillColor: ZONE_COLORS[0].color,
                ...ZONE_STYLE
              }
            },
            rectangle: false,
            circle: false,
            circlemarker: false,
            marker: false,
            polyline: false,
          },
          edit: {
            featureGroup: drawLayer
          }
        });

        map.addControl(drawControl);

        map.on(L.Draw.Event.CREATED, (e: any) => {
          const layer = e.layer;
          drawLayer.clearLayers();
          drawLayer.addLayer(layer);

          if (onAreaSelect) {
            onAreaSelect(layer.toGeoJSON());
          }
        });
      }

      // Add legend
      new ZoneLegend({ position: 'bottomright' }).addTo(map);
    }

    // Cleanup on unmount
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        zonesLayerRef.current = null;
        drawLayerRef.current = null;
      }
    };
  }, []);

  // Handle game boundaries and zones
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing zones
    if (zonesLayerRef.current) {
      zonesLayerRef.current.clearLayers();
      zonesLayerRef.current.remove();
      zonesLayerRef.current = null;
    }

    let center: L.LatLng;
    let radius: number;

    if (game?.boundaries) {
      // Calculate center from game boundaries
      const coords = game.boundaries.geometry.coordinates[0];
      const centerPoint = coords.reduce(
        (acc, [lng, lat]) => ({
          lat: acc.lat + lat / coords.length,
          lng: acc.lng + lng / coords.length
        }),
        { lat: 0, lng: 0 }
      );

      center = L.latLng(centerPoint.lat, centerPoint.lng);

      // Calculate radius as distance to farthest point
      radius = Math.max(...coords.map(([lng, lat]) => {
        return center.distanceTo(L.latLng(lat, lng));
      }));
    } else {
      // Use default center and radius
      center = L.latLng(defaultCenter.lat, defaultCenter.lng);
      radius = defaultRadiusMiles * 1609.34; // Convert miles to meters
    }

    // Create zones
    zonesLayerRef.current = createZones(map, center, radius);

    // Fit map to show all zones
    const bounds = L.latLngBounds([center]);
    bounds.extend(L.latLng(center.lat + radius * 0.000009, center.lng + radius * 0.000009));
    bounds.extend(L.latLng(center.lat - radius * 0.000009, center.lng - radius * 0.000009));
    map.fitBounds(bounds, { padding: [50, 50] });

  }, [game?.boundaries, defaultCenter, defaultRadiusMiles]);

  return (
    <div
      id="map"
      className="w-full h-full"
      style={{ minHeight: "300px" }}
    />
  );
}