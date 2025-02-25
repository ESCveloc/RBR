import { useEffect, useRef } from "react";
import type { Game } from "@db/schema";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import type { Feature, Polygon } from "geojson";
import "leaflet-draw";
import "leaflet-geometryutil";

const ZONE_COLORS = [
  { color: '#3b82f6', name: 'Initial Zone' },
  { color: '#10b981', name: 'First Shrink' },
  { color: '#f59e0b', name: 'Second Shrink' },
  { color: '#ef4444', name: 'Final Zone' }
];

const STARTING_POINT_STYLE = {
  radius: 12,
  color: '#000',
  weight: 2,
  opacity: 1,
  fillColor: '#fff',
  fillOpacity: 0.8
};

const ZONE_STYLE = {
  weight: 2,
  opacity: 0.9,
  fillOpacity: 0.1
};

const getZoneStyle = (index: number) => ({
  ...ZONE_STYLE,
  dashArray: index === 0 ? undefined : '5, 10',
});

const SHRINK_MULTIPLIERS = [1, 0.75, 0.5, 0.25];

function generateStartingPoints(center: L.LatLng, radius: number, count: number = 10) {
  const points: L.LatLng[] = [];
  // Start at top (90 degrees) and go clockwise
  const startAngle = Math.PI / 2;
  for (let i = 0; i < count; i++) {
    // Go clockwise (negative angle)
    const angle = startAngle - (i * 2 * Math.PI / count);
    const x = center.lng + (radius * Math.cos(angle)) / (111111 * Math.cos(center.lat * Math.PI / 180));
    const y = center.lat + (radius * Math.sin(angle)) / 111111;
    points.push(L.latLng(y, x));
  }
  return points;
}

function createZones(map: L.Map, center: L.LatLng, initialRadius: number, game?: Game) {
  const zonesLayer = L.layerGroup().addTo(map);

  // Draw zone circles
  ZONE_COLORS.forEach((zone, index) => {
    L.circle(center, {
      radius: initialRadius * SHRINK_MULTIPLIERS[index],
      color: zone.color,
      fillColor: zone.color,
      ...getZoneStyle(index)
    }).addTo(zonesLayer);
  });

  if (game?.status === 'pending') {
    const startingPoints = generateStartingPoints(center, initialRadius);
    startingPoints.forEach((point, index) => {
      const siteNumber = index + 1; // Use 1-based position
      const assignedTeam = game.participants?.find(
        p => p.startingLocation?.position === siteNumber
      );

      // Create the site marker circle
      const marker = L.circleMarker(point, {
        ...STARTING_POINT_STYLE,
        fillColor: assignedTeam ? '#f97316' : '#fff',
        fillOpacity: assignedTeam ? 0.8 : 0.8,
        radius: 15
      });

      // Create a custom label for the site number
      const iconHtml = `
        <div style="
          position: relative;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 14px;
          color: ${assignedTeam ? 'white' : 'black'};
          z-index: 1000;
          text-shadow: 0px 0px 2px rgba(255,255,255,0.5);
        ">${siteNumber}</div>`;

      const icon = L.divIcon({
        html: iconHtml,
        className: 'custom-div-icon',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });

      // Add the number label
      L.marker(point, { icon, interactive: false }).addTo(zonesLayer);

      if (assignedTeam) {
        marker.bindTooltip(`Site ${siteNumber}: ${assignedTeam.team?.name || 'Team'}`);
      } else {
        marker.bindTooltip(`Site ${siteNumber}: Unassigned`);
      }

      marker.addTo(zonesLayer);
    });
  }

  return zonesLayer;
}

class ZoneLegend extends L.Control {
  onAdd(map: L.Map) {
    const div = L.DomUtil.create('div', 'info legend');
    div.style.cssText = `
      background: white;
      padding: 8px;
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      font-size: 12px;
      color: black;
    `;

    div.innerHTML = '<div style="font-weight: 600; margin-bottom: 4px; color: black;">Zone Phases</div>';

    ZONE_COLORS.forEach(zone => {
      div.innerHTML += `
        <div style="display: flex; align-items: center; margin: 2px 0;">
          <span style="width: 12px; height: 12px; background: ${zone.color}; 
                       display: inline-block; margin-right: 5px; border-radius: 2px;">
          </span>
          <span style="color: black;">${zone.name}</span>
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

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;

      if (mode === "draw") {
        const drawLayer = new L.FeatureGroup().addTo(map);
        drawLayerRef.current = drawLayer;

        const drawControl = new L.Control.Draw({
          draw: {
            polygon: {
              shapeOptions: {
                color: ZONE_COLORS[0].color,
                fillColor: ZONE_COLORS[0].color,
                ...getZoneStyle(0)
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

      new ZoneLegend({ position: 'bottomright' }).addTo(map);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        zonesLayerRef.current = null;
        drawLayerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (zonesLayerRef.current) {
      zonesLayerRef.current.clearLayers();
      zonesLayerRef.current.remove();
      zonesLayerRef.current = null;
    }

    let center: L.LatLng;
    let radius: number;

    if (game?.boundaries) {
      const coords = game.boundaries.geometry.coordinates[0];
      const centerPoint = coords.reduce(
        (acc, [lng, lat]) => ({
          lat: acc.lat + lat / coords.length,
          lng: acc.lng + lng / coords.length
        }),
        { lat: 0, lng: 0 }
      );

      center = L.latLng(centerPoint.lat, centerPoint.lng);
      radius = Math.max(...coords.map(([lng, lat]) => {
        return center.distanceTo(L.latLng(lat, lng));
      }));
    } else {
      center = L.latLng(defaultCenter.lat, defaultCenter.lng);
      radius = defaultRadiusMiles * 1609.34;
    }

    zonesLayerRef.current = createZones(map, center, radius, game);

    const bounds = L.latLngBounds([center]);
    bounds.extend(L.latLng(center.lat + radius * 0.000009, center.lng + radius * 0.000009));
    bounds.extend(L.latLng(center.lat - radius * 0.000009, center.lng - radius * 0.000009));
    map.fitBounds(bounds, { padding: [50, 50] });

  }, [game?.boundaries, defaultCenter, defaultRadiusMiles, game?.participants]);

  return (
    <div
      id="map"
      className="w-full h-full"
      style={{ minHeight: "300px" }}
    />
  );
}