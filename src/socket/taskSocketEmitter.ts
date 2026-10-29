import { Server as SocketIOServer } from 'socket.io';
import logger from '../config/logger';

let io: SocketIOServer | null = null;

export function setTaskSocketServer(ioServer: SocketIOServer): void {
  io = ioServer;
}

export function getTaskSocketServer(): SocketIOServer | null {
  return io;
}

export function emitPartnerLocation(
  taskId: string,
  payload: { lat: number; lng: number; timestamp: number },
): void {
  if (!io) {
    logger.error('Socket.IO not initialized');
    return;
  }

  io.to(`task:${taskId}`).emit('partner:location', payload);
}

export function emitBannersUpdated(payload?: { placement?: string; timestamp?: number }): void {
  if (!io) {
    logger.warn('Socket.IO not initialized, could not emit banners:updated');
    return;
  }

  const data = {
    placement: payload?.placement,
    timestamp: payload?.timestamp || Date.now(),
  };
  logger.info(`📢 Emitting banners:updated: ${JSON.stringify(data)}`);
  io.emit('banners:updated', data);
}
