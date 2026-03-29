import ws, { WebSocketServer } from 'ws';
import { Question, WSMessage } from './types';

type CreateGameData = {
	questions: Question[];
}

type GameCreatedData = {
	gameId: string;
	code: string;
}

type GameJoinedData = {
	gameId: string;
}


const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// WebSocket server
const wss = new WebSocketServer({ port: PORT });

let gameId: string;

wss.on('connection', function connection(ws) {
  ws.on('error', console.error);

  ws.on('message', function message(data) {
    console.log('received: %s', data);
		const message: WSMessage = JSON.parse(data.toString());

		switch (message.type) {
			case 'reg':
				handleReg(ws as unknown as WebSocket, message);
				break;
			case 'create_game':
				handleCreateGame(ws as unknown as WebSocket, message);
				break;
			case 'join_game':
				handleJoinGame(ws as unknown as WebSocket, message);
				break;
		}
  });

})

const handleReg = (ws: WebSocket, message: WSMessage) => {
	const response: WSMessage = { type: 'reg', data: message.data, id: message.id };
	ws.send(JSON.stringify(response));
}

const handleCreateGame = (ws: WebSocket, message: WSMessage) => {
	gameId = '123';
	const data: GameCreatedData = {
		gameId,
		code: '123456',
	}
	const response: WSMessage = { type: 'game_created', data: data, id: message.id };
	ws.send(JSON.stringify(response));
}

const handleJoinGame = (ws: WebSocket, message: WSMessage) => {
	const data: GameJoinedData = {
		gameId,
	}
	const response: WSMessage = { type: 'game_joined', data: data, id: message.id };
	ws.send(JSON.stringify(response));
}

