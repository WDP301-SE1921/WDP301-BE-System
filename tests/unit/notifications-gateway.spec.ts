import {
  isSameHostOrigin,
  NotificationsGateway,
} from '../../src/modules/notifications/notifications.gateway';

interface FakeSocket {
  handshake: {
    address: string;
    headers: { origin?: string; host?: string };
    auth: { token?: string };
  };
  data?: unknown;
}

describe('NotificationsGateway origin check', () => {
  describe('isSameHostOrigin', () => {
    it('accepts the API address React Native sends as Origin', () => {
      expect(
        isSameHostOrigin('https://wdp301-be-system.onrender.com', 'wdp301-be-system.onrender.com'),
      ).toBe(true);
      expect(isSameHostOrigin('http://192.168.0.7:3000', '192.168.0.7:3000')).toBe(true);
      expect(isSameHostOrigin('https://API.example.com', 'api.example.com')).toBe(true);
    });

    it('rejects other sites, other ports, a missing host and malformed origins', () => {
      expect(isSameHostOrigin('https://evil.example', 'wdp301-be-system.onrender.com')).toBe(false);
      expect(isSameHostOrigin('http://192.168.0.7:3001', '192.168.0.7:3000')).toBe(false);
      expect(isSameHostOrigin('https://wdp301-be-system.onrender.com', undefined)).toBe(false);
      expect(isSameHostOrigin('not a url', 'wdp301-be-system.onrender.com')).toBe(false);
    });
  });

  describe('handshake', () => {
    function setup(): {
      authenticate: (socket: FakeSocket) => Promise<void>;
      verifyRealtimeToken: jest.Mock;
    } {
      const verifyRealtimeToken = jest.fn().mockResolvedValue({
        userId: 'parent-1',
        sessionId: 'session-1',
        expiresAt: Date.now() + 60000,
      });
      const config = {
        get: (key: string): unknown => (key === 'corsOrigins' ? ['http://localhost:3001'] : 100),
      };
      const gateway = new NotificationsGateway(
        { verifyRealtimeToken } as unknown as never,
        config as unknown as never,
      );
      const internals = gateway as unknown as {
        server: { sockets: Map<string, unknown> };
        authenticate: (socket: FakeSocket) => Promise<void>;
      };
      internals.server = { sockets: new Map() };
      return { authenticate: (socket) => internals.authenticate(socket), verifyRealtimeToken };
    }

    function socket(origin: string, host = 'wdp301-be-system.onrender.com'): FakeSocket {
      return {
        handshake: { address: '10.0.0.1', headers: { origin, host }, auth: { token: 't' } },
      };
    }

    it('lets the mobile app in when Origin is the API itself', async () => {
      const { authenticate, verifyRealtimeToken } = setup();
      await expect(
        authenticate(socket('https://wdp301-be-system.onrender.com')),
      ).resolves.toBeUndefined();
      expect(verifyRealtimeToken).toHaveBeenCalledWith('t');
    });

    it('still allows listed web origins and rejects unlisted sites', async () => {
      const { authenticate } = setup();
      await expect(authenticate(socket('http://localhost:3001'))).resolves.toBeUndefined();
      await expect(authenticate(socket('https://evil.example'))).rejects.toThrow(
        'ORIGIN_NOT_ALLOWED',
      );
    });
  });
});
