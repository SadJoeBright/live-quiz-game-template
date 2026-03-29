import { randomBytes, randomUUID } from 'crypto';
import type { WebSocket } from 'ws';
import {
  buildFinishedScoreboard,
  buildQuestionPayload,
  computeRoundResults,
  generateRoomCode,
  nonHostPlayers,
  serializePlayersForClient,
  validateQuestionsList,
} from './domain/quizGameLogic';
import { InMemoryGameRepository } from './persistence/InMemoryGameRepository';
import { InMemoryUserRepository } from './persistence/InMemoryUserRepository';
import { ConnectionSessionStore } from './session/ConnectionSessionStore';
import type {
  AnswerData,
  CreateGameData,
  Game,
  JoinGameData,
  Player,
  RegData,
  StartGameData,
  User,
  WSMessage,
} from './types';

const NEXT_QUESTION_DELAY_MS = 4000;

export class GameService {
  constructor(
    private readonly userRepository: InMemoryUserRepository,
    private readonly gameRepository: InMemoryGameRepository,
    private readonly sessionStore: ConnectionSessionStore,
  ) {}

  private send(socket: WebSocket, type: string, data: unknown, messageId: number): void {
    const message: WSMessage = { type, data, id: messageId };
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private broadcast(game: Game, type: string, data: unknown): void {
    const message: WSMessage = { type, data, id: 0 };
    const serialized = JSON.stringify(message);
    const delivered = new Set<WebSocket>();

    for (const player of game.players) {
      const playerSocket = player.ws;
      if (!playerSocket || playerSocket.readyState !== playerSocket.OPEN || delivered.has(playerSocket)) {
        continue;
      }
      playerSocket.send(serialized);
      delivered.add(playerSocket);
    }

    const hostUser = this.userRepository.findByIndex(game.hostId);
    const hostSocket = hostUser?.ws;
    if (hostSocket && hostSocket.readyState === hostSocket.OPEN && !delivered.has(hostSocket)) {
      hostSocket.send(serialized);
    }
  }

  private getUserIndex(socket: WebSocket): string | undefined {
    return this.sessionStore.get(socket)?.userIndex;
  }

  private clearQuestionTimer(game: Game): void {
    if (game.questionTimer) {
      clearTimeout(game.questionTimer);
      game.questionTimer = undefined;
    }
  }

  private removePlayerFromGame(game: Game, playerIndex: string): void {
    game.players = game.players.filter((player) => player.index !== playerIndex);
    this.userRepository.clearSocket(playerIndex);
  }

  register(socket: WebSocket, message: WSMessage): void {
    const messageId = message.id;
    const request = message.data as RegData;
    const name = typeof request?.name === 'string' ? request.name.trim() : '';
    const password = typeof request?.password === 'string' ? request.password : '';

    if (!name) {
      this.send(socket, 'reg', { name: '', index: '', error: true, errorText: 'Name is required' }, messageId);
      return;
    }

    const userIndex = randomUUID();
    const user: User = { name, password, index: userIndex, ws: socket };
    this.userRepository.save(user);
    this.sessionStore.bindAfterRegistration(socket, userIndex);

    this.send(socket, 'reg', { name, index: userIndex, error: false, errorText: '' }, messageId);
  }

  createGame(socket: WebSocket, message: WSMessage): void {
    const messageId = message.id;
    const userIndex = this.getUserIndex(socket);
    if (!userIndex) {
      this.send(socket, 'error', { message: 'Not registered' }, messageId);
      return;
    }

    const request = message.data as CreateGameData;
    const validated = validateQuestionsList(request?.questions);
    if (!validated.ok) {
      this.send(socket, 'error', { message: validated.error }, messageId);
      return;
    }
    const questions = validated.questions;

    const host = this.userRepository.findByIndex(userIndex);
    if (!host) {
      this.send(socket, 'error', { message: 'User not found' }, messageId);
      return;
    }

    let roomCode = generateRoomCode();
    while (this.gameRepository.isRoomCodeTaken(roomCode)) {
      roomCode = generateRoomCode();
    }

    const gameId = randomBytes(8).toString('hex');

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

    this.gameRepository.save(game);
    this.sessionStore.setGameId(socket, gameId);
    this.userRepository.attachSocket(userIndex, socket);

    this.send(socket, 'game_created', { gameId, code: roomCode }, messageId);
    this.broadcast(game, 'update_players', serializePlayersForClient(game));
  }

  joinGame(socket: WebSocket, message: WSMessage): void {
    const messageId = message.id;
    const userIndex = this.getUserIndex(socket);
    if (!userIndex) {
      this.send(socket, 'error', { message: 'Not registered' }, messageId);
      return;
    }

    const request = message.data as JoinGameData;
    const roomCode = typeof request?.code === 'string' ? request.code.trim().toUpperCase() : '';
    if (roomCode.length !== 6) {
      this.send(socket, 'error', { message: 'Invalid room code' }, messageId);
      return;
    }

    const gameId = this.gameRepository.findIdByRoomCode(roomCode);
    if (!gameId) {
      this.send(socket, 'error', { message: 'Game not found' }, messageId);
      return;
    }

    const game = this.gameRepository.findById(gameId);
    if (!game || game.status !== 'waiting') {
      this.send(socket, 'error', { message: 'Cannot join this game' }, messageId);
      return;
    }

    if (userIndex === game.hostId) {
      this.userRepository.attachSocket(userIndex, socket);
      this.sessionStore.setGameId(socket, gameId);
      this.send(socket, 'game_joined', { gameId }, messageId);
      this.broadcast(game, 'update_players', serializePlayersForClient(game));
      return;
    }

    if (game.players.some((player) => player.index === userIndex)) {
      const existingUser = this.userRepository.findByIndex(userIndex);
      if (!existingUser) {
        this.send(socket, 'error', { message: 'User not found' }, messageId);
        return;
      }
      this.userRepository.attachSocket(userIndex, socket);
      this.sessionStore.setGameId(socket, gameId);
      this.send(socket, 'game_joined', { gameId }, messageId);
      this.broadcast(game, 'update_players', serializePlayersForClient(game));
      return;
    }

    const user = this.userRepository.findByIndex(userIndex);
    if (!user) {
      this.send(socket, 'error', { message: 'User not found' }, messageId);
      return;
    }

    const newPlayer: Player = {
      name: user.name,
      index: userIndex,
      score: 0,
      ws: socket,
    };
    game.players.push(newPlayer);
    this.userRepository.attachSocket(userIndex, socket);
    this.sessionStore.setGameId(socket, gameId);

    this.send(socket, 'game_joined', { gameId }, messageId);
    this.broadcast(game, 'player_joined', {
      playerName: user.name,
      playerCount: game.players.length,
    });
    this.broadcast(game, 'update_players', serializePlayersForClient(game));
  }

  startGame(socket: WebSocket, message: WSMessage): void {
    const messageId = message.id;
    const userIndex = this.getUserIndex(socket);
    if (!userIndex) {
      this.send(socket, 'error', { message: 'Not registered' }, messageId);
      return;
    }

    const request = message.data as StartGameData;
    const gameId = typeof request?.gameId === 'string' ? request.gameId : '';
    const game = this.gameRepository.findById(gameId);
    if (!game || game.hostId !== userIndex) {
      this.send(socket, 'error', { message: 'Only the host can start the game' }, messageId);
      return;
    }
    if (game.status !== 'waiting') {
      this.send(socket, 'error', { message: 'Game already started' }, messageId);
      return;
    }
    if (game.players.length < 1) {
      this.send(socket, 'error', { message: 'Need at least one player to start' }, messageId);
      return;
    }

    game.status = 'in_progress';
    game.currentQuestion = -1;
    this.broadcast(game, 'update_players', serializePlayersForClient(game));
    this.advanceToNextQuestion(game);
  }

  answer(socket: WebSocket, message: WSMessage): void {
    const messageId = message.id;
    const userIndex = this.getUserIndex(socket);
    if (!userIndex) {
      this.send(socket, 'error', { message: 'Not registered' }, messageId);
      return;
    }

    const request = message.data as AnswerData;
    const gameId = typeof request?.gameId === 'string' ? request.gameId : '';
    const questionIndex = typeof request?.questionIndex === 'number' ? request.questionIndex : -1;
    const answerIndex = typeof request?.answerIndex === 'number' ? request.answerIndex : -1;

    const game = this.gameRepository.findById(gameId);
    if (!game || game.status !== 'in_progress') {
      this.send(socket, 'error', { message: 'No active game' }, messageId);
      return;
    }
    if (userIndex === game.hostId) {
      this.send(socket, 'error', { message: 'Host does not answer' }, messageId);
      return;
    }
    if (questionIndex !== game.currentQuestion) {
      this.send(socket, 'error', { message: 'Wrong question' }, messageId);
      return;
    }
    if (answerIndex < 0 || answerIndex > 3) {
      this.send(socket, 'error', { message: 'Invalid answer' }, messageId);
      return;
    }
    if (game.playerAnswers.has(userIndex)) {
      this.send(socket, 'error', { message: 'Already answered' }, messageId);
      return;
    }

    const now = Date.now();
    game.playerAnswers.set(userIndex, { answerIndex, timestamp: now });
    this.send(socket, 'answer_accepted', { questionIndex }, messageId);

    const nonHostPlayerCount = nonHostPlayers(game).length;
    if (nonHostPlayerCount > 0 && game.playerAnswers.size >= nonHostPlayerCount) {
      this.clearQuestionTimer(game);
      this.finishQuestion(game);
    }
  }

  onDisconnect(socket: WebSocket): void {
    const context = this.sessionStore.get(socket);
    if (!context) return;
    const { userIndex, gameId } = context;
    this.sessionStore.remove(socket);

    this.userRepository.clearSocket(userIndex);

    if (!gameId) return;
    const game = this.gameRepository.findById(gameId);
    if (!game) return;

    if (game.status === 'waiting') {
      if (game.hostId === userIndex) {
        this.broadcast(game, 'error', { message: 'Host left — game cancelled' });
        this.deleteGame(game);
        return;
      }
      this.removePlayerFromGame(game, userIndex);
      this.broadcast(game, 'update_players', serializePlayersForClient(game));
      return;
    }

    if (game.status === 'in_progress') {
      this.removePlayerFromGame(game, userIndex);
      if (game.hostId === userIndex) {
        this.clearQuestionTimer(game);
        this.broadcast(game, 'error', { message: 'Host disconnected' });
        this.deleteGame(game);
        return;
      }
      const nonHostPlayerCount = nonHostPlayers(game).length;
      if (nonHostPlayerCount > 0 && game.playerAnswers.size >= nonHostPlayerCount) {
        this.clearQuestionTimer(game);
        this.finishQuestion(game);
      }
    }
  }

  private clearRoomSessionBindings(game: Game): void {
    this.sessionStore.clearGameIdForAllPlayersInGame(game);
    const hostUser = this.userRepository.findByIndex(game.hostId);
    this.sessionStore.clearGameIdOnSocket(hostUser?.ws);
  }

  private deleteGame(game: Game): void {
    this.clearQuestionTimer(game);
    this.clearRoomSessionBindings(game);
    this.gameRepository.remove(game);
  }

  private advanceToNextQuestion(game: Game): void {
    const nextQuestionIndex = game.currentQuestion + 1;
    if (nextQuestionIndex >= game.questions.length) {
      game.status = 'finished';
      this.broadcastGameFinished(game);
      return;
    }

    game.currentQuestion = nextQuestionIndex;
    game.playerAnswers = new Map();
    game.questionStartTime = Date.now();

    const questionPayload = buildQuestionPayload(game, nextQuestionIndex);
    this.broadcast(game, 'question', questionPayload);

    const question = game.questions[nextQuestionIndex]!;
    const nonHostPlayerCount = nonHostPlayers(game).length;
    const roundTimeoutMs =
      nonHostPlayerCount === 0 ? 1000 : Math.max(1000, question.timeLimitSec * 1000);

    this.clearQuestionTimer(game);
    game.questionTimer = setTimeout(() => {
      game.questionTimer = undefined;
      if (game.status !== 'in_progress' || game.currentQuestion !== nextQuestionIndex) return;
      this.finishQuestion(game);
    }, roundTimeoutMs);
  }

  private finishQuestion(game: Game): void {
    if (game.status !== 'in_progress' || game.currentQuestion < 0) return;

    const currentQuestionIndex = game.currentQuestion;
    const results = computeRoundResults(game);

    this.clearQuestionTimer(game);
    this.broadcast(game, 'question_result', {
      questionIndex: currentQuestionIndex,
      correctIndex: game.questions[currentQuestionIndex]!.correctIndex,
      playerResults: results,
    });

    setTimeout(() => {
      if (game.status !== 'in_progress' || game.currentQuestion !== currentQuestionIndex) return;
      this.advanceToNextQuestion(game);
    }, NEXT_QUESTION_DELAY_MS);
  }

  private broadcastGameFinished(game: Game): void {
    const scoreboard = buildFinishedScoreboard(game);
    this.broadcast(game, 'game_finished', { scoreboard });
    this.clearQuestionTimer(game);
    this.clearRoomSessionBindings(game);
    this.gameRepository.remove(game);
  }
}

const userRepository = new InMemoryUserRepository();
const gameRepository = new InMemoryGameRepository();
const sessionStore = new ConnectionSessionStore();

export default new GameService(userRepository, gameRepository, sessionStore);
