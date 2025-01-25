import { useEffect, useRef } from "react";
import type { Game } from "@db/schema";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import type { Feature, Polygon } from "geojson";
import "leaflet-draw"; // Import at top level

// Extend Leaflet types to include Draw functionality
declare module 'leaflet' {
  namespace Control {
    class Draw extends L.Control {
      constructor(options?: DrawConstructorOptions);
    }

    interface DrawConstructorOptions {
      draw?: {
        polyline?: boolean | DrawOptions;
        polygon?: boolean | DrawOptions;
        rectangle?: boolean | DrawOptions;
        circle?: boolean | DrawOptions;
        marker?: boolean | DrawOptions;
        circlemarker?: boolean | DrawOptions;
      };
      edit?: {
        featureGroup: L.FeatureGroup;
      };
    }

    interface DrawOptions {
      shapeOptions?: L.PathOptions;
      showArea?: boolean;
      metric?: boolean;
      repeatMode?: boolean;
    }
  }

  namespace Draw {
    namespace Event {
      const CREATED: string;
    }
  }
}

interface MapViewProps {
  game?: Game;
  mode?: "view" | "draw";
  onAreaSelect?: (area: Feature<Polygon>) => void;
  selectedArea?: Feature<Polygon> | null;
}

export function MapView({
  game,
  mode = "view",
  onAreaSelect,
  selectedArea,
}: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const drawLayerRef = useRef<L.FeatureGroup | null>(null);

  useEffect(() => {
    if (!mapRef.current) {
      // Initialize map centered on San Francisco
      const map = L.map("map").setView([37.7749, -122.4194], 13);
      mapRef.current = map;

      // Add OpenStreetMap tiles
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Initialize draw feature group
      const drawnItems = new L.FeatureGroup();
      map.addLayer(drawnItems);
      drawLayerRef.current = drawnItems;

      if (mode === "draw") {
        // Add draw controls
        const drawControl = new L.Control.Draw({
          draw: {
            polygon: {
              shapeOptions: {
                color: '#0969da'
              }
            },
            rectangle: {
              shapeOptions: {
                color: '#0969da'
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
      }
    };
  }, [mode, onAreaSelect]);

  // Update map when game boundaries change
  useEffect(() => {
    const map = mapRef.current;
    const drawLayer = drawLayerRef.current;

    if (map && game?.boundaries) {
      // Clear existing layers except the base tile layer
      if (drawLayer) {
        drawLayer.clearLayers();
      }

      // Add game boundaries
      const boundariesLayer = L.geoJSON(game.boundaries as any);
      boundariesLayer.addTo(map);
      map.fitBounds(boundariesLayer.getBounds());
    }
  }, [game]);

  // Update drawn area when selectedArea changes
  useEffect(() => {
    const map = mapRef.current;
    const drawLayer = drawLayerRef.current;

    if (map && drawLayer && selectedArea) {
      drawLayer.clearLayers();
      L.geoJSON(selectedArea).getLayers().forEach(layer => {
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