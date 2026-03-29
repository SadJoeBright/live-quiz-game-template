import type { WebSocket } from 'ws';
import type { ConnectionContext, Game } from '../types';


export class ConnectionSessionStore {
  private readonly contextBySocket = new Map<WebSocket, ConnectionContext>();

  bindAfterRegistration(socket: WebSocket, userIndex: string): void {
    this.contextBySocket.set(socket, { userIndex });
  }

  get(socket: WebSocket): ConnectionContext | undefined {
    return this.contextBySocket.get(socket);
  }

  setGameId(socket: WebSocket, gameId: string): void {
    const context = this.contextBySocket.get(socket);
    if (context) context.gameId = gameId;
  }

  remove(socket: WebSocket): void {
    this.contextBySocket.delete(socket);
  }

  clearGameIdForAllPlayersInGame(game: Game): void {
    for (const player of game.players) {
      if (!player.ws) continue;
      const context = this.contextBySocket.get(player.ws);
      if (context) context.gameId = undefined;
    }
  }

  clearGameIdOnSocket(socket: WebSocket | undefined): void {
    if (!socket) return;
    const context = this.contextBySocket.get(socket);
    if (context) context.gameId = undefined;
  }
}
