import { useEffect, useRef } from "react";
import type { Game } from "@db/schema";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import type { Feature, Polygon } from "geojson";
import "leaflet-draw";
import "leaflet-geometryutil";

// Zone colors with semantic meanings
const ZONE_COLORS = [
  { color: '#2563eb', name: 'Initial Zone', description: 'Starting play area' },
  { color: '#16a34a', name: 'First Shrink', description: 'First zone reduction' },
  { color: '#ca8a04', name: 'Second Shrink', description: 'Second zone reduction' },
  { color: '#dc2626', name: 'Final Zone', description: 'Final combat area' },
];

// Custom control for zone legend
class ZoneLegend extends L.Control {
  onAdd(map: L.Map) {
    const div = L.DomUtil.create('div', 'zone-legend');
    div.style.cssText = `
      background: white;
      padding: 10px;
      border-radius: 4px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      font-family: system-ui, sans-serif;
      font-size: 12px;
      max-width: 200px;
      color: #1f2937;
    `;

    const title = document.createElement('h4');
    title.textContent = 'Zone Legend';
    title.style.cssText = `
      margin-bottom: 8px;
      font-weight: bold;
      color: #111827;
    `;
    div.appendChild(title);

    ZONE_COLORS.forEach(({ color, name, description }) => {
      const item = document.createElement('div');
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.marginBottom = '4px';

      const colorBox = document.createElement('span');
      colorBox.style.cssText = `
        width: 12px;
        height: 12px;
        background: ${color};
        display: inline-block;
        margin-right: 8px;
        border-radius: 2px;
        border: 1px solid rgba(0,0,0,0.1);
      `;

      const text = document.createElement('span');
      text.textContent = name;
      text.title = description;
      text.style.cssText = `
        cursor: help;
        color: #374151;
      `;

      item.appendChild(colorBox);
      item.appendChild(text);
      div.appendChild(item);
    });

    return div;
  }
}

// Create zone label
function createZoneLabel(name: string, center: L.LatLng) {
  return L.divIcon({
    className: 'zone-label',
    html: `<div style="
      background: rgba(255,255,255,0.95);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      color: #111827;
      border: 1px solid rgba(0,0,0,0.1);
    ">${name}</div>`,
  });
}

function calculateZoneBoundary(
  center: L.LatLng,
  radiusMeters: number,
  points: number = 32
): L.LatLng[] {
  const vertices: L.LatLng[] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = Math.cos(angle) * radiusMeters;
    const dy = Math.sin(angle) * radiusMeters;

    const latChange = dy / 111111;
    const lngChange = dx / (111111 * Math.cos(center.lat * Math.PI / 180));

    vertices.push(L.latLng(center.lat + latChange, center.lng + lngChange));
  }
  vertices.push(vertices[0]); // Close the polygon
  return vertices;
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
  const drawLayerRef = useRef<L.FeatureGroup | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);
  const defaultCircleRef = useRef<L.Circle | null>(null);
  const legendRef = useRef<ZoneLegend | null>(null);

  // Function to draw game zones
  const drawGameZones = (map: L.Map, boundaries: any, zoneConfigs: any[]) => {
    if (zonesLayerRef.current) {
      zonesLayerRef.current.clearLayers();
    } else {
      zonesLayerRef.current = L.layerGroup().addTo(map);
    }

    // Draw the main boundary
    const boundaryLayer = L.geoJSON(boundaries, {
      style: {
        color: ZONE_COLORS[0].color,
        fillColor: ZONE_COLORS[0].color,
        fillOpacity: 0.15,
        weight: 3,
      },
    }).addTo(zonesLayerRef.current);

    // Add label for main boundary
    const bounds = boundaryLayer.getBounds();
    const center = bounds.getCenter();
    L.marker(center, {
      icon: createZoneLabel(ZONE_COLORS[0].name, center),
    }).addTo(zonesLayerRef.current);

    // Calculate initial radius using bounds
    const initialRadius = bounds.getNorthEast().distanceTo(center);

    // Draw each zone
    let currentRadius = initialRadius;
    if (Array.isArray(zoneConfigs)) {
      zoneConfigs.forEach((zone, index) => {
        if (!zone || !zone.radiusMultiplier) return;

        const nextRadius = currentRadius * zone.radiusMultiplier;
        const zoneColor = ZONE_COLORS[index + 1] || ZONE_COLORS[ZONE_COLORS.length - 1];

        // Create zone polygon using direct calculation
        const vertices = calculateZoneBoundary(center, nextRadius);
        L.polygon(vertices, {
          color: zoneColor.color,
          fillColor: zoneColor.color,
          fillOpacity: 0.15,
          weight: 3,
          dashArray: '5, 10',
        }).addTo(zonesLayerRef.current!);

        // Add zone label
        const labelPos = L.latLng(
          center.lat + (nextRadius / 111111) * 0.7,
          center.lng
        );
        L.marker(labelPos, {
          icon: createZoneLabel(zoneColor.name, labelPos),
        }).addTo(zonesLayerRef.current!);

        currentRadius = nextRadius;
      });
    }

    // Fit map bounds to include all zones
    map.fitBounds(boundaryLayer.getBounds());
  };

  useEffect(() => {
    if (!mapRef.current) {
      // Initialize map
      const map = L.map("map").setView([defaultCenter.lat, defaultCenter.lng], 13);
      mapRef.current = map;

      // Add OpenStreetMap tiles
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Add legend
      legendRef.current = new ZoneLegend({ position: 'topright' });
      legendRef.current.addTo(map);

      // Initialize layers
      const drawnItems = new L.FeatureGroup();
      map.addLayer(drawnItems);
      drawLayerRef.current = drawnItems;

      // Add default circle if no game boundaries
      if (!game?.boundaries) {
        const circle = L.circle([defaultCenter.lat, defaultCenter.lng], {
          radius: defaultRadiusMiles * 1609.34,
          color: ZONE_COLORS[0].color,
          fillColor: ZONE_COLORS[0].color,
          fillOpacity: 0.15,
          weight: 3,
          dashArray: '5, 10',
        });
        circle.addTo(map);
        defaultCircleRef.current = circle;
      }

      if (mode === "draw") {
        // Add draw controls
        const drawControl = new L.Control.Draw({
          draw: {
            polygon: {
              shapeOptions: {
                color: ZONE_COLORS[0].color,
                fillOpacity: 0.15,
                weight: 3
              }
            },
            rectangle: {
              shapeOptions: {
                color: ZONE_COLORS[0].color,
                fillOpacity: 0.15,
                weight: 3
              }
            },
            circle: false,
            circlemarker: false,
            marker: false,
            polyline: false,
          },
          edit: {
            featureGroup: drawnItems,
          },
        });

        map.addControl(drawControl);

        // Handle draw events
        map.on(L.Draw.Event.CREATED, (e: any) => {
          drawnItems.clearLayers();
          const layer = e.layer as L.Polygon;
          drawnItems.addLayer(layer);

          if (onAreaSelect) {
            const geoJSON = layer.toGeoJSON() as Feature<Polygon>;
            onAreaSelect(geoJSON);
          }
        });
      }
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        drawLayerRef.current = null;
        zonesLayerRef.current = null;
        defaultCircleRef.current = null;
        legendRef.current = null;
      }
    };
  }, [mode, onAreaSelect, defaultCenter, defaultRadiusMiles]);

  // Update map when game boundaries and zones change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !game?.boundaries) return;

    console.log('Drawing game zones with config:', game.zoneConfigs);

    // Remove default circle if it exists
    if (defaultCircleRef.current) {
      defaultCircleRef.current.removeFrom(map);
      defaultCircleRef.current = null;
    }

    // Draw game boundaries and zones
    if (game.zoneConfigs && game.zoneConfigs.length > 0) {
      drawGameZones(map, game.boundaries, game.zoneConfigs);
    } else {
      // Just draw the boundary if no zones
      const boundariesLayer = L.geoJSON(game.boundaries as any, {
        style: {
          color: ZONE_COLORS[0].color,
          fillColor: ZONE_COLORS[0].color,
          fillOpacity: 0.15,
          weight: 3,
        },
      }).addTo(map);
      map.fitBounds(boundariesLayer.getBounds());
    }
  }, [game]);

  // Update drawn area when selectedArea changes
  useEffect(() => {
    const map = mapRef.current;
    const drawLayer = drawLayerRef.current;

    if (map && drawLayer && selectedArea) {
      drawLayer.clearLayers();
      L.geoJSON(selectedArea, {
        style: {
          color: ZONE_COLORS[0].color,
          fillColor: ZONE_COLORS[0].color,
          fillOpacity: 0.15,
          weight: 3,
        },
      }).getLayers().forEach(layer => {
        drawLayer.addLayer(layer);
      });
    }
  }, [selectedArea]);

  return (
    <div
      id="map"
      className="w-full h-full"
      style={{ minHeight: "300px" }}
    />
  );
}