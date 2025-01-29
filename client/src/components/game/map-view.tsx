import { useEffect, useRef } from "react";
import type { Game } from "@db/schema";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import type { Feature, Polygon } from "geojson";
import "leaflet-draw";
import "leaflet-geometryutil";

// Add custom control for starting location legend
class StartingLocationLegend extends L.Control {
  onAdd(map: L.Map) {
    const div = L.DomUtil.create('div', 'starting-location-legend');
    div.style.cssText = `
      background: white;
      padding: 10px;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      font-family: system-ui, sans-serif;
      font-size: 12px;
      max-width: 200px;
      color: #1f2937;
      margin: 10px;
    `;

    const title = document.createElement('h4');
    title.textContent = 'Starting Locations';
    title.style.cssText = `
      margin: 0 0 8px 0;
      font-weight: 600;
      color: #111827;
      font-size: 14px;
    `;
    div.appendChild(title);

    const description = document.createElement('p');
    description.textContent = 'Numbers indicate team starting positions';
    description.style.cssText = `
      margin: 0;
      font-size: 12px;
      color: #6b7280;
    `;
    div.appendChild(description);

    return div;
  }
}

// Default game settings
const DEFAULT_GAME_SETTINGS = {
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
  defaultCenter = DEFAULT_GAME_SETTINGS.defaultCenter,
  defaultRadiusMiles = DEFAULT_GAME_SETTINGS.defaultRadiusMiles,
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
        // Create initial zone circle
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

        // Create shrinking zone circles
        let currentRadius = initialRadius;
        DEFAULT_GAME_SETTINGS.zoneConfigs.forEach((config, index) => {
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
              dashArray: '5, 10',
            }
          ).addTo(map);

          currentRadius = nextRadius;
        });

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
          }
        });
      }

      // Add legends
      if (mode === "view") {
        map.addControl(new StartingLocationLegend({ position: 'bottomright' }));
      }
      map.addControl(new ZoneLegend({ position: 'topright' }));
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

  // Update starting location markers when game data changes
  useEffect(() => {
    const map = mapRef.current;
    const markersLayer = markersLayerRef.current;

    if (!map || !markersLayer || !game?.boundaries) return;

    // Clear existing markers
    markersLayer.clearLayers();

    // Generate starting locations for the game
    const coordinates = game.boundaries.geometry.coordinates[0];
    const center = coordinates.reduce(
      (acc, coord) => ({
        lat: acc.lat + coord[1] / coordinates.length,
        lng: acc.lng + coord[0] / coordinates.length
      }),
      { lat: 0, lng: 0 }
    );

    // Calculate radius (distance from center to furthest point)
    const radius = Math.max(...coordinates.map(coord => {
      const lat = coord[1];
      const lng = coord[0];
      const latDiff = center.lat - lat;
      const lngDiff = center.lng - lng;
      return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
    })) * 0.95; // Slightly reduce radius to keep markers inside boundary

    // Create markers for each starting position
    for (let i = 0; i < game.maxTeams; i++) {
      const angle = (i * 2 * Math.PI) / game.maxTeams;
      const lat = center.lat + radius * Math.sin(angle);
      const lng = center.lng + radius * Math.cos(angle);

      // Create marker with custom icon
      const markerIcon = L.divIcon({
        className: 'starting-location-marker',
        html: `<div style="
          background-color: white;
          border: 2px solid #3b82f6;
          color: #1f2937;
          width: 24px;
          height: 24px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 12px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        ">${i + 1}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      // Find assigned team for this position
      const assignedTeam = game.participants?.find(
        p => p.startingLocation?.position === i + 1
      );

      // Create marker with tooltip showing team assignment
      const marker = L.marker([lat, lng], { icon: markerIcon });

      if (assignedTeam) {
        marker.bindTooltip(`Position ${i + 1}: Team ${assignedTeam.teamId}`, {
          permanent: false,
          direction: 'top'
        });
      } else {
        marker.bindTooltip(`Position ${i + 1}: Unassigned`, {
          permanent: false,
          direction: 'top'
        });
      }

      marker.addTo(markersLayer);
    }
  }, [game?.boundaries, game?.maxTeams, game?.participants]);

  // Update map when game boundaries and zones change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !game?.boundaries) return;

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

    // Create new layer group for zones
    zonesLayerRef.current = L.layerGroup().addTo(map);

    // Draw the main boundary
    const boundaryLayer = L.geoJSON(game.boundaries, {
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
    if (Array.isArray(game.zoneConfigs)) {
      game.zoneConfigs.forEach((zone, index) => {
        if (!zone || typeof zone.radiusMultiplier !== 'number') return;

        const nextRadius = currentRadius * zone.radiusMultiplier;
        const zoneColor = ZONE_COLORS[index + 1] || ZONE_COLORS[ZONE_COLORS.length - 1];

        L.circle(
          [center.lat, center.lng],
          {
            radius: nextRadius,
            color: zoneColor.color,
            fillColor: zoneColor.color,
            fillOpacity: ZONE_STYLES.fillOpacity,
            weight: ZONE_STYLES.weight,
            opacity: ZONE_STYLES.opacity,
            dashArray: '5, 10',
          }
        ).addTo(zonesLayerRef.current!);

        currentRadius = nextRadius;
      });
    }

    // Fit map to show all zones with padding
    map.fitBounds(boundaryLayer.getBounds(), { padding: [50, 50] });
  }, [game?.boundaries, game?.zoneConfigs]);

  return (
    <div
      id="map"
      className="w-full h-full"
      style={{ minHeight: "300px" }}
    />
  );
}

// Custom control for zone legend
class ZoneLegend extends L.Control {
  onAdd(map: L.Map) {
    const div = L.DomUtil.create('div', 'zone-legend');
    div.style.cssText = `
      background: white;
      padding: 10px;
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      font-family: system-ui, sans-serif;
      font-size: 12px;
      max-width: 200px;
      color: #1f2937;
      margin: 10px;
    `;

    const title = document.createElement('h4');
    title.textContent = 'Zone Legend';
    title.style.cssText = `
      margin: 0 0 8px 0;
      font-weight: 600;
      color: #111827;
      font-size: 14px;
    `;
    div.appendChild(title);

    ZONE_COLORS.forEach(({ color, name, description }) => {
      const item = document.createElement('div');
      item.style.cssText = `
        display: flex;
        align-items: center;
        margin-bottom: 6px;
        padding: 4px;
        border-radius: 4px;
        transition: background-color 0.2s ease;
        cursor: help;
      `;

      const colorBox = document.createElement('span');
      colorBox.style.cssText = `
        width: 12px;
        height: 12px;
        background: ${color};
        display: inline-block;
        margin-right: 8px;
        border-radius: 3px;
        border: 1px solid rgba(0,0,0,0.1);
      `;

      const textContainer = document.createElement('div');
      textContainer.style.cssText = `
        display: flex;
        flex-direction: column;
      `;

      const nameText = document.createElement('span');
      nameText.textContent = name;
      nameText.style.cssText = `
        font-weight: 500;
        color: #374151;
        font-size: 12px;
      `;

      const descText = document.createElement('span');
      descText.textContent = description;
      descText.style.cssText = `
        font-size: 10px;
        color: #6b7280;
        margin-top: 2px;
      `;

      textContainer.appendChild(nameText);
      textContainer.appendChild(descText);
      item.appendChild(colorBox);
      item.appendChild(textContainer);
      div.appendChild(item);
    });

    return div;
  }
}