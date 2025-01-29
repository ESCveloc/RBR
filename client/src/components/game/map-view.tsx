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
  { color: '#3b82f6', name: 'Initial Zone' },
  { color: '#10b981', name: 'First Shrink' },
  { color: '#f59e0b', name: 'Second Shrink' },
  { color: '#ef4444', name: 'Final Zone' },
];

// Update the boundary styling with transition properties
const ZONE_STYLES = {
  fillOpacity: 0.2,
  weight: 3,
  opacity: 0.9,
  className: 'zone-transition'
};

interface MapViewProps {
  game?: Game;
  mode?: "view" | "draw";
  onAreaSelect?: (area: Feature<Polygon>) => void;
  selectedArea?: Feature<Polygon> | null;
  defaultCenter?: { lat: number; lng: number };
  defaultRadiusMiles?: number;
}

// Update the ZoneLegend class to be more responsive and avoid overlaps
class ZoneLegend extends L.Control {
  onAdd(map: L.Map) {
    const div = L.DomUtil.create('div', 'zone-legend');
    div.style.cssText = `
      background: white;
      padding: 8px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      font-family: system-ui, sans-serif;
      font-size: 12px;
      min-width: 120px;
      max-width: 150px;
      color: #1f2937;
      position: absolute;
      bottom: 20px;
      right: 20px;
      z-index: 400;
      opacity: 0.9;
      transition: opacity 0.2s ease;
    `;

    div.addEventListener('mouseenter', () => {
      div.style.opacity = '1';
    });

    div.addEventListener('mouseleave', () => {
      div.style.opacity = '0.9';
    });

    const title = document.createElement('h4');
    title.textContent = 'Zone Phases';
    title.style.cssText = `
      margin: 0 0 6px 0;
      font-weight: 600;
      color: #111827;
      font-size: 12px;
    `;
    div.appendChild(title);

    ZONE_COLORS.forEach(({ color, name }) => {
      const item = document.createElement('div');
      item.style.cssText = `
        display: flex;
        align-items: center;
        margin-bottom: 4px;
        padding: 2px;
        border-radius: 4px;
        transition: background-color 0.2s ease;
      `;

      const colorBox = document.createElement('span');
      colorBox.style.cssText = `
        width: 10px;
        height: 10px;
        background: ${color};
        display: inline-block;
        margin-right: 6px;
        border-radius: 2px;
        border: 1px solid rgba(0,0,0,0.1);
      `;

      const nameText = document.createElement('span');
      nameText.textContent = name;
      nameText.style.cssText = `
        font-weight: 500;
        color: #374151;
        font-size: 11px;
      `;

      item.appendChild(colorBox);
      item.appendChild(nameText);
      div.appendChild(item);
    });

    return div;
  }
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
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const drawLayerRef = useRef<L.FeatureGroup | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);
  const defaultCircleRef = useRef<L.Circle | null>(null);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current) {
      const map = L.map("map", {
        zoomControl: true,
        doubleClickZoom: false,
      }).setView([defaultCenter.lat, defaultCenter.lng], 13);

      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const drawnItems = new L.FeatureGroup();
      map.addLayer(drawnItems);
      drawLayerRef.current = drawnItems;

      // Create layer for markers
      const markersLayer = L.layerGroup().addTo(map);
      markersLayerRef.current = markersLayer;

      // Add default circle if no game boundaries
      if (!game?.boundaries) {
        const initialRadius = defaultRadiusMiles * 1609.34; // Convert miles to meters
        const defaultCircle = L.circle(
          [defaultCenter.lat, defaultCenter.lng],
          {
            radius: initialRadius,
            color: ZONE_COLORS[0].color,
            fillColor: ZONE_COLORS[0].color,
            fillOpacity: ZONE_STYLES.fillOpacity,
            weight: ZONE_STYLES.weight,
            opacity: ZONE_STYLES.opacity,
          }
        ).addTo(map);

        defaultCircleRef.current = defaultCircle;
        const bounds = defaultCircle.getBounds();
        map.fitBounds(bounds, { padding: [50, 50] });
      }

      if (mode === "draw") {
        const drawControl = new L.Control.Draw({
          draw: {
            polygon: {
              shapeOptions: {
                color: '#3b82f6',
                fillColor: '#3b82f6',
                fillOpacity: 0.2,
                weight: 3,
              }
            },
            rectangle: false,
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

        map.on(L.Draw.Event.CREATED, (e: any) => {
          drawnItems.clearLayers();
          const layer = e.layer as L.Polygon;
          drawnItems.addLayer(layer);

          if (onAreaSelect) {
            const geoJSON = layer.toGeoJSON() as Feature<Polygon>;
            onAreaSelect(geoJSON);

            // Clear existing zones
            if (zonesLayerRef.current) {
              zonesLayerRef.current.clearLayers();
              zonesLayerRef.current.remove();
            }

            // Create new layer group for zones
            zonesLayerRef.current = L.layerGroup().addTo(map);

            // Calculate center from the polygon coordinates
            const coordinates = geoJSON.geometry.coordinates[0];
            const center = coordinates.reduce(
              (acc, coord) => ({
                lat: acc.lat + coord[1] / coordinates.length,
                lng: acc.lng + coord[0] / coordinates.length
              }),
              { lat: 0, lng: 0 }
            );

            // Calculate initial radius based on the furthest point
            const initialRadius = Math.max(...coordinates.map((coord) => {
              const lat = coord[1];
              const lng = coord[0];
              const latDiff = center.lat - lat;
              const lngDiff = center.lng - lng;
              return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
            })) * 111111; // Convert to meters (roughly)

            // Draw each shrinking zone
            let currentRadius = initialRadius;
            const settings = global.gameSettings || {
              zoneConfigs: [
                { durationMinutes: 15, radiusMultiplier: 0.75, intervalMinutes: 20 },
                { durationMinutes: 10, radiusMultiplier: 0.5, intervalMinutes: 15 },
                { durationMinutes: 5, radiusMultiplier: 0.25, intervalMinutes: 10 },
              ],
            };

            settings.zoneConfigs.forEach((zone: any, index: number) => {
              currentRadius = initialRadius * zone.radiusMultiplier;
              const zoneColor = ZONE_COLORS[index + 1] || ZONE_COLORS[ZONE_COLORS.length - 1];

              L.circle(
                [center.lat, center.lng],
                {
                  radius: currentRadius,
                  color: zoneColor.color,
                  fillColor: zoneColor.color,
                  fillOpacity: ZONE_STYLES.fillOpacity,
                  weight: ZONE_STYLES.weight,
                  opacity: ZONE_STYLES.opacity,
                  dashArray: '5, 10',
                }
              ).addTo(zonesLayerRef.current!);
            });
          }
        });
      }

      // Add zone legend to bottom-right corner
      map.addControl(new ZoneLegend({ position: 'bottomright' }));
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markersLayerRef.current = null;
        drawLayerRef.current = null;
        zonesLayerRef.current = null;
        defaultCircleRef.current = null;
      }
    };
  }, []);

  // Update when selectedArea changes
  useEffect(() => {
    if (!mapRef.current || !selectedArea) return;

    const map = mapRef.current;

    // Clear existing zones
    if (zonesLayerRef.current) {
      zonesLayerRef.current.clearLayers();
      zonesLayerRef.current.remove();
    }

    // Create new layer group for zones
    zonesLayerRef.current = L.layerGroup().addTo(map);

    // Calculate center from the polygon coordinates
    const coordinates = selectedArea.geometry.coordinates[0];
    const center = coordinates.reduce(
      (acc, coord) => ({
        lat: acc.lat + coord[1] / coordinates.length,
        lng: acc.lng + coord[0] / coordinates.length
      }),
      { lat: 0, lng: 0 }
    );

    // Calculate initial radius based on the furthest point
    const initialRadius = Math.max(...coordinates.map((coord) => {
      const lat = coord[1];
      const lng = coord[0];
      const latDiff = center.lat - lat;
      const lngDiff = center.lng - lng;
      return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
    })) * 111111; // Convert to meters (roughly)

    // Draw each shrinking zone
    let currentRadius = initialRadius;
    const defaultZoneConfigs = [
      { durationMinutes: 15, radiusMultiplier: 0.75, intervalMinutes: 20 },
      { durationMinutes: 10, radiusMultiplier: 0.5, intervalMinutes: 15 },
      { durationMinutes: 5, radiusMultiplier: 0.25, intervalMinutes: 10 },
    ];

    defaultZoneConfigs.forEach((zone, index) => {
      currentRadius = initialRadius * zone.radiusMultiplier;
      const zoneColor = ZONE_COLORS[index + 1] || ZONE_COLORS[ZONE_COLORS.length - 1];

      L.circle(
        [center.lat, center.lng],
        {
          radius: currentRadius,
          color: zoneColor.color,
          fillColor: zoneColor.color,
          fillOpacity: ZONE_STYLES.fillOpacity,
          weight: ZONE_STYLES.weight,
          opacity: ZONE_STYLES.opacity,
          dashArray: '5, 10',
        }
      ).addTo(zonesLayerRef.current!);
    });
  }, [selectedArea]);

  return (
    <div
      id="map"
      className="w-full h-full"
      style={{ minHeight: "300px" }}
    />
  );
}