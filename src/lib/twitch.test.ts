import assert from 'node:assert/strict';
import test from 'node:test';
import { createTwitchAuthorizationUrl, parseTwitchChatMessage, TwitchChatClient } from './twitch';

const chatEvent = {
  metadata: { message_type: 'notification', subscription_type: 'channel.chat.message', message_timestamp: '2026-10-26T14:00:00Z' },
  payload: { event: { message_id: 'msg-1', chatter_user_id: '42', chatter_user_name: 'Pilot', color: '#00FFAA', message: { text: '!scan' } } },
};

test('only valid chat notifications are accepted as game messages', () => {
  assert.deepEqual(parseTwitchChatMessage(chatEvent), { id: 'msg-1', userId: '42', user: 'Pilot', text: '!scan', color: '#00FFAA', timestamp: '2026-10-26T14:00:00Z' });
  assert.equal(parseTwitchChatMessage(null), null);
  assert.equal(parseTwitchChatMessage({ ...chatEvent, metadata: { message_type: 'session_keepalive' } }), null);
  assert.equal(parseTwitchChatMessage({ ...chatEvent, metadata: { message_type: 'notification', subscription_type: 'channel.follow' } }), null);
  assert.equal(parseTwitchChatMessage({ ...chatEvent, payload: { event: { message: { text: '!scan' } } } }), null);
});

test('invalid colors are normalized while message text stays plain data', () => {
  const event = structuredClone(chatEvent);
  event.payload.event.color = 'url(javascript:bad)';
  event.payload.event.message.text = '<script>!boost</script>';
  assert.equal(parseTwitchChatMessage(event)?.color, '#a78bfa');
  assert.equal(parseTwitchChatMessage(event)?.text, '<script>!boost</script>');
});

test('OAuth asks only for chat read permission with state and an encoded redirect', () => {
  const url = new URL(createTwitchAuthorizationUrl('client-123', 'http://localhost:5173/', 'random-state-at-least-16'));
  assert.equal(url.searchParams.get('scope'), 'user:read:chat');
  assert.equal(url.searchParams.get('response_type'), 'token');
  assert.equal(url.searchParams.get('state'), 'random-state-at-least-16');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:5173/');
  assert.throws(() => createTwitchAuthorizationUrl('client-123', 'https://example.com', 'short'));
  assert.throws(() => createTwitchAuthorizationUrl('client-123', 'http://example.com', 'random-state-at-least-16'));
});

test('rejects wrong client IDs and tokens without chat permission before opening a socket', async () => {
  let opened = false;
  const makeClient = (payload: object) => new TwitchChatClient({ onStatus() {}, onMessage() {} }, {
    fetch: (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch,
    createSocket: () => { opened = true; throw new Error('must not open'); },
  });
  await assert.rejects(makeClient({ client_id: 'other', user_id: '42', scopes: ['user:read:chat'], expires_in: 3600 }).connect({ clientId: 'client', accessToken: 'token', channel: 'pilot' }), /different app/);
  await assert.rejects(makeClient({ client_id: 'client', user_id: '42', scopes: [], expires_in: 3600 }).connect({ clientId: 'client', accessToken: 'token', channel: 'pilot' }), /user:read:chat/);
  assert.equal(opened, false);
});

class FakeSocket {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  close() { this.closed = true; this.onclose?.(); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent); }
}

test('subscribes after welcome, deduplicates chat and transfers a reconnect without resubscribing', async () => {
  const sockets: FakeSocket[] = [];
  const messages: string[] = [];
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = new TwitchChatClient({ onStatus() {}, onMessage: (message) => messages.push(message.id) }, {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); requests.push({ url, init });
      const payload = url.includes('/validate') ? { client_id: 'client', user_id: '42', scopes: ['user:read:chat'], expires_in: 3600 } : url.includes('/users?') ? { data: [{ id: '777' }] } : { data: [{ id: 'sub-1' }] };
      return new Response(JSON.stringify(payload), { status: url.includes('/subscriptions') ? 202 : 200 });
    }) as typeof fetch,
    createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket; },
  });
  const connected = client.connect({ clientId: 'client', accessToken: 'token', channel: '#Pilot' });
  try {
    // Token validation and broadcaster lookup each contain response.json awaits.
    while (!sockets.length) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.some((request) => request.url.includes('/subscriptions')), false);
    sockets[0].receive({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'session-1', keepalive_timeout_seconds: 30 } } });
    await connected;
    const subscription = requests.find((request) => request.url.includes('/subscriptions'))!;
    assert.deepEqual(JSON.parse(String(subscription.init?.body)).condition, { broadcaster_user_id: '777', user_id: '42' });
    sockets[0].receive(chatEvent); sockets[0].receive(chatEvent);
    assert.deepEqual(messages, ['msg-1']);
    sockets[0].receive({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=abc' } } });
    assert.equal(sockets.length, 2);
    assert.equal(sockets[0].closed, false);
    sockets[1].receive({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'session-2', keepalive_timeout_seconds: 30 } } });
    assert.equal(sockets[0].closed, true);
    assert.equal(requests.filter((request) => request.url.includes('/subscriptions')).length, 1);
  } finally { client.disconnect(); }
  assert.ok(sockets.every((socket) => socket.closed));
});

test('a rejected subscription rejects connect and leaves no active socket', async () => {
  let socket: FakeSocket | undefined;
  const states: string[] = [];
  const client = new TwitchChatClient({ onStatus: (status) => states.push(status.state), onMessage() {} }, {
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes('/validate') ? { client_id: 'client', user_id: '42', scopes: ['user:read:chat'], expires_in: 3600 } : url.includes('/users?') ? { data: [{ id: '777' }] } : { message: 'subscription missing proper authorization' };
      return new Response(JSON.stringify(payload), { status: url.includes('/subscriptions') ? 403 : 200 });
    }) as typeof fetch,
    createSocket: () => { socket = new FakeSocket(); return socket as unknown as WebSocket; },
  });
  const connected = client.connect({ clientId: 'client', accessToken: 'token', channel: 'pilot' });
  const rejection = assert.rejects(connected, /denied chat access/);
  while (!socket) await new Promise((resolve) => setImmediate(resolve));
  socket.receive({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'session-1', keepalive_timeout_seconds: 30 } } });
  await rejection;
  assert.equal(socket.closed, true);
  assert.equal(states.at(-1), 'error');
  assert.equal(states.includes('connected'), false);
  client.disconnect();
});

test('consecutive socket failures stop after five retries and reject pending connect', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets: FakeSocket[] = [];
  const states: string[] = [];
  const client = new TwitchChatClient({ onStatus: (status) => states.push(status.state), onMessage() {} }, {
    fetch: (async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).includes('/validate')
      ? { client_id: 'client', user_id: '42', scopes: ['user:read:chat'], expires_in: 3600 }
      : { data: [{ id: '777' }] }), { status: 200 })) as typeof fetch,
    createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket; },
  });
  const connected = client.connect({ clientId: 'client', accessToken: 'token', channel: 'pilot' });
  const rejection = assert.rejects(connected, /connection was lost/);
  while (!sockets.length) await new Promise((resolve) => setImmediate(resolve));
  sockets[0].close();
  for (const delay of [1000, 2000, 4000, 8000, 16000]) {
    context.mock.timers.tick(delay);
    sockets.at(-1)!.close();
  }
  await rejection;
  assert.equal(sockets.length, 6);
  assert.equal(states.at(-1), 'error');
  context.mock.timers.tick(1_000_000);
  assert.equal(sockets.length, 6);
  assert.ok(sockets.every((socket) => socket.closed));
  client.disconnect();
});

test('disconnect while validating cancels the old connection without opening a socket', async () => {
  let deliver: (response: Response) => void = () => {};
  let opened = false;
  const client = new TwitchChatClient({ onStatus() {}, onMessage() {} }, {
    fetch: (() => new Promise<Response>((resolve) => { deliver = resolve; })) as typeof fetch,
    createSocket: () => { opened = true; throw new Error('must not open'); },
  });
  const connected = client.connect({ clientId: 'client', accessToken: 'token', channel: 'pilot' });
  client.disconnect();
  deliver(new Response(JSON.stringify({ client_id: 'client', user_id: '42', scopes: ['user:read:chat'], expires_in: 3600 }), { status: 200 }));
  await connected;
  assert.equal(opened, false);
});
