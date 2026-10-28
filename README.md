# Raid Relay

**Your chat is your crew.** Raid Relay turns a Twitch stream into a cooperative space expedition. Viewers vote to scan, shield, or boost; the winning command steers the ship through six dangerous sectors.

Play the demo without a Twitch account, or connect your channel for a live mission.

## Run locally

Use Node.js 22.12 or newer.

From the hackathon workspace:

```sh
cd raid-relay
npm install
npm run dev
```

If your terminal is already in `raid-relay`, omit the first command.

Open the local URL printed by Vite. To check and build the project:

On Windows, you can also double-click `start-local.cmd`. It uses Node from your PATH or the workspace-local toolchain provisioned during this build.

```sh
npm test
npm run build
npm run preview
```

The production build is a static site in `dist/`. No application server or client secret is required.

## How to play

1. Start a mission in demo mode, or connect Twitch before starting a live mission.
2. Inspect the current sector and the ship's hull, shield, and energy.
3. Vote with `!scan`, `!shield`, or `!boost`.
4. When the round ends, the winning action resolves the encounter. Reach the end of all six sectors before the hull runs out.

Each viewer has one vote per round. Sending another valid command changes that viewer's vote. Demo chat is simulated and is labeled in the app; it is separate from real Twitch messages.

## Connect Twitch

Raid Relay reads chat through Twitch EventSub WebSockets. It does not post messages.

1. Register an application in the [Twitch developer console](https://dev.twitch.tv/console/apps). Copy its client ID. **Do not paste a client secret into Raid Relay.**
2. Click **Connect Twitch** in Raid Relay. Enter your channel and application client ID.
3. Copy the exact OAuth redirect URL shown in the connection panel into your Twitch application settings. It is this page's origin and pathname, usually with a trailing `/`. Use the displayed value exactly, including the port for local development. Add the deployed URL separately when you switch to a hosted site.
4. Click **Authorize with Twitch**. Twitch asks for the `user:read:chat` permission and returns to Raid Relay in the same tab. Authenticate as the broadcaster for the simplest setup.
5. The returned token fills the access-token field. Click **Connect crew**, then **Launch mission**. Send `!scan`, `!shield`, or `!boost` from Twitch chat to vote.

You can also paste a user access token you obtained yourself through Twitch's [browser OAuth flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#implicit-grant-flow). It must include `user:read:chat` and have been issued for the same client ID you entered.

Access tokens stay in application memory. Refreshing or closing the page clears the connection; reconnect when you return. Never commit a token, include one in an overlay URL, or expose one on stream.

See the [Twitch EventSub WebSocket guide](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/) and [chat message subscription reference](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage) for Twitch's current authorization requirements.

## Put the mission on stream

Click **Stream overlay**, then **Open overlay window**. Keep the control desk open. The generated overlay URL includes the room identifier that links these two windows; use **Copy overlay URL** from the same dialog if you need to reopen it manually.

In OBS, add a **Window Capture** source and select the overlay window. The control desk and overlay share mission state through `BroadcastChannel` at the same origin in the same browser profile.

An OBS Browser Source uses its own browser context and does not receive the control desk's updates. Use Window Capture for this overlay. If the overlay says it is waiting for the control desk, reopen it through **Stream overlay** in the browser profile where your desk is running.

## Project structure

```text
src/
  App.tsx           Control desk, authorization, and synchronized overlay
  styles.css        Responsive interface and overlay styles
  main.tsx          React entry point
  lib/game.ts       Pure mission rules, vote counting, and encounter resolution
  lib/twitch.ts     Read-only Twitch chat connection
docs/demo-script.md  A short walkthrough for recording a demo
```

## Built with Codex

Codex helped design the concept, implement the game and Twitch connection, build the interface, and write verification tests. The project does not require an OpenAI API key at runtime.

For a submission, record the actual Codex thread/session ID from the build session and replace any placeholders in your own materials. This repository does not invent a session ID or claim that a Devpost entry has been submitted.

Live Twitch behavior requires a valid Twitch application and user token. Automated tests and demo playback are not a substitute for a live channel check before recording your final demo.
