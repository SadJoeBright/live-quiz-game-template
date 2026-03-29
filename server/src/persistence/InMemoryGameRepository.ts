import type { Game } from '../types';

export class InMemoryGameRepository {
  private readonly gamesById = new Map<string, Game>();
  private readonly gameIdByRoomCode = new Map<string, string>();

  save(game: Game): void {
    this.gamesById.set(game.id, game);
    this.gameIdByRoomCode.set(game.code, game.id);
  }

  findById(gameId: string): Game | undefined {
    return this.gamesById.get(gameId);
  }

  findIdByRoomCode(roomCode: string): string | undefined {
    return this.gameIdByRoomCode.get(roomCode);
  }

  isRoomCodeTaken(roomCode: string): boolean {
    return this.gameIdByRoomCode.has(roomCode);
  }

  remove(game: Game): void {
    this.gamesById.delete(game.id);
    this.gameIdByRoomCode.delete(game.code);
  }
}
