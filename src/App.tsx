import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleHelp, Copy, Crosshair, ExternalLink, Flag, Flame, Heart, Layers3, Maximize2, MessageCircle, Orbit, Pause, Play, Radio, RefreshCw, Rocket, Send, Shield, Sparkles, Terminal, Trophy, Twitch, Users, Volume2, X, Zap } from 'lucide-react';
import { ACTIONS, ACTION_DETAILS, SECTORS, castVote, createGame, getRoundRemainingMs, getVoteCounts, parseCommand, pauseGame, resolveRound, resumeGame, startGame, tickGame, type Action, type GameState } from './lib/game';
import { TwitchChatClient, createTwitchAuthorizationUrl, type TwitchConnectionStatus } from './lib/twitch';

type ChatLine = { id: string; user: string; text: string; color: string; source: 'demo' | 'twitch' | 'local' };
type Modal = 'connect' | 'guide' | 'overlay' | null;
const ACTION_ICONS = { scan: Crosshair, shield: Shield, boost: Zap };
const CREW = ['cosmicfern', 'lunar_latte', 'pixelpilot', 'orbit_owl', 'tinyasteroid', 'mossy_moon', 'starrybyte', 'thevoidcat', 'nova_noodle', 'astrobee', 'velvetcomet', 'cloud_rider'];
const COLORS = ['#b9f56b', '#b8a1ff', '#ffb681', '#79d5cd', '#dca4d0'];
const storage = { get(key: string) { try { return sessionStorage.getItem(key) ?? ''; } catch { return ''; } }, set(key: string, value: string) { try { sessionStorage.setItem(key, value); } catch { /* Optional browser storage. */ } }, remove(key: string) { try { sessionStorage.removeItem(key); } catch { /* Optional browser storage. */ } } };
function oauthResult() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  // Successful implicit authorization uses the fragment; denial uses the query.
  const response = hash.has('access_token') || hash.has('error') ? hash : query.has('error') ? query : null;
  if (!response) return { token: '', error: '' };
  const expected = storage.get('raid-relay.oauth-state');
  const valid = expected && response.get('state') === expected;
  const token = valid && !response.has('error') ? response.get('access_token') ?? '' : '';
  const error = valid ? response.get('error_description') || (response.has('error') ? 'Twitch authorization was declined. You can authorize again or paste a token.' : '') : 'Authorization could not be verified. Please authorize again from this window.';
  storage.remove('raid-relay.oauth-state');
  if (response === query) for (const key of ['error', 'error_description', 'state']) query.delete(key);
  const cleanQuery = query.toString();
  history.replaceState(null, '', location.pathname + (cleanQuery ? `?${cleanQuery}` : ''));
  return { token, error };
}
const OAUTH = oauthResult();
const PARAMS = new URLSearchParams(location.search);
const IS_OVERLAY = PARAMS.get('overlay') === '1';
const ROOM = (PARAMS.get('room') || storage.get('raid-relay.room') || crypto.randomUUID()).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 60);
storage.set('raid-relay.room', ROOM);

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={'brand ' + (compact ? 'compact' : '')}><span className="brand-symbol"><Rocket size={22} strokeWidth={2.2} /></span>{!compact && <span>raid<span className="brand-light">relay</span><sup>™</sup></span>}</div>;
}

function SpaceScene({ game }: { game: GameState }) {
  const active = game.phase === 'running';
  const shipX = 150 + game.sectorIndex * 81;
  const shipY = 212 - Math.sin(game.sectorIndex * .85) * 44;
  return <svg className={'space-scene ' + (active ? 'flying' : '')} viewBox="0 0 780 400" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Expedition spaceship approaching ${SECTORS[game.sectorIndex].name}`}>
    <defs>
      <radialGradient id="nebula"><stop stopColor="#30423b" stopOpacity=".6"/><stop offset="1" stopColor="#101a1b" stopOpacity="0"/></radialGradient>
      <radialGradient id="planet" cx=".25" cy=".2"><stop stopColor="#9bba86"/><stop offset=".45" stopColor="#526c51"/><stop offset=".8" stopColor="#263c35"/><stop offset="1" stopColor="#182929"/></radialGradient>
      <linearGradient id="ship" x2="1" y2="1"><stop stopColor="#fafce9"/><stop offset="1" stopColor="#a9b6a4"/></linearGradient>
      <linearGradient id="trail"><stop stopColor="#b9f56b" stopOpacity="0"/><stop offset="1" stopColor="#c4ff81" stopOpacity=".8"/></linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="4"/></filter>
      <clipPath id="planet-clip"><circle cx="615" cy="335" r="125"/></clipPath>
    </defs>
    <rect width="780" height="400" fill="#111c1e"/>
    <ellipse cx="390" cy="180" rx="440" ry="270" fill="url(#nebula)"/>
    {Array.from({ length: 100 }, (_, i) => <circle key={i} className={i % 11 === 0 ? 'twinkle' : ''} cx={(i * 137.7 + 23) % 780} cy={(i * 87.3 + 17) % 400} r={i % 9 === 0 ? 1.3 : .65} fill={i % 4 === 0 ? '#c0d4b3' : '#a4bbbe'} opacity={.15 + (i % 5) * .14} style={{ animationDelay: `${i % 7}s` }}/>) }
    <g opacity=".17" stroke="#97b7a3" fill="none"><ellipse cx="590" cy="335" rx="310" ry="200" transform="rotate(-24 590 335)"/><ellipse cx="590" cy="335" rx="365" ry="245" transform="rotate(-24 590 335)"/><path d="M0 320 780 63M0 370 780 113" strokeDasharray="2 9"/></g>
    <circle cx="615" cy="335" r="132" fill="#708c65" opacity=".06"/>
    <circle cx="615" cy="335" r="125" fill="url(#planet)"/>
    <g clipPath="url(#planet-clip)" fill="none" stroke="#b6c6a1" opacity=".09" strokeWidth="14"><path d="M450 270q90 55 210-32t130 50M440 315q100 55 240-27t130 50M450 360q100 55 260-27t130 50"/></g>
    <ellipse cx="615" cy="335" rx="180" ry="34" transform="rotate(-24 615 335)" fill="none" stroke="#809177" strokeWidth="1" opacity=".32"/>
    <g fill="#536460" opacity=".7"><path d="m85 155 10-7 10 8-4 13-14 1-6-8Z"/><path d="m325 90 7-4 8 4 2 9-8 6-10-5Z"/><path d="m410 279 12-8 10 10-3 11-13 4-9-8Z"/><path d="m570 111 6-6 9 1 4 9-10 7-9-3Z"/></g>
    <path d="M68 260 Q250 95 420 192 T726 144" fill="none" stroke="#b9f56b" opacity=".24" strokeWidth="1.3" strokeDasharray="4 7"/>
    {[0, 1, 2, 3, 4, 5].map((i) => <g key={i} transform={`translate(${150 + i * 81},${212 - Math.sin(i * .85) * 44})`}><circle r={i === game.sectorIndex ? 20 : 5} fill={i === game.sectorIndex ? 'none' : i < game.sectorIndex ? '#b9f56b' : '#293e3b'} stroke={i <= game.sectorIndex ? '#b9f56b' : '#60756e'} opacity={i === game.sectorIndex ? .3 : .9}/>{i < game.sectorIndex && <path d="m-2 0 1.5 1.5 3-3" stroke="#18231e" fill="none" strokeWidth="1.6"/>}</g>)}
    <g className="ship-position" style={{ transform: `translate(${shipX}px,${shipY}px)` }}><g className="ship-float" transform="rotate(-20)">
      <path className="engine-trail" d="M-9 6-106 25-105 30-9 16Z" fill="url(#trail)"/>
      <ellipse cx="-17" cy="11" rx="16" ry="5" fill="#c4ff81" opacity=".7" filter="url(#glow)"/>
      <path d="m-31 19 33-51 53 19-38 18-16 27-4-18Z" fill="url(#ship)" stroke="#dce5d1" strokeWidth="1"/>
      <path d="M2-32 9-10 55-13 17 5 1 32l-4-18 12-24Z" fill="#6f8677"/>
      <path d="m2-24 8 15 30-3-19-7Z" fill="#192e30"/>
      <path d="m6-19 6 6 16-1-10-4Z" fill="#b9f56b" opacity=".9"/>
      <path d="m-24 16 13-1-4 9-12 1Z" fill="#dae7c4"/>
    </g></g>
    <g fill="#7f968d" fontFamily="monospace" fontSize="8" letterSpacing="2"><text x="28" y="342">DEEP SPACE / RELAY SEVEN</text><text x="28" y="357" opacity=".6">034.28° N · 018.91° E</text></g>
  </svg>;
}

function ModalShell({ title, label, children, onClose }: { title: string; label: string; children: ReactNode; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => { dialog?.close(); }; }, []);
  return <dialog ref={dialogRef} className="modal" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-top"><span className="eyebrow">{label}</span><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19}/></button></div><h2>{title}</h2>{children}</dialog>;
}

export default function App() {
  const [game, setGame] = useState(() => createGame());
  const [now, setNow] = useState(Date.now());
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const [modal, setModal] = useState<Modal>(OAUTH.token || OAUTH.error ? 'connect' : null);
  const [status, setStatus] = useState<TwitchConnectionStatus>({ state: 'disconnected', message: 'Twitch is not connected.' });
  const [clientId, setClientId] = useState(storage.get('raid-relay.client-id'));
  const [channel, setChannel] = useState(storage.get('raid-relay.channel'));
  const [token, setToken] = useState(OAUTH.token);
  const [connectionError, setConnectionError] = useState(OAUTH.error);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [nav, setNav] = useState('mission');
  const [lastSnapshot, setLastSnapshot] = useState(0);
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem('raid-relay.best')) || 0; } catch { return 0; } });
  const chatEnd = useRef<HTMLDivElement>(null);
  const current = useRef(game); current.current = game;
  const broadcast = useRef<BroadcastChannel | null>(null);
  const twitchClient = useRef<TwitchChatClient | null>(null);
  const connectionAttempt = useRef(0);
  const connectionEstablished = useRef(false);
  const sequence = useRef(0);
  const sector = SECTORS[game.sectorIndex];
  const counts = getVoteCounts(game);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const remaining = Math.ceil(getRoundRemainingMs(game, now) / 1000);
  const crewCount = Object.keys(game.participants).length;
  const finished = game.phase === 'won' || game.phase === 'lost';
  const liveConnected = connectionEstablished.current && (status.state === 'connected' || status.state === 'reconnecting');
  const connecting = !liveConnected && (status.state === 'connecting' || status.state === 'reconnecting');
  const selectedVote = game.votes['local-you']?.action;
  const overlayUrl = `${location.origin}${location.pathname}?overlay=1&room=${ROOM}`;

  function addChat(line: ChatLine) { setChat(lines => [...lines, line].slice(-70)); }
  function toast(message: string) { setNotice(message); }
  function reset(mode = game.mode) { setGame(createGame({ mode })); setChat([]); sequence.current = 0; }
  function localVote(action: Action) {
    if (game.phase !== 'running' || game.mode !== 'demo') return;
    setGame(s => castVote(s, { userId: 'local-you', displayName: 'you', action, source: 'local' }));
    addChat({ id: crypto.randomUUID(), user: 'you', text: `!${action}`, color: '#b9f56b', source: 'local' });
  }

  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()); if (!IS_OVERLAY) setGame(s => tickGame(s)); }, 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (IS_OVERLAY || game.mode !== 'demo' || game.phase !== 'running') return;
    const timer = setInterval(() => {
      const state = current.current;
      const index = sequence.current++;
      const crewIndex = index % CREW.length;
      const action = index % 5 < 3 ? SECTORS[state.sectorIndex].recommendedAction : ACTIONS[index % 3];
      setGame(s => castVote(s, { userId: `demo-${crewIndex}`, displayName: CREW[crewIndex], action, source: 'demo' }));
      addChat({ id: crypto.randomUUID(), user: CREW[crewIndex], text: `!${action}`, color: COLORS[crewIndex % COLORS.length], source: 'demo' });
    }, 1400);
    return () => clearInterval(timer);
  }, [game.mode, game.phase]);
  useEffect(() => {
    const feed = chatEnd.current?.parentElement;
    feed?.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
  }, [chat]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!finished || IS_OVERLAY) return;
    if (game.score > best) { setBest(game.score); try { localStorage.setItem('raid-relay.best', String(game.score)); } catch { /* Score history is optional. */ } }
  }, [finished, game.score, best]);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bus = new BroadcastChannel(`raid-relay-${ROOM}`);
    broadcast.current = bus;
    bus.onmessage = event => {
      if (!IS_OVERLAY && event.data?.type === 'request') bus.postMessage({ type: 'snapshot', game: current.current });
      if (IS_OVERLAY && event.data?.type === 'snapshot' && event.data.game?.roundDurationMs && Array.isArray(event.data.game?.log)) { setGame(event.data.game); setLastSnapshot(Date.now()); }
    };
    bus.postMessage({ type: 'request' });
    const timer = !IS_OVERLAY ? setInterval(() => bus.postMessage({ type: 'snapshot', game: current.current }), 1000) : null;
    return () => { if (timer) clearInterval(timer); bus.close(); broadcast.current = null; };
  }, []);
  useEffect(() => { if (!IS_OVERLAY) broadcast.current?.postMessage({ type: 'snapshot', game }); }, [game]);
  useEffect(() => {
    if (IS_OVERLAY) return;
    const client = new TwitchChatClient({
      onStatus: next => {
        if (next.state === 'connected') connectionEstablished.current = true;
        if (next.state === 'disconnected' || next.state === 'error') {
          connectionEstablished.current = false;
          setGame(s => s.mode === 'live' && s.phase === 'running' ? pauseGame(s) : s);
        }
        setStatus(next);
        if (next.state === 'error') setConnectionError(next.message);
      },
      onMessage: message => {
        addChat({ id: message.id, user: message.user, text: message.text, color: message.color || '#b8a1ff', source: 'twitch' });
        const action = parseCommand(message.text);
        if (action) setGame(s => s.mode === 'live' ? castVote(s, { userId: message.userId, displayName: message.user, action, source: 'twitch' }) : s);
      },
    });
    twitchClient.current = client;
    return () => { connectionAttempt.current += 1; client.disconnect(); twitchClient.current = null; };
  }, []);

  async function connect(e: FormEvent) {
    e.preventDefault(); setConnectionError('');
    const client = twitchClient.current;
    if (!client) { setConnectionError('Chat is not ready yet. Please try connecting again.'); return; }
    const attempt = ++connectionAttempt.current;
    try {
      await client.connect({ clientId, accessToken: token, channel });
      if (attempt !== connectionAttempt.current || !connectionEstablished.current) return;
      setToken(''); reset('live'); setModal(null); toast(`Connected to #${channel}. Launch when your crew is ready.`);
    } catch (error) { if (attempt === connectionAttempt.current) setConnectionError(error instanceof Error ? error.message : 'Could not connect to Twitch.'); }
  }
  function closeConnect() {
    setModal(null); setToken('');
    if (!connectionEstablished.current) { connectionAttempt.current += 1; twitchClient.current?.disconnect(); }
  }
  function disconnectTwitch() {
    connectionAttempt.current += 1;
    twitchClient.current?.disconnect(); reset('demo'); setToken(''); setModal(null);
  }
  function authorize() {
    if (!clientId.trim()) { setConnectionError('Enter your Twitch application client ID first.'); return; }
    try {
      const state = crypto.randomUUID();
      const url = createTwitchAuthorizationUrl(clientId.trim(), `${location.origin}${location.pathname}`, state);
      storage.set('raid-relay.oauth-state', state); storage.set('raid-relay.client-id', clientId.trim()); storage.set('raid-relay.channel', channel.trim());
      if (storage.get('raid-relay.oauth-state') !== state) throw new Error('Enable session storage to verify authorization, or paste a user access token instead.');
      location.assign(url);
    } catch (error) { setConnectionError(error instanceof Error ? error.message : 'Could not start Twitch authorization. Please try again.'); }
  }
  async function copyOverlay() {
    try { await navigator.clipboard.writeText(overlayUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { toast('Copy the overlay address from the field below.'); }
  }
  function openOverlay() {
    const popup = window.open(overlayUrl, 'raid-relay-overlay', 'popup,width=1100,height=700');
    if (!popup) { toast('Allow pop-ups to open the overlay, or copy its address.'); setModal('overlay'); }
  }
  function primaryControl() {
    if (finished) { reset(); return; }
    if (game.phase === 'idle') setGame(s => startGame(s));
    else if (game.phase === 'running') setGame(s => pauseGame(s));
    else setGame(s => resumeGame(s));
  }

  const mission = <section className={'mission-panel panel ' + (IS_OVERLAY ? 'overlay-mission' : '')} aria-label="Current expedition">
    <SpaceScene game={game}/>
    <div className="scene-grain"/>
    <div className="scene-top"><div className="scene-sector"><span className="scene-label"><span className="tiny-cross">+</span> CURRENT SECTOR</span><h2>{sector.name}</h2><span className="hazard-label"><span className="hazard-dot"/>{sector.hazard}</span></div><div className="sector-number"><span>{String(game.sectorIndex + 1).padStart(2, '0')}</span><i>/ 06</i></div></div>
    <div className="scene-bottom"><div className="mission-prompt"><span className="eyebrow">{finished ? 'EXPEDITION COMPLETE' : game.phase === 'idle' ? 'ALL SYSTEMS READY' : game.phase === 'paused' ? 'HOLDING POSITION' : 'THE CREW DECIDES'}</span><h3>{game.phase === 'won' ? 'One crew. All the way home.' : game.phase === 'lost' ? 'Every great crew tries again.' : game.phase === 'idle' ? 'A little ship. A big adventure.' : game.phase === 'paused' ? 'Take a breath, captain.' : sector.description}</h3><p>{finished ? `${game.score.toLocaleString()} points · ${game.stats.perfectRoutes} perfect routes` : game.phase === 'idle' ? 'Launch the mission. Let your community take the wheel.' : game.phase === 'paused' ? 'Voting resumes when you do.' : 'Type a command in chat. The most votes sets our course.'}</p></div><div className={'round-clock ' + (remaining <= 5 && game.phase === 'running' ? 'urgent' : '')}><svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="31"/><circle cx="36" cy="36" r="31" strokeDasharray="195" strokeDashoffset={195 * (1 - remaining / (game.roundDurationMs / 1000))}/></svg><strong>{finished ? <Flag size={22}/> : `${remaining}s`}</strong><small>{finished ? 'FINISHED' : 'VOTE ENDS'}</small></div></div>
    <div className="sector-track">{SECTORS.map((s, i) => <div title={s.name} className={i < game.sectorIndex || game.phase === 'won' ? 'completed' : i === game.sectorIndex ? 'current' : ''} key={s.id}><span>{i < game.sectorIndex || game.phase === 'won' ? <Check size={10}/> : String(i + 1).padStart(2, '0')}</span><i/></div>)}</div>
  </section>;

  if (IS_OVERLAY) return <main className="overlay-root"><header><Brand/><span className="badge"><span className="status-dot"/>{game.mode === 'demo' ? 'SIMULATED CREW' : 'TWITCH CREW'}</span></header>{mission}<div className="overlay-votes">{ACTIONS.map(action => { const Icon = ACTION_ICONS[action]; return <div key={action}><Icon size={24}/><strong>!{action}</strong><span>{counts[action]} votes</span></div>; })}</div><div className="overlay-resources"><span>HULL <b>{game.hull}%</b></span><span>SHIELDS <b>{game.shield}%</b></span><span>ENERGY <b>{game.energy}%</b></span><span>SCORE <b>{game.score.toLocaleString()}</b></span></div>{now - lastSnapshot > 6000 && <p className="overlay-waiting">{lastSnapshot ? 'Control desk disconnected. Reopen it to continue.' : 'Waiting for the control desk. Open this overlay from Raid Relay in the same browser profile.'}</p>}</main>;

  return <div className="app-shell">
    <aside className="sidebar"><a href="#" aria-label="Raid Relay home"><Brand compact/></a><div className="nav-stack"><button title="Mission control" aria-label="Mission control" className={nav === 'mission' ? 'active' : ''} onClick={() => { setNav('mission'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Orbit size={21}/></button><button title="Crew decisions" aria-label="Crew decisions" className={nav === 'crew' ? 'active' : ''} onClick={() => { setNav('crew'); document.getElementById('crew-decisions')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}><Users size={21}/></button><button title="Flight log" aria-label="Flight log" className={nav === 'log' ? 'active' : ''} onClick={() => { setNav('log'); document.getElementById('flight-log')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}><Layers3 size={20}/></button></div><div className="sidebar-bottom"><button title="How to play" aria-label="How to play" onClick={() => setModal('guide')}><CircleHelp size={21}/></button><div className="captain-avatar">C<span/></div></div></aside>
    <div className="app-content">
      <header className="topbar"><Brand/><div className="topbar-separator"/><span className="topbar-label">Mission control</span><div className="topbar-right"><span className="mode-indicator"><span className={'status-dot ' + (game.mode === 'live' ? 'purple' : '')}/>{game.mode === 'demo' ? 'Demo mode' : `#${status.channel || channel}`}</span><a className="github-link" href="https://dev.twitch.tv/docs/chat/" target="_blank" rel="noreferrer">Built for community <ArrowUpRight size={13}/></a></div></header>
      <main className="main-content">
        <div className="page-intro"><div><div className="eyebrow intro-eyebrow">A SHARED ADVENTURE, ONE COMMAND AT A TIME</div><h1>Your chat. <span>Your crew.</span><span className="heading-star">✳</span></h1><p>One ship. A thousand copilots. See how far you go together.</p></div><div className="intro-actions"><button className="button secondary" onClick={() => setModal('guide')}><CircleHelp size={16}/>How to play</button><button className={'button twitch-button ' + (liveConnected ? 'connected' : '')} onClick={() => setModal('connect')}><Twitch size={17}/>{liveConnected ? 'Twitch connected' : 'Connect Twitch'}<ArrowUpRight size={15}/></button></div></div>
        <section className="telemetry" aria-label="Ship telemetry"><div className="telemetry-item"><span className="metric-icon mint"><Heart size={18}/></span><div><span className="metric-label">SHIP HULL</span><div className="metric-value">{game.hull}<small>%</small><span className="metric-note">{game.hull > 60 ? 'Looking good' : game.hull > 25 ? 'Holding on' : 'Critical'}</span></div></div><div className="mini-bars">{Array.from({ length: 12 }, (_, i) => <i className={i < game.hull / 100 * 12 ? 'lit' : ''} key={i}/>)}</div></div><div className="telemetry-item"><span className="metric-icon purple"><Shield size={18}/></span><div><span className="metric-label">SHIELDS</span><div className="metric-value">{game.shield}<small>%</small></div></div><div className="sparkline"><svg viewBox="0 0 70 25"><path d={`M0 24 L10 18 L20 21 L30 11 L40 15 L50 7 L60 11 L70 ${25 - game.shield / 5}`}/></svg></div></div><div className="telemetry-item"><span className="metric-icon peach"><Zap size={18}/></span><div><span className="metric-label">ENERGY</span><div className="metric-value">{game.energy}<small>%</small><span className="metric-note">{game.energy >= 18 ? 'Engines ready' : 'Scan to recover'}</span></div></div></div><div className="telemetry-item"><span className="metric-icon blue"><Users size={18}/></span><div><span className="metric-label">ACTIVE CREW</span><div className="metric-value">{crewCount}<small className="crew-unit">{game.mode === 'demo' ? 'simulated + you' : 'viewers'}</small></div></div><div className="crew-dots">{[0, 1, 2].map(i => <span key={i} style={{ background: COLORS[i] }}>{['P', 'L', 'C'][i]}</span>)}</div></div></section>
        <div className="section-heading"><h2><span className="section-pip"/>The expedition <span className="subtle-badge">SEASON 01</span></h2><button className="text-button" onClick={() => setModal('overlay')}><Maximize2 size={14}/>Stream overlay<ArrowUpRight size={13}/></button></div>
        <div className="mission-grid"><div className="mission-column">{mission}<div className="mission-controls"><div className="mission-status"><span className={'status-dot ' + (game.phase === 'paused' ? 'amber' : '')}/><span>{game.phase === 'idle' ? 'Waiting for your go, captain' : game.phase === 'running' ? 'Mission in progress' : game.phase === 'paused' ? 'Mission paused' : game.phase === 'won' ? 'Mission accomplished' : 'Expedition ended'}</span><span className="control-divider"/><span className="mono">{game.score.toLocaleString()} PTS</span></div><div className="control-buttons"><button className="icon-button" title="Reset expedition" aria-label="Reset expedition" onClick={() => reset()} disabled={game.phase === 'idle'}><RefreshCw size={15}/></button>{game.phase === 'running' && <button className="resolve-button" onClick={() => setGame(s => resolveRound(s))}>Resolve now <ChevronRight size={13}/></button>}<button className={'button launch-button ' + (game.phase === 'running' ? 'pause-button' : '')} onClick={primaryControl} disabled={game.mode === 'live' && !liveConnected && game.phase !== 'running' && !finished}>{game.phase === 'running' ? <Pause size={14}/> : <Play size={14} fill="currentColor"/>}{finished ? 'New expedition' : game.phase === 'idle' ? 'Launch mission' : game.phase === 'running' ? 'Pause' : 'Resume'}</button></div></div></div>
          <aside className="chat-panel panel"><div className="panel-heading"><h2><MessageCircle size={16}/>Crew comms</h2><span className="chat-count">{chat.length}</span></div><div className="chat-source"><span className={'status-dot ' + (game.mode === 'live' ? 'purple' : '')}/>{game.mode === 'demo' ? 'SIMULATED CHAT' : status.state === 'connected' ? 'LIVE TWITCH CHAT' : status.state.toUpperCase()}<span>{game.mode === 'demo' ? 'demo' : `#${channel}`}</span></div><div className="chat-messages" role="log" aria-label="Crew chat">{!chat.length && <div className="chat-empty"><div className="empty-orbit"><MessageCircle size={23}/><span>✦</span></div><h3>The crew is on standby.</h3><p>{game.mode === 'demo' ? 'Launch a demo and watch your simulated crew chart a course.' : 'Viewers can vote once the mission launches. Their messages will appear here.'}</p></div>}{chat.map(line => <div className="chat-line" key={line.id}><span className="chat-user" style={{ color: line.color }}>{line.user}{line.source === 'local' && <span className="you-tag">YOU</span>}</span><span className={'chat-text ' + (parseCommand(line.text) ? 'command' : '')}>{line.text}</span></div>)}<div ref={chatEnd}/></div><div className="chat-bottom"><span className="comms-note"><Shield size={11}/>One viewer. One vote. Everyone matters.</span><form onSubmit={e => { e.preventDefault(); const action = parseCommand(draft); if (action) { localVote(action); setDraft(''); } else toast('Try !scan, !shield, or !boost. Launch the mission first.'); }}><input aria-label="Demo chat command" placeholder={game.mode === 'demo' ? 'Try !scan in the demo…' : 'Your crew votes in Twitch chat'} value={draft} onChange={e => setDraft(e.target.value)} disabled={game.mode !== 'demo' || game.phase !== 'running'} maxLength={100}/><button aria-label="Send demo vote" disabled={game.mode !== 'demo' || game.phase !== 'running'}><Send size={15}/></button></form></div></aside></div>
        <div className="decision-heading section-heading" id="crew-decisions"><h2>Crew, what’s the move? <span className="heading-hint">{game.phase === 'running' ? 'VOTING IS OPEN' : 'YOUR NEXT MOVE STARTS HERE'}</span></h2><span className="vote-total"><Users size={13}/>{total} {total === 1 ? 'vote' : 'votes'} this round</span></div>
        <section className="action-grid" aria-label="Crew voting options">{ACTIONS.map((action, i) => { const Icon = ACTION_ICONS[action]; const percent = total ? Math.round(counts[action] / total * 100) : 0; const leading = total > 0 && counts[action] === Math.max(...Object.values(counts)); return <button key={action} className={`action-card action-${action} ${selectedVote === action ? 'selected' : ''}`} onClick={() => localVote(action)} disabled={game.mode !== 'demo' || game.phase !== 'running'} aria-label={`Vote ${action}`} aria-pressed={selectedVote === action}><div className="action-top"><span className="action-icon"><Icon size={20}/></span><code>!{action}</code><span className="action-number">0{i + 1}</span></div><div className="action-title"><h3>{ACTION_DETAILS[action].label}</h3>{selectedVote === action ? <span className="your-vote"><Check size={10}/>YOUR VOTE</span> : leading ? <span className="leading">LEADING</span> : null}</div><p>{ACTION_DETAILS[action].description}</p><div className="action-votes"><span>{counts[action]} <small>{counts[action] === 1 ? 'vote' : 'votes'}</small></span><span>{percent}%</span></div><div className="vote-progress"><i style={{ width: `${percent}%` }}/></div></button>; })}</section>
        <p className="voting-footnote"><Terminal size={12}/>{game.mode === 'demo' ? 'Click a card or try a chat command. Demo votes are simulated; your vote counts too.' : 'Viewers type !scan, !shield, or !boost in Twitch chat. They can change their vote until the timer ends.'}<span><Zap size={11}/>Actions use energy</span></p>
        <section className="bottom-grid"><div className="flight-log panel" id="flight-log"><div className="panel-heading"><h2><Activity size={16}/>Flight log</h2><span className="eyebrow">LATEST TRANSMISSIONS</span></div><div className="log-list" aria-live="polite">{[...game.log].reverse().slice(0, 4).map(event => <div className={'log-line ' + event.tone} key={event.id}><span className="log-dot"/><time>{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</time><p>{event.message}</p>{event.type === 'outcome' && <ArrowUpRight size={13}/>}</div>)}</div></div><div className="captain-note panel"><div className="note-header"><Sparkles size={17}/><span>CAPTAIN’S NOTE</span></div><p>{game.lastOutcome ? game.lastOutcome.description : 'The best adventures aren’t played alone.'}</p><div className="personal-best"><Trophy size={14}/><span>Your best expedition</span><strong>{best.toLocaleString()}<small> PTS</small></strong></div></div></section>
        <footer><span><span className="footer-star">✳</span>Made for the moments between the gameplay.</span><span>Built with Codex <span>↗</span> Powered by your community</span></footer>
      </main>
    </div>
    {notice && <div className="toast" role="status"><Radio size={16}/>{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14}/></button></div>}
    {modal === 'guide' && <ModalShell title="A thousand copilots. One ship." label="WELCOME ABOARD" onClose={() => setModal(null)}><p className="modal-description">Your community is the crew. Together, they navigate six sectors of deep space by voting in chat.</p><div className="guide-steps"><div><span>01</span><div><h3>Launch an expedition</h3><p>Try the demo crew, or connect your Twitch channel for the real thing.</p></div></div><div><span>02</span><div><h3>Read the sector. Rally the crew.</h3><p>Debris needs a scan, storms need shields, and closing passages need a boost. Each action spends energy.</p></div></div><div><span>03</span><div><h3>One viewer. One vote.</h3><p>Type <code>!scan</code>, <code>!shield</code>, or <code>!boost</code>. Change your vote before time runs out. The leading command wins.</p></div></div></div><div className="info-box"><Shield size={18}/><p>Ties favor the safest route. If nobody votes, autopilot raises shields. Scan to recover energy. Get home with your hull intact.</p></div><button className="button launch-button full-width" onClick={() => setModal(null)}>Got it. Let’s fly.<ArrowRight size={15}/></button></ModalShell>}
    {modal === 'connect' && <ModalShell title="Bring your crew aboard." label="CONNECT TO TWITCH" onClose={closeConnect}><p className="modal-description">Read your channel’s chat and turn commands into decisions. Raid Relay only requests permission to read chat.</p>{liveConnected ? <><div className="connected-card"><span className="status-dot purple"/><div><strong>Connected to #{status.channel || channel}</strong><p>{status.message}</p></div></div><p className="small-copy">Disconnecting will pause this expedition and return you to a fresh demo.</p><button className="button secondary full-width" onClick={disconnectTwitch}>Disconnect Twitch</button></> : <form onSubmit={connect}><label>Twitch channel<input required value={channel} disabled={connecting} onChange={e => setChannel(e.target.value)} placeholder="your_channel" autoComplete="off" maxLength={25}/></label><label>Application client ID<input required value={clientId} disabled={connecting} onChange={e => setClientId(e.target.value)} placeholder="Your Twitch developer application’s public ID" autoComplete="off"/></label><div className="auth-row"><button type="button" className="button twitch-button" onClick={authorize} disabled={connecting}><Twitch size={16}/>Authorize with Twitch<ExternalLink size={13}/></button><span>Uses <code>user:read:chat</code></span></div><label>User access token <span className="label-optional">from authorization, or paste your own</span><input type="password" required value={token} disabled={connecting} onChange={e => setToken(e.target.value)} placeholder="Kept in memory for this connection" autoComplete="off" spellCheck={false}/></label>{connectionError && <p className="form-error" role="alert">{connectionError}</p>}<div className="info-box"><Shield size={17}/><p>Register an app in the <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">Twitch developer console</a>. Set its OAuth redirect URL to <code className="break-all">{location.origin}{location.pathname}</code>. Your client secret is never needed.</p></div><button className="button launch-button full-width" disabled={connecting}>{connecting ? 'Connecting…' : 'Connect crew'}<ArrowRight size={16}/></button><p className="privacy-note">Tokens stay in this tab’s memory. Refreshing disconnects Twitch.</p></form>}</ModalShell>}
    {modal === 'overlay' && <ModalShell title="Give your crew the big screen." label="STREAM OVERLAY" onClose={() => setModal(null)}><p className="modal-description">A clean mission view with live votes, ship stats, and the sector timer. It follows this control desk in the same browser profile.</p><div className="overlay-mini"><Rocket size={36}/><span>RAID RELAY</span><div><code>!scan</code><code>!shield</code><code>!boost</code></div></div><button className="button launch-button full-width" onClick={openOverlay}><Maximize2 size={16}/>Open overlay window<ArrowUpRight size={15}/></button><div className="copy-field"><input aria-label="Overlay URL" readOnly value={overlayUrl} onFocus={e => e.target.select()}/><button className="icon-button" aria-label="Copy overlay URL" onClick={copyOverlay}>{copied ? <Check size={16}/> : <Copy size={16}/>}</button></div><div className="info-box"><Volume2 size={18}/><p>In OBS, add a <strong>Window Capture</strong> source and select the overlay window. Keep this control desk open. OBS Browser Source uses a separate browser profile and will not receive this desk’s updates.</p></div></ModalShell>}
  </div>;
}
