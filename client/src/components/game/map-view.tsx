import { useEffect, useRef } from "react";
import type { Game } from "@db/schema";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import type { Feature, Polygon } from "geojson";
import "leaflet-draw";
import "leaflet-geometryutil";

// Zone colors for different stages
const ZONE_COLORS = [
  '#2563eb', // Blue
  '#16a34a', // Green
  '#ca8a04', // Yellow
  '#dc2626', // Red
];

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
        color: ZONE_COLORS[0],
        fillColor: ZONE_COLORS[0],
        fillOpacity: 0.1,
        weight: 2,
      },
    }).addTo(zonesLayerRef.current);

    // Calculate center and initial radius
    const bounds = boundaryLayer.getBounds();
    const center = bounds.getCenter();
    const initialRadius = bounds.getNorthEast().distanceTo(center);

    // Draw each zone
    let currentRadius = initialRadius;
    zoneConfigs.forEach((zone, index) => {
      const nextRadius = currentRadius * zone.radiusMultiplier;

      // Create zone polygon using direct calculation
      const vertices = calculateZoneBoundary(center, nextRadius);
      L.polygon(vertices, {
        color: ZONE_COLORS[index + 1] || ZONE_COLORS[ZONE_COLORS.length - 1],
        fillColor: ZONE_COLORS[index + 1] || ZONE_COLORS[ZONE_COLORS.length - 1],
        fillOpacity: 0.1,
        weight: 2,
        dashArray: '5, 10',
      }).addTo(zonesLayerRef.current!);

      currentRadius = nextRadius;
    });
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

      // Initialize layers
      const drawnItems = new L.FeatureGroup();
      map.addLayer(drawnItems);
      drawLayerRef.current = drawnItems;

      // Add default circle
      const circle = L.circle([defaultCenter.lat, defaultCenter.lng], {
        radius: defaultRadiusMiles * 1609.34,
        color: ZONE_COLORS[0],
        fillColor: ZONE_COLORS[0],
        fillOpacity: 0.1,
        weight: 2,
        dashArray: '5, 10',
      });
      circle.addTo(map);
      defaultCircleRef.current = circle;

      if (mode === "draw") {
        // Add draw controls
        const drawControl = new L.Control.Draw({
          draw: {
            polygon: {
              shapeOptions: {
                color: ZONE_COLORS[0]
              }
            },
            rectangle: {
              shapeOptions: {
                color: ZONE_COLORS[0]
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
      }
    };
  }, [mode, onAreaSelect, defaultCenter, defaultRadiusMiles]);

  // Update map when game boundaries and zones change
  useEffect(() => {
    const map = mapRef.current;
    const drawLayer = drawLayerRef.current;

    if (map && game?.boundaries) {
      // Clear existing layers
      if (drawLayer) {
        drawLayer.clearLayers();
      }
      if (defaultCircleRef.current) {
        defaultCircleRef.current.removeFrom(map);
      }

      // Draw game boundaries and zones
      if (game.zoneConfigs && game.zoneConfigs.length > 0) {
        drawGameZones(map, game.boundaries, game.zoneConfigs);
      } else {
        // Just draw the boundary if no zones
        const boundariesLayer = L.geoJSON(game.boundaries as any, {
          style: {
            color: ZONE_COLORS[0],
            fillColor: ZONE_COLORS[0],
            fillOpacity: 0.1,
            weight: 2,
          },
        }).addTo(map);
        map.fitBounds(boundariesLayer.getBounds());
      }
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
          color: ZONE_COLORS[0],
          fillColor: ZONE_COLORS[0],
          fillOpacity: 0.1,
          weight: 2,
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