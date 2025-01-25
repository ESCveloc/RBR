import { useEffect, useRef } from "react";
import type { Game } from "@db/schema";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import type { Feature } from "geojson";

// Extend leaflet types to include Draw control
declare module 'leaflet' {
  namespace Control {
    class Draw extends L.Control {
      constructor(options?: DrawConstructorOptions)
    }
  }

  interface DrawConstructorOptions {
    draw?: DrawOptions;
    edit?: {
      featureGroup: L.FeatureGroup;
    };
  }

  interface DrawOptions {
    polyline?: boolean;
    polygon?: boolean;
    circle?: boolean;
    rectangle?: boolean;
    marker?: boolean;
    circlemarker?: boolean;
  }

  namespace Draw {
    namespace Event {
      const CREATED: 'draw:created';
    }
  }
}

type DrawEventCreated = {
  layer: L.Layer;
  layerType: string;
};

interface MapViewProps {
  game?: Game;
  mode?: "view" | "draw";
  onAreaSelect?: (area: Feature) => void;
  selectedArea?: Feature | null;
}

type Coordinates = [number, number];

interface Location {
  type: "Point";
  coordinates: Coordinates;
}

interface TeamWithLocation {
  name: string;
  location?: Location;
}

interface ParticipantWithTeam {
  location?: Location;
  team: TeamWithLocation;
}

export function MapView({
  game,
  mode = "view",
  onAreaSelect,
  selectedArea,
}: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const drawControlRef = useRef<L.Control.Draw | null>(null);

  useEffect(() => {
    if (!mapRef.current) {
      const map = L.map("map").setView([0, 0], 13);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      if (mode === "draw") {
        const drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);

        const drawControl = new L.Control.Draw({
          draw: {
            polygon: true,
            circle: false,
            circlemarker: false,
            marker: false,
            polyline: false,
            rectangle: true,
          },
          edit: {
            featureGroup: drawnItems,
          },
        });
        map.addControl(drawControl);
        drawControlRef.current = drawControl;

        map.on('draw:created', (event: { layer: L.Layer; layerType: string }) => {
          const layer = event.layer;
          drawnItems.clearLayers();
          drawnItems.addLayer(layer);

          if (onAreaSelect) {
            onAreaSelect(layer.toGeoJSON());
          }
        });
      }

      // Enable location tracking
      map.locate({ watch: true, enableHighAccuracy: true });

      mapRef.current = map;
    }

    // Cleanup
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [mode, onAreaSelect]);

  useEffect(() => {
    if (mapRef.current && game?.boundaries) {
      // Clear existing layers
      mapRef.current.eachLayer((layer: L.Layer) => {
        if (layer instanceof L.Marker || layer instanceof L.Polygon) {
          mapRef.current?.removeLayer(layer);
        }
      });

      // Draw game boundaries
      const boundariesLayer = L.geoJSON(game.boundaries as Feature);
      boundariesLayer.addTo(mapRef.current);
      mapRef.current.fitBounds(boundariesLayer.getBounds());

      // Draw team locations
      if ('participants' in game) {
        const participants = game.participants as ParticipantWithTeam[];
        participants.forEach((participant) => {
          if (participant.location) {
            const { coordinates } = participant.location;
            L.marker([coordinates[1], coordinates[0]], {
              icon: L.divIcon({
                className: "team-marker",
                html: `<div class="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold">
                        ${participant.team.name[0]}
                      </div>`,
              }),
            }).addTo(mapRef.current!);
          }
        });
      }
    }
  }, [game]);

  return (
    <div
      id="map"
      className="w-full h-full min-h-[400px] rounded-lg overflow-hidden"
    />
  );
}