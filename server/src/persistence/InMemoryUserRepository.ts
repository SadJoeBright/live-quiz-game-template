import type { WebSocket } from 'ws';
import type { User } from '../types';

export class InMemoryUserRepository {
  private readonly usersByIndex = new Map<string, User>();

  save(user: User): void {
    this.usersByIndex.set(user.index, user);
  }

  findByIndex(userIndex: string): User | undefined {
    return this.usersByIndex.get(userIndex);
  }

  attachSocket(userIndex: string, socket: WebSocket): void {
    const user = this.usersByIndex.get(userIndex);
    if (user) user.ws = socket;
  }

  clearSocket(userIndex: string): void {
    const user = this.usersByIndex.get(userIndex);
    if (user) user.ws = undefined;
  }
}
