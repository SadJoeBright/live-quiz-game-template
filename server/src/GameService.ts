import { randomBytes, randomUUID } from 'crypto';
import type { WebSocket } from 'ws';
import type {
  AnswerData,
  CreateGameData,
  Game,
  JoinGameData,
  Player,
  PlayerResult,
  Question,
  RegData,
  StartGameData,
  User,
  WSMessage,
} from './types';

type ConnectionContext = {
  userIndex: string;
  gameId?: string;
};

const NEXT_QUESTION_DELAY_MS = 4000;

const generateRoomCode = (): string =>  {
  const allowedCharacters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let roomCode = '';
  for (let index = 0; index < 6; index++) {
    roomCode += allowedCharacters[Math.floor(Math.random() * allowedCharacters.length)]!;
  }
	
  return roomCode;
}

class GameService {
  private users = new Map<string, User>();
  private games = new Map<string, Game>();
  private connectionsBySocket = new Map<WebSocket, ConnectionContext>();
  private gamesByCode = new Map<string, string>();

  private send(ws: WebSocket, type: string, data: unknown, messageId: number): void {
    const message: WSMessage = { type, data, id: messageId };
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private broadcast(game: Game, type: string, data: unknown): void {
    const message: WSMessage = { type, data, id: 0 };
    const serialized = JSON.stringify(message);
    for (const player of game.players) {
      const playerSocket = player.ws;
      if (playerSocket && playerSocket.readyState === playerSocket.OPEN) {
        playerSocket.send(serialized);
      }
    }
  }

  private getUserIndex(ws: WebSocket): string | undefined {
    return this.connectionsBySocket.get(ws)?.userIndex;
  }

  private setGameIdOnConnection(socket: WebSocket, gameId: string): void {
    const connection = this.connectionsBySocket.get(socket);
    if (connection) connection.gameId = gameId;
  }

  private nonHostPlayers(game: Game): Player[] {
    return game.players.filter((player) => player.index !== game.hostId);
  }

  private clearQuestionTimer(game: Game): void {
    if (game.questionTimer) {
      clearTimeout(game.questionTimer);
      game.questionTimer = undefined;
    }
  }

  private removePlayerFromGame(game: Game, playerIndex: string): void {
    game.players = game.players.filter((player) => player.index !== playerIndex);
    const user = this.users.get(playerIndex);
    if (user) user.ws = undefined;
  }

	private serializePlayers(game: Game): Player[] {
    return game.players.map((player) => ({
      name: player.name,
      index: player.index,
      score: player.score,
    }));
  }

  register(ws: WebSocket, message: WSMessage): void {
    const messageId = message.id;
    const request = message.data as RegData;
    const name = typeof request?.name === 'string' ? request.name.trim() : '';
    const password = typeof request?.password === 'string' ? request.password : '';

    if (!name) {
      this.send(ws, 'reg', { name: '', index: '', error: true, errorText: 'Name is required' }, messageId);
      return;
    }

    const userIndex = randomUUID();
    const user: User = { name, password, index: userIndex, ws: ws };
    this.users.set(userIndex, user);
    this.connectionsBySocket.set(ws, { userIndex });

    this.send(ws, 'reg', { name, index: userIndex, error: false, errorText: '' }, messageId);
  }

  createGame(ws: WebSocket, message: WSMessage): void {
    const messageId = message.id;
    const userIndex = this.getUserIndex(ws);
    if (!userIndex) {
      this.send(ws, 'error', { message: 'Not registered' }, messageId);
      return;
    }

    const request = message.data as CreateGameData;
    const questions = Array.isArray(request?.questions) ? (request.questions as Question[]) : [];
    if (questions.length === 0) {
      this.send(ws, 'error', { message: 'Add at least one question' }, messageId);
      return;
    }

    for (const question of questions) {
      if (
        !question?.text ||
        !Array.isArray(question.options) ||
        question.options.length !== 4 ||
        typeof question.correctIndex !== 'number' ||
        question.correctIndex < 0 ||
        question.correctIndex > 3 ||
        typeof question.timeLimitSec !== 'number' ||
        question.timeLimitSec < 1
      ) {
        this.send(ws, 'error', { message: 'Invalid question format' }, messageId);
        return;
      }
    }

    const host = this.users.get(userIndex);
    if (!host) {
      this.send(ws, 'error', { message: 'User not found' }, messageId);
      return;
    }

    let roomCode = generateRoomCode();
    while (this.gamesByCode.has(roomCode)) {
      roomCode = generateRoomCode();
    }

    const gameId = randomBytes(8).toString('hex');
    const hostPlayer: Player = {
      name: host.name,
      index: userIndex,
      score: 0,
      ws: ws,
    };

    const game: Game = {
      id: gameId,
      code: roomCode,
      hostId: userIndex,
      questions,
      players: [],
      currentQuestion: -1,
      status: 'waiting',
      playerAnswers: new Map(),
    };

    this.games.set(gameId, game);
    this.gamesByCode.set(roomCode, gameId);
    this.setGameIdOnConnection(ws, gameId);
    host.ws = ws;

    this.send(ws, 'game_created', { gameId, code: roomCode }, messageId);
    this.broadcast(game, 'update_players', this.serializePlayers(game));
  }

  
}

export default new GameService();
