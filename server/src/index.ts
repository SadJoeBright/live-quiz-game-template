import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import gameService from './GameService';
import type { WSMessage } from './types';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws: WebSocket) => {
  ws.on('error', console.error);

  ws.on('message', (data) => {
    try {
      const message: WSMessage  = JSON.parse(data.toString());
      switch (message.type) {
        case 'reg':
          gameService.register(ws, message);
          break;
        case 'create_game':
          gameService.createGame(ws, message);
          break;
      
        default:
          console.warn('Unknown message type:', message.type);
      }
    } catch (e) {
      console.error('Invalid message', e);
    }
  });


});

console.log(`WebSocket server listening on port ${PORT}`);
