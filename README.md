# RetroArcade Spades Online

A real-time 4-player Spades room starter built for online play from different locations.

## Features

- Create a room and share the code
- Join a room from another browser or machine
- 4 seats per table
- Stake selection for 250 / 500 / 1000 tables
- Basic Spades flow: deal, bid, play cards, scoring
- Socket-based multiplayer using Node.js + Socket.IO

## Run locally

```bash
cd spades-online
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

## Deploy

Use a Node host such as Render, Railway, Azure App Service, or a VPS.

### Free option: Render

1. Push this folder to GitHub.
2. Go to https://dashboard.render.com/select-repo?type=web
3. Choose the repo and create a Web Service.
4. Render will read the included `render.yaml` file.
5. Keep the plan as `Free`.
6. After deploy, Render gives you a public URL like:

```text
https://retroarcade-spades-online.onrender.com
```

The app is already configured for a Socket.IO multiplayer room and uses the normal `PORT` environment variable, so it works in Render without code changes.

## Next upgrade ideas

- nil / blind nil bidding
- sandbag tracking
- chat
- spectator mode
- reconnect logic
- room persistence
- animated card table UI
- custom table stakes and profiles
