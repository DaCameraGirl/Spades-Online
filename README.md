# RetroArcade Spades Online

A real-time 4-player Spades room starter built for online play from different locations.

**Play live:** [https://spades-online.onrender.com](https://spades-online.onrender.com)

## Features

- Create a room and share the code
- Join a room from another browser or machine
- 4 seats per table
- Stake selection for 250 / 500 / 1000 tables
- Basic Spades flow: deal, bid, nil, play cards, scoring
- Oval casino table with your seat on the south rail
- Trick cards play into the center of the felt
- 13-card fan along the bottom rail
- Bots play one card at a time so the trick stays visible
- Deal the next hand without wiping the score
- Socket-based multiplayer using Node.js + Socket.IO
- Table sounds and dealer calls (bidding, your lead, spades broken, hand complete)

## Run locally

```bash
npm install
npm start
```

If port 3000 is already in use, start on another port:

```bash
PORT=3001 npm start
```

Then open:

```text
http://localhost:3000
```

For solo testing, create a room as the host and start the table with one human player. The server fills the remaining seats with bots automatically.


## Desktop layout verification

The active table is designed as a fixed-height game client on desktop. It should fit without vertical gameplay scrolling at `1440x900`, `1366x768`, and `1280x720` CSS viewports.

With the local server running, verify the casino table layout with:

```bash
SMOKE_PORT=3025 npm run verify:ui
```

The script creates a room, starts a bot-filled table, checks bidding and play-ready states, and writes screenshots plus metrics to `tmp-ui/`.
## Play with people in another state

Use the live Render URL, not GitHub and not localhost:

**https://spades-online.onrender.com**

1. Open that link.
2. One person creates a room.
3. Hit **Copy invite link** and send that link (it will look like `https://spades-online.onrender.com/?room=ABCDE`).
4. Everyone else opens the invite, types their name if needed, and they land at the same table.
5. When the table is ready, the host starts the game. Empty seats fill with bots.

The first load after idle can take about a minute while Render wakes the free service.

## Next upgrade ideas

- sandbag tracking
- chat
- spectator mode
- reconnect logic
- room persistence
- custom table stakes and profiles
