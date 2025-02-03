// Utility functions for consistent game status display across the app
import { cn } from "./utils";

export function getGameStatusColor(status: string) {
  switch (status) {
    case "pending":
      return "bg-yellow-500/10 text-yellow-500";
    case "active":
      return "bg-green-500/10 text-green-500";
    case "completed":
      return "bg-purple-500/15 text-purple-700";
    case "cancelled":
      return "bg-red-500/10 text-red-500";
    default:
      return "bg-gray-500/10 text-gray-500";
  }
}

export function getGameStatusText(status: string) {
  switch (status) {
    case "pending":
      return "Starting Soon";
    case "active":
      return "In Progress";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

interface GameStatusBadgeProps {
  status: string;
  className?: string;
}

export function gameStatusClasses({ status, className }: GameStatusBadgeProps) {
  return cn(getGameStatusColor(status), className);
}
