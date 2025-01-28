import { useEffect, useRef } from "react";
import type { Event } from "@db/schema";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import type { Feature, Polygon } from "geojson";
import "leaflet-draw";
import "leaflet-geometryutil";

// Default event settings
const DEFAULT_EVENT_SETTINGS = {
  defaultCenter: { lat: 35.8462, lng: -86.3928 },
  defaultRadiusMiles: 1,
  zoneConfigs: [
    { durationMinutes: 15, radiusMultiplier: 0.75, intervalMinutes: 20 },
    { durationMinutes: 10, radiusMultiplier: 0.5, intervalMinutes: 15 },
    { durationMinutes: 5, radiusMultiplier: 0.25, intervalMinutes: 10 },
  ],
};

// Zone colors with semantic meanings
const ZONE_COLORS = [
  { color: '#3b82f6', name: 'Initial Zone', description: 'Starting play area' },
  { color: '#10b981', name: 'First Shrink', description: 'First zone reduction' },
  { color: '#f59e0b', name: 'Second Shrink', description: 'Second zone reduction' },
  { color: '#ef4444', name: 'Final Zone', description: 'Final combat area' },
];

// Update the boundary styling with transition properties
const ZONE_STYLES = {
  fillOpacity: 0.2,
  weight: 3,
  opacity: 0.9,
  className: 'zone-transition'
};

// Add CSS for transitions
const zoneTransitionStyles = `
  .zone-transition {
    transition: all 1.5s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .leaflet-interactive {
    transition: all 1.5s cubic-bezier(0.4, 0, 0.2, 1);
  }
`;

// Custom control for zone legend
class ZoneLegend extends L.Control {
  onAdd(map: L.Map) {
    const div = L.DomUtil.create('div', 'zone-legend');
    div.style.cssText = `
      background: rgb(255, 255, 255);
      padding: 8px 12px;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      font-family: system-ui, sans-serif;
      font-size: 12px;
      max-width: none;
      color: #1f2937;
      margin: 10px;
      display: flex;
      align-items: center;
      gap: 16px;
      border: 1px solid rgba(0,0,0,0.1);
    `;

    const title = document.createElement('h4');
    title.textContent = 'Zone Legend';
    title.style.cssText = `
      margin: 0;
      font-weight: 600;
      color: #111827;
      font-size: 14px;
      white-space: nowrap;
    `;
    div.appendChild(title);

    const itemsContainer = document.createElement('div');
    itemsContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 16px;
    `;

    ZONE_COLORS.forEach(({ color, name, description }) => {
      const item = document.createElement('div');
      item.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 4px;
        border-radius: 4px;
        transition: background-color 0.2s ease;
        cursor: help;
        white-space: nowrap;
      `;

      const colorBox = document.createElement('span');
      colorBox.style.cssText = `
        width: 12px;
        height: 12px;
        background: ${color};
        display: inline-block;
        border-radius: 3px;
        border: 1px solid rgba(0,0,0,0.1);
      `;

      const nameText = document.createElement('span');
      nameText.textContent = name;
      nameText.style.cssText = `
        font-weight: 500;
        color: #374151;
        font-size: 12px;
      `;

      // Create tooltip for description
      item.title = description;

      item.appendChild(colorBox);
      item.appendChild(nameText);
      itemsContainer.appendChild(item);
    });

    div.appendChild(itemsContainer);
    return div;
  }
}

interface MapViewProps {
  event?: Event;
  mode?: "view" | "draw";
  onAreaSelect?: (area: Feature<Polygon>) => void;
  selectedArea?: Feature<Polygon> | null;
  defaultCenter?: { lat: number; lng: number };
  defaultRadiusMiles?: number;
}

export function MapView({
  event,
  mode = "view",
  onAreaSelect,
  selectedArea,
  defaultCenter = DEFAULT_EVENT_SETTINGS.defaultCenter,
  defaultRadiusMiles = DEFAULT_EVENT_SETTINGS.defaultRadiusMiles,
}: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
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

      // Add default circle if no event boundaries
      if (!event?.boundaries) {
        // Create initial zone circle
        const initialRadius = defaultRadiusMiles * 1609.34; // Convert miles to meters
        const initialCircle = L.circle(
          [defaultCenter.lat, defaultCenter.lng],
          {
            radius: initialRadius,
            color: ZONE_COLORS[0].color,
            fillColor: ZONE_COLORS[0].color,
            fillOpacity: ZONE_STYLES.fillOpacity,
            weight: ZONE_STYLES.weight,
            opacity: ZONE_STYLES.opacity,
            className: ZONE_STYLES.className,
          }
        ).addTo(map);

        // Create shrinking zone circles
        let currentRadius = initialRadius;
        DEFAULT_EVENT_SETTINGS.zoneConfigs.forEach((config, index) => {
          const nextRadius = currentRadius * config.radiusMultiplier;
          L.circle(
            [defaultCenter.lat, defaultCenter.lng],
            {
              radius: nextRadius,
              color: ZONE_COLORS[index + 1].color,
              fillColor: ZONE_COLORS[index + 1].color,
              fillOpacity: ZONE_STYLES.fillOpacity,
              weight: ZONE_STYLES.weight,
              opacity: ZONE_STYLES.opacity,
              className: ZONE_STYLES.className,
              dashArray: '5, 10',
            }
          ).addTo(map);

          currentRadius = nextRadius;
        });

        // Store references for cleanup
        defaultCircleRef.current = initialCircle;

        // Fit bounds to show all circles
        const bounds = initialCircle.getBounds();
        map.fitBounds(bounds, { padding: [50, 50] });
      }

      if (mode === "draw") {
        const drawControl = new L.Control.Draw({
          draw: {
            polygon: {
              shapeOptions: {
                color: ZONE_COLORS[0].color,
                fillColor: ZONE_COLORS[0].color,
                ...ZONE_STYLES,
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
          }
        });
      }

      // Add legend
      map.addControl(new ZoneLegend({ position: 'topleft' }));
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        drawLayerRef.current = null;
        zonesLayerRef.current = null;
        defaultCircleRef.current = null;
      }
    };
  }, []);

  // Update map when event boundaries and zones change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !event?.boundaries) return;

    // Remove default circle if it exists
    if (defaultCircleRef.current) {
      defaultCircleRef.current.removeFrom(map);
      defaultCircleRef.current = null;
    }

    // Clear existing zones
    if (zonesLayerRef.current) {
      zonesLayerRef.current.clearLayers();
      zonesLayerRef.current.remove();
    }

    // Create new layer group
    zonesLayerRef.current = L.layerGroup().addTo(map);

    // Draw the main boundary
    const boundaryLayer = L.geoJSON(event.boundaries, {
      style: {
        color: ZONE_COLORS[0].color,
        fillColor: ZONE_COLORS[0].color,
        ...ZONE_STYLES,
      },
    }).addTo(zonesLayerRef.current);

    // Calculate center and initial radius
    const bounds = boundaryLayer.getBounds();
    const center = bounds.getCenter();
    const initialRadius = bounds.getNorthEast().distanceTo(center);

    // Draw each shrinking zone
    let currentRadius = initialRadius;
    if (Array.isArray(event.zoneConfigs)) {
      event.zoneConfigs.forEach((zone: any, index: number) => {
        if (!zone || typeof zone.radiusMultiplier !== 'number') return;

        // Calculate next radius based on current radius and multiplier
        const nextRadius = currentRadius * zone.radiusMultiplier;
        const zoneColor = ZONE_COLORS[index + 1] || ZONE_COLORS[ZONE_COLORS.length - 1];

        // Create zone circle
        L.circle(
          [center.lat, center.lng],
          {
            radius: nextRadius,
            color: zoneColor.color,
            fillColor: zoneColor.color,
            ...ZONE_STYLES,
            dashArray: '5, 10',
          }
        ).addTo(zonesLayerRef.current!);

        currentRadius = nextRadius;
      });
    }

    // Fit map to show all zones with padding
    map.fitBounds(boundaryLayer.getBounds(), { padding: [50, 50] });
  }, [event?.boundaries, event?.zoneConfigs]);

  return (
    <div
      id="map"
      className="w-full h-full"
      style={{ minHeight: "300px" }}
    />
  );
}