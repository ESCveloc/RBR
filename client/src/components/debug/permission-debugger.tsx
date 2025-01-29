import { useUser } from "@/hooks/use-user";

interface DebugProps {
  gameId?: number;
  createdBy?: number;
  gameStatus?: string;
}

export function PermissionDebugger({ gameId, createdBy, gameStatus }: DebugProps) {
  const { user } = useUser();

  // Only show in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  const isAdmin = user && user.role === 'admin';
  const isGameCreator = user && createdBy && user.id === createdBy;
  const canManageGame = Boolean(isAdmin || isGameCreator);

  return (
    <div className="fixed bottom-4 right-4 p-4 bg-black/80 text-white rounded-lg text-xs font-mono space-y-1">
      <div>User ID: {user?.id}</div>
      <div>Role: {user?.role}</div>
      <div>Is Admin: {String(isAdmin)}</div>
      <div>Is Creator: {String(isGameCreator)}</div>
      <div>Can Manage: {String(canManageGame)}</div>
      <div>Game Status: {gameStatus}</div>
    </div>
  );
}