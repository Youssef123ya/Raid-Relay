# Raid Relay demo script

Aim for a clear two-to-three-minute walkthrough. Record a working mission rather than a static tour.

## Before recording

- Start the app and check the connection before showing your screen.
- Click **Connect Twitch**, enter your channel and client ID, and use **Authorize with Twitch**. After returning, click **Connect crew**. Hide the connection panel before recording.
- Open Twitch chat in another window and arrange the control desk and overlay so both are visible when needed.
- Click **Stream overlay**, then **Open overlay window**. In OBS, use **Window Capture** for this window. Keep the control desk open in the same browser profile.
- Record a short piece of the real Codex build session. Note its actual thread/session ID separately.

## 0:00–0:20 — Show the idea

“Raid Relay makes Twitch chat the crew of a spaceship. The streamer launches a six-sector expedition, and viewers decide how the ship survives.”

Show the mission, ship resources, and the three commands: `!scan`, `!shield`, and `!boost`.

## 0:20–1:10 — Show real participation

Show the connected Twitch channel. Send a command in Twitch chat and show the matching vote arrive in Raid Relay. Send another command from the same viewer to demonstrate that a viewer can change their vote without voting twice.

“Every viewer gets one vote each round. When the timer runs out, the crew's winning action resolves the encounter.”

Let the round resolve. Show the encounter outcome and the resources changing. Keep the actual Twitch message and corresponding app response visible long enough to understand the connection.

## 1:10–1:45 — Show the streamer experience

Show how the streamer starts or pauses a mission, watches the vote distribution, and clicks **Stream overlay** → **Open overlay window**. Show the overlay captured in OBS.

“The desk keeps the streamer's controls handy. The overlay gives viewers the mission and the vote without covering the whole stream.”

If switching to the simulated demo for a later sector, say so explicitly and leave its demo indicator visible.

## 1:45–2:15 — Show how it was built

Show real footage from the Codex session: the game rules, the Twitch connection, and the tests being run.

“I used Codex to turn the idea into a playable app, implement the voting rules and EventSub connection, and test the mission logic.”

Describe only work that the visible session actually demonstrates. Do not substitute a fabricated transcript or generated session ID.

## 2:15–2:40 — Finish with the experience

Show an encounter resolving or a mission finishing.

“Three simple commands turn chat into a team. Raid Relay gives the community a shared goal and a reason to keep watching.”

Show the repository and app URLs on the final frame. Check that no tokens, client secrets, private tabs, or unrelated personal information appear in the recording.
