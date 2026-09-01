# RetroArcade Spades Online

A real-time 4-player Spades room starter built for online play from different locations.

## Features

- Create a room and share the code
- Join a room from another browser or machine
- 4 seats per table
- Stake selection for 250 / 500 / 1000 tables
- Basic Spades flow: deal, bid, play cards, scoring
- Oval casino table with your seat on the south rail
- Trick cards play into the center of the felt
- 13-card fan along the bottom rail
- Bots play one card at a time so the trick stays visible
- Deal the next hand without wiping the score
- Socket-based multiplayer using Node.js + Socket.IO

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

## Repo

https://github.com/DaCameraGirl/Spades-Online

## Play with people in another state

GitHub hosts the code. Localhost only works on your machine. Friends in another state need the **same live game URL**, then:

1. One person creates a room.
2. Hit **Copy invite link** and send that link.
3. Everyone else opens the link, types their name if needed, and they land at the same table.
4. When the table is ready, the host starts the game. Empty seats fill with bots.

## Next upgrade ideas

- nil / blind nil bidding
- sandbag tracking
- chat
- spectator mode
- reconnect logic
- room persistence
- custom table stakes and profiles
