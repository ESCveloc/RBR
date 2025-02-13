import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Game, GameParticipant } from "@db/schema";
import { Card } from "@/components/ui/card";
import { useWebSocket } from "@/hooks/use-websocket";

interface MiniMapProps {
  game: Game;
  participant?: GameParticipant;
}

const ZONE_COLORS = [
  '#3b82f6', // Initial Zone
  '#10b981', // First Shrink
  '#f59e0b', // Second Shrink
  '#ef4444'  // Final Zone
];

export function MiniMap({ game, participant }: MiniMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const playersLayerRef = useRef<L.LayerGroup | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);
  const { subscribeToMessage } = useWebSocket();

  useEffect(() => {
    if (!mapRef.current && game?.boundaries) {
      // Initialize map
      const map = L.map("mini-map", {
        zoomControl: false,
        dragging: false,
        touchZoom: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
      });

      // Add OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
      playersLayerRef.current = L.layerGroup().addTo(map);
      zonesLayerRef.current = L.layerGroup().addTo(map);

      // Set view to game boundaries
      const coords = game.boundaries.geometry.coordinates[0];
      const bounds = L.latLngBounds(coords.map(([lng, lat]) => [lat, lng]));
      map.fitBounds(bounds);

      // Subscribe to player location updates
      const unsubscribeLocations = subscribeToMessage("LOCATION_UPDATE", (payload) => {
        if (playersLayerRef.current) {
          playersLayerRef.current.clearLayers();

          // Add markers for each player
          payload.players.forEach((player: any) => {
            const isTeammate = player.teamId === participant?.teamId;
            const marker = L.circleMarker(
              [player.location.latitude, player.location.longitude],
              {
                radius: 4,
                color: isTeammate ? '#10b981' : '#ef4444',
                fillColor: isTeammate ? '#10b981' : '#ef4444',
                fillOpacity: 0.7,
                weight: 1
              }
            );

            if (isTeammate) {
              marker.bindTooltip(player.name, {
                permanent: true,
                direction: 'top',
                offset: [0, -5],
                className: 'mini-map-label'
              });
            }

            marker.addTo(playersLayerRef.current!);
          });
        }
      });

      // Subscribe to zone updates
      const unsubscribeZones = subscribeToMessage("ZONE_UPDATE", (payload) => {
        if (zonesLayerRef.current) {
          zonesLayerRef.current.clearLayers();

          // Add circles for each zone phase
          payload.zones.forEach((zone: any, index: number) => {
            L.circle([zone.center.lat, zone.center.lng], {
              radius: zone.radius,
              color: ZONE_COLORS[index],
              fillColor: ZONE_COLORS[index],
              fillOpacity: 0.1,
              weight: 1,
              dashArray: index === 0 ? undefined : '5, 10'
            }).addTo(zonesLayerRef.current!);
          });
        }
      });

      return () => {
        unsubscribeLocations();
        unsubscribeZones();
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
          playersLayerRef.current = null;
          zonesLayerRef.current = null;
        }
      };
    }
  }, [game?.boundaries, participant?.teamId, subscribeToMessage]);

  return (
    <Card className="fixed bottom-4 right-4 w-64 h-64 overflow-hidden">
      <div id="mini-map" className="w-full h-full" />
    </Card>
  );
}
