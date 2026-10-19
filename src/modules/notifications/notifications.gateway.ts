import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import type { AppConfiguration } from '../../config/configuration';
import { AuthService } from '../auth/auth.service';

type Client = Socket<
  Record<string, never>,
  Record<string, (payload: object) => void>,
  Record<string, never>,
  { userId: string; sessionId: string; expiresAt: number }
>;
@WebSocketGateway({
  namespace: '/notifications',
  path: '/socket.io',
  transports: ['websocket'],
  maxHttpBufferSize: 16384,
})
export class NotificationsGateway implements OnGatewayInit, OnModuleDestroy {
  @WebSocketServer() private server!: Namespace;
  private timer?: NodeJS.Timeout;
  private checking?: Promise<void>;
  private readonly attempts = new Map<string, { count: number; until: number }>();
  private readonly logger = new Logger(NotificationsGateway.name);
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppConfiguration, true>,
  ) {}
  afterInit(server: Namespace): void {
    server.use((socket: Client, next) => {
      void this.authenticate(socket).then(
        () => next(),
        (error: unknown) => {
          const allowed = [
            'AUTH_UNAUTHORIZED',
            'ORIGIN_NOT_ALLOWED',
            'REALTIME_RATE_LIMITED',
            'REALTIME_CONNECTION_LIMIT',
          ];
          next(
            new Error(
              error instanceof Error && allowed.includes(error.message)
                ? error.message
                : 'REALTIME_UNAVAILABLE',
            ),
          );
        },
      );
    });
    server.on('connection', (socket: Client) => {
      void socket.join(`user:${socket.data.userId}`);
      const expiry = setTimeout(
        () => socket.disconnect(true),
        Math.max(0, socket.data.expiresAt - Date.now()),
      );
      expiry.unref();
      socket.once('disconnect', () => clearTimeout(expiry));
    });
    this.timer = setInterval(() => {
      if (this.checking) return;
      this.checking = this.revalidate()
        .catch(() => this.logger.error('Notification socket session check failed'))
        .finally(() => {
          this.checking = undefined;
        });
    }, 15000);
    this.timer.unref();
  }
  private async authenticate(socket: Client): Promise<void> {
    const now = Date.now();
    for (const [ip, value] of this.attempts) if (value.until <= now) this.attempts.delete(ip);
    const ip = socket.handshake.address;
    const entry = this.attempts.get(ip) ?? { count: 0, until: now + 60000 };
    entry.count++;
    this.attempts.set(ip, entry);
    if (entry.count > this.config.get('throttleLimitPerMinute', { infer: true }))
      throw new Error('REALTIME_RATE_LIMITED');
    const origin = socket.handshake.headers.origin;
    if (origin && !this.config.get('corsOrigins', { infer: true }).includes(origin))
      throw new Error('ORIGIN_NOT_ALLOWED');
    const token: unknown = (socket.handshake.auth as Record<string, unknown>).token;
    if (typeof token !== 'string' || token.length > 8192) throw new Error('AUTH_UNAUTHORIZED');
    const identity = await this.auth.verifyRealtimeToken(token);
    if (!identity) throw new Error('AUTH_UNAUTHORIZED');
    if (
      [...this.server.sockets.values()].filter(
        (client: Client) => client.data.userId === identity.userId,
      ).length >= 10
    )
      throw new Error('REALTIME_CONNECTION_LIMIT');
    socket.data = {
      userId: identity.userId,
      sessionId: identity.sessionId,
      expiresAt: identity.expiresAt,
    };
  }
  /** The handshake credential may be a short ticket, so later checks use the session itself. */
  private async valid(socket: Client): Promise<boolean> {
    if (
      Date.now() >= socket.data.expiresAt ||
      !(await this.auth.isRealtimeSessionActive(socket.data.userId, socket.data.sessionId))
    ) {
      socket.disconnect(true);
      return false;
    }
    return true;
  }
  private async revalidate(): Promise<void> {
    if (this.server)
      await Promise.all(
        [...this.server.sockets.values()].map((socket: Client) => this.valid(socket)),
      );
  }
  async deliver(userId: string, event: string, payload: object): Promise<void> {
    if (!this.server) throw new Error('Gateway unavailable');
    const sockets = [...this.server.sockets.values()].filter(
      (socket: Client) => socket.data.userId === userId,
    );
    await Promise.all(
      sockets.map(async (socket: Client) => {
        if (await this.valid(socket)) socket.emit(event, payload);
      }),
    );
  }
  connectionCount(): number {
    return this.server?.sockets.size ?? 0;
  }
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.server?.disconnectSockets(true);
    await this.checking;
  }
}
