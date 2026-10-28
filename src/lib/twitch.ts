/** Read-only Twitch chat using user-authorized EventSub WebSockets. */
export type TwitchConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface TwitchConnectionStatus {
  state: TwitchConnectionState;
  message: string;
  channel?: string;
}

export interface TwitchConnectionOptions {
  clientId: string;
  accessToken: string;
  channel: string;
}

export interface TwitchChatMessage {
  id: string;
  userId: string;
  user: string;
  text: string;
  color: string;
  timestamp: string;
}

export interface TwitchChatCallbacks {
  onStatus: (status: TwitchConnectionStatus) => void;
  onMessage: (message: TwitchChatMessage) => void;
}

interface TwitchDependencies {
  fetch?: typeof fetch;
  createSocket?: (url: string) => WebSocket;
}

interface TokenValidation {
  client_id: string;
  user_id: string;
  scopes: string[];
  expires_in: number;
}

type EventSubMessage = {
  metadata?: { message_id?: string; message_type?: string; message_timestamp?: string; subscription_type?: string };
  payload?: {
    session?: { id?: string; keepalive_timeout_seconds?: number; reconnect_url?: string };
    subscription?: { type?: string; status?: string };
    event?: { message_id?: string; chatter_user_id?: string; chatter_user_name?: string; chatter_user_login?: string; color?: string; message?: { text?: string } };
  };
};

const ENDPOINT = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';

/** Tokens are never written to storage or URLs by this module. */
export class TwitchChatClient {
  private readonly request: typeof fetch;
  private readonly createSocket: (url: string) => WebSocket;
  private readonly callbacks: TwitchChatCallbacks;
  private options?: TwitchConnectionOptions;
  private identity?: TokenValidation;
  private broadcasterId = '';
  private generation = 0;
  private stopped = true;
  private sockets = new Set<WebSocket>();
  private activeSocket?: WebSocket;
  private handoffSocket?: WebSocket;
  private watchdogs = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  private retryTimer?: ReturnType<typeof setTimeout>;
  private validationTimer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private abort?: AbortController;
  private seen = new Set<string>();
  private failure?: Error;
  private settle?: { resolve: () => void; reject: (reason: Error) => void };

  constructor(callbacks: TwitchChatCallbacks, dependencies: TwitchDependencies = {}) {
    this.callbacks = callbacks;
    this.request = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.createSocket = dependencies.createSocket ?? ((url) => new WebSocket(url));
  }

  async connect(options: TwitchConnectionOptions): Promise<void> {
    this.disconnect();
    const generation = this.generation;
    this.stopped = false;
    this.options = {
      clientId: options.clientId.trim(),
      accessToken: options.accessToken.trim().replace(/^oauth:/i, ''),
      channel: options.channel.trim().replace(/^#/, '').toLowerCase(),
    };
    this.abort = new AbortController();
    this.status('connecting', 'Checking Twitch authorization…');
    try {
      if (!this.options.clientId || !this.options.accessToken) throw new Error('Enter your Twitch app client ID and a user access token.');
      if (!/^[a-z0-9_]{1,25}$/.test(this.options.channel)) throw new Error('Enter a Twitch channel name, without its URL.');
      this.identity = await this.validateToken();
      if (!this.current(generation)) return;
      const response = await this.request(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(this.options.channel)}`, {
        headers: this.headers(), signal: this.abort.signal,
      });
      if (!response.ok) throw new Error(await this.apiError(response, 'Could not find this Twitch channel.'));
      const body = await response.json() as { data?: Array<{ id?: string }> };
      if (!this.current(generation)) return;
      const id = body.data?.[0]?.id;
      if (!id) throw new Error('That Twitch channel was not found. Check its spelling.');
      this.broadcasterId = id;
      await new Promise<void>((resolve, reject) => {
        this.settle = { resolve, reject };
        this.open(ENDPOINT, generation);
      });
    } catch (error) {
      if (!this.current(generation)) {
        if (error === this.failure) throw error;
        return;
      }
      const reason = error instanceof TypeError
        ? new Error('Could not reach Twitch. Check your network or browser blocking, then reconnect.')
        : error instanceof Error ? error : new Error('Twitch could not connect. Check your network and try again.');
      this.fail(reason);
      throw reason;
    }
  }

  disconnect(): void {
    this.stopped = true;
    this.generation += 1;
    this.abort?.abort();
    this.abort = undefined;
    this.cleanupSockets();
    clearTimeout(this.retryTimer);
    clearTimeout(this.validationTimer);
    this.retryTimer = undefined;
    this.validationTimer = undefined;
    this.options = undefined;
    this.identity = undefined;
    this.broadcasterId = '';
    this.attempts = 0;
    this.seen.clear();
    this.failure = undefined;
    // A disconnect during connect is a normal cancellation, not an unhandled rejection.
    this.settle?.resolve();
    this.settle = undefined;
    this.callbacks.onStatus({ state: 'disconnected', message: 'Twitch disconnected' });
  }

  private current(generation: number): boolean {
    return !this.stopped && generation === this.generation;
  }

  private status(state: TwitchConnectionState, message: string): void {
    this.callbacks.onStatus({ state, message, channel: this.options?.channel });
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.options!.accessToken}`, 'Client-Id': this.options!.clientId };
  }

  private async validateToken(): Promise<TokenValidation> {
    const options = this.options!;
    const response = await this.request('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${options.accessToken}` }, signal: this.abort?.signal,
    });
    if (!response.ok) throw new Error('Your Twitch token expired or was revoked. Authorize again and reconnect.');
    const token = await response.json() as TokenValidation;
    if (token.client_id !== options.clientId) throw new Error('The access token belongs to a different app. Use the client ID that generated it.');
    if (!token.user_id) throw new Error('A user access token is required. App access tokens cannot read chat over WebSockets.');
    if (!token.scopes?.includes('user:read:chat')) throw new Error('This token needs the user:read:chat permission. Authorize with that scope and reconnect.');
    if (!(token.expires_in > 0)) throw new Error('Your Twitch token has expired. Authorize again and reconnect.');
    return token;
  }

  private scheduleValidation(generation: number): void {
    clearTimeout(this.validationTimer);
    // Twitch requires startup and hourly validation; also catch token expiry sooner.
    const delay = Math.min(3_600_000, Math.max(1_000, (this.identity?.expires_in ?? 3_600) * 1_000));
    this.validationTimer = setTimeout(() => {
      void this.validateToken().then((identity) => {
        if (!this.current(generation)) return;
        this.identity = identity;
        this.scheduleValidation(generation);
      }).catch((error: unknown) => {
        if (this.current(generation)) this.fail(error instanceof Error ? error : new Error('Twitch authorization could not be verified. Reconnect to continue.'));
      });
    }, delay);
  }

  private open(url: string, generation: number, previous?: WebSocket): void {
    if (!this.current(generation)) return;
    let parsed: URL;
    try { parsed = new URL(url); }
    catch { this.fail(new Error('Twitch returned an invalid reconnect address. Disconnect and reconnect.')); return; }
    if (parsed.protocol !== 'wss:' || parsed.hostname !== 'eventsub.wss.twitch.tv') {
      this.fail(new Error('Twitch returned an unexpected reconnect address. Disconnect and reconnect.'));
      return;
    }
    let socket: WebSocket;
    try { socket = this.createSocket(url); }
    catch { this.retry(generation); return; }
    this.sockets.add(socket);
    if (previous) this.handoffSocket = socket;
    else this.activeSocket = socket;
    let keepaliveMs = 30_000;
    let welcomed = false;
    this.watch(socket, generation, 15_000);

    socket.onmessage = (event: MessageEvent) => {
      if (!this.current(generation)) return;
      let message: EventSubMessage;
      try { message = JSON.parse(String(event.data)) as EventSubMessage; }
      catch { return; }
      if (!message || typeof message !== 'object') return;
      const kind = message.metadata?.message_type;
      if (kind === 'session_welcome') {
        welcomed = true;
        const session = message.payload?.session;
        if (!session?.id) { this.fail(new Error('Twitch did not supply a chat session. Reconnect and try again.')); return; }
        keepaliveMs = Math.max(10_000, (session.keepalive_timeout_seconds ?? 30) * 1_000);
        this.watch(socket, generation, keepaliveMs + 1_000);
        if (previous) {
          this.activeSocket = socket;
          this.handoffSocket = undefined;
          this.closeSocket(previous);
          this.connected(generation);
        } else {
          void this.subscribe(session.id, generation).then(() => {
            if (this.current(generation) && this.sockets.has(socket)) this.connected(generation);
          }).catch((error: unknown) => {
            if (this.current(generation)) this.fail(error instanceof Error ? error : new Error('Twitch chat subscription failed. Reconnect and try again.'));
          });
        }
      } else if (kind === 'session_keepalive' || kind === 'notification') {
        if (welcomed) this.watch(socket, generation, keepaliveMs + 1_000);
        const chat = parseTwitchChatMessage(message);
        if (chat && !this.seen.has(chat.id)) {
          this.seen.add(chat.id);
          // Bound retained identifiers while suppressing at-least-once deliveries.
          if (this.seen.size > 2_000) this.seen.delete(this.seen.values().next().value!);
          this.callbacks.onMessage(chat);
        }
      } else if (kind === 'session_reconnect') {
        const reconnectUrl = message.payload?.session?.reconnect_url;
        if (reconnectUrl && !this.handoffSocket) {
          this.status('reconnecting', 'Twitch is moving this chat connection…');
          this.open(reconnectUrl, generation, socket);
        }
      } else if (kind === 'revocation') {
        this.fail(new Error('Twitch revoked chat access. Check channel permissions, authorize again, and reconnect.'));
      }
    };
    socket.onerror = () => { /* Browser close event supplies the retry signal. */ };
    socket.onclose = () => {
      const wasRelevant = this.activeSocket === socket || this.handoffSocket === socket;
      this.releaseSocket(socket);
      if (this.current(generation) && wasRelevant) this.retry(generation);
    };
  }

  private async subscribe(sessionId: string, generation: number): Promise<void> {
    const response = await this.request('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/json' }, signal: this.abort?.signal,
      body: JSON.stringify({
        type: 'channel.chat.message', version: '1',
        condition: { broadcaster_user_id: this.broadcasterId, user_id: this.identity!.user_id },
        transport: { method: 'websocket', session_id: sessionId },
      }),
    });
    if (!this.current(generation)) return;
    if (!response.ok) {
      if (response.status === 401) throw new Error('Twitch authorization expired. Authorize again and reconnect.');
      if (response.status === 403) throw new Error('Twitch denied chat access. Check your user:read:chat scope and that this account can join the channel.');
      if (response.status === 429) throw new Error('Twitch rate limit reached. Wait a minute, then reconnect.');
      throw new Error(await this.apiError(response, 'Could not subscribe to Twitch chat. Reconnect and try again.'));
    }
  }

  private connected(generation: number): void {
    this.attempts = 0;
    this.status('connected', `Listening to #${this.options!.channel}`);
    this.scheduleValidation(generation);
    this.settle?.resolve();
    this.settle = undefined;
  }

  private watch(socket: WebSocket, generation: number, delay: number): void {
    clearTimeout(this.watchdogs.get(socket));
    this.watchdogs.set(socket, setTimeout(() => {
      if (!this.current(generation)) return;
      this.closeSocket(socket);
      this.retry(generation);
    }, delay));
  }

  private retry(generation: number): void {
    if (!this.current(generation) || this.retryTimer) return;
    this.cleanupSockets();
    if (this.attempts >= 5) { this.fail(new Error('Twitch connection was lost. Check your network and reconnect.')); return; }
    const delay = Math.min(16_000, 1_000 * 2 ** this.attempts++);
    this.status('reconnecting', 'Chat connection interrupted. Reconnecting…');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.open(ENDPOINT, generation);
    }, delay);
  }

  private releaseSocket(socket: WebSocket): void {
    clearTimeout(this.watchdogs.get(socket));
    this.watchdogs.delete(socket);
    this.sockets.delete(socket);
    if (this.activeSocket === socket) this.activeSocket = undefined;
    if (this.handoffSocket === socket) this.handoffSocket = undefined;
  }

  private closeSocket(socket: WebSocket): void {
    this.releaseSocket(socket);
    socket.onclose = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.close();
  }

  private cleanupSockets(): void {
    for (const socket of [...this.sockets]) this.closeSocket(socket);
  }

  private fail(error: Error): void {
    const pending = this.settle;
    this.settle = undefined;
    const channel = this.options?.channel;
    this.disconnect();
    this.failure = error;
    this.callbacks.onStatus({ state: 'error', message: error.message, channel });
    pending?.reject(error);
  }

  private async apiError(response: Response, fallback: string): Promise<string> {
    try {
      const body = await response.json() as { message?: unknown };
      // Do not echo server bodies, which may contain request information or credentials.
      if (typeof body.message === 'string' && /not found/i.test(body.message)) return 'That Twitch channel was not found. Check its spelling.';
    } catch { /* Keep a safe, actionable error for non-JSON responses. */ }
    return fallback;
  }
}

/** Only channel.chat.message notifications become game input. */
export function parseTwitchChatMessage(value: unknown): TwitchChatMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as EventSubMessage;
  if (message.metadata?.message_type !== 'notification') return null;
  if ((message.metadata.subscription_type ?? message.payload?.subscription?.type) !== 'channel.chat.message') return null;
  const event = message.payload?.event;
  if (typeof event?.message_id !== 'string' || !event.message_id || typeof event.chatter_user_id !== 'string' || !event.chatter_user_id || typeof event.message?.text !== 'string') return null;
  const user = event.chatter_user_name || event.chatter_user_login;
  if (typeof user !== 'string' || !user) return null;
  return {
    id: event.message_id, userId: event.chatter_user_id, user, text: event.message.text,
    color: typeof event.color === 'string' && /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : '#a78bfa',
    timestamp: typeof message.metadata.message_timestamp === 'string' ? message.metadata.message_timestamp : '',
  };
}

/** Implicit OAuth is Twitch's supported flow for browser-only applications. */
export function createTwitchAuthorizationUrl(clientId: string, redirectUri: string, state: string): string {
  if (!clientId.trim() || state.length < 16) throw new Error('Provide a client ID and a random OAuth state of at least 16 characters.');
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname))) throw new Error('Use HTTPS for the OAuth redirect, or HTTP on localhost.');
  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.search = new URLSearchParams({ response_type: 'token', client_id: clientId.trim(), redirect_uri: redirectUri, scope: 'user:read:chat', state }).toString();
  return url.toString();
}
