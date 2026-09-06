# RetroArcade Spades Online

A real-time, Pogo-style Spades lobby built for online play from different locations: pick a room, pick a table, and you're seated with people connecting from anywhere.

**Play live:** [https://spades-online.onrender.com](https://spades-online.onrender.com)

## Features

**Lobby**
- Three rooms, Beginner / Advanced / Expert, each with 25 permanent numbered tables
- Live room roster and room chat, synced across everyone browsing that room
- Click an open seat to join, click a filled seat to watch that specific player
- Table tiles show real-time occupancy and update the moment anyone sits, leaves, or starts a hand
- Cosmetic rating star per room (real accounts/ratings aren't wired up yet)

**Tables**
- 4 seats plus unlimited spectators per table
- The first person to sit becomes host and can start early against bots, no need to wait for 4 humans
- Lock a table to keep it off the public grid while still sharing its code with a friend
- Vote-kick: two seated players can remove someone who's stuck or cheating
- Optional host-set turn timer; timing out benches you to a spectator seat at your own table and hands your seat to a bot
- Spectators can be booted by the player they're watching
- Private code-based tables still work exactly as before, for playing with friends only

**Game**
- Standard Ace-high Spades by default, with an optional 2s-high (deuces wild) house rule the host can switch on
- Real match-end condition: crossing the table's stake as your score wins the match instead of dealing forever
- Card dealing and trick-throw animations, chip highlighting tied to the active stake
- Bots vary their turn timing and call out things like going Nil
- Table sounds and dealer callouts (bidding, your lead, spades broken, hand/match complete)
- Reconnect within a grace period keeps your seat, hand, and score; a permanently abandoned seat mid-hand converts to a bot

**Platform**
- Socket.IO + Node.js/Express server, vanilla JS client, no build step
- Room state persists to disk and survives a server restart

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

For solo testing, either sit at any numbered lobby table and start early against bots, or create a private table as host and start with one human player. Either way the server fills empty seats with bots automatically.

## Tests

```bash
npm test        # server + game-logic unit and integration tests (node:test)
npm run smoke   # scripted socket-only playthrough of a full hand
npm run verify:ui  # Puppeteer layout check of the casino table at common desktop viewports
```

## Play with people in another state

Use the live Render URL, not GitHub and not localhost:

**https://spades-online.onrender.com**

1. Open that link.
2. Pick a room and either click an open seat at any table, or use **Private table (have a code?)** if you want a table just for your group.
3. For a private table, hit **Copy invite link** and send it (it looks like `https://spades-online.onrender.com/?room=ABCDE`).
4. Everyone else opens the invite (or picks the same room/table), types their name if needed, and lands at the same table.
5. A table with 4 humans starts automatically. With fewer than 4, the host can hit **Start game** to fill the rest with bots.

The first load after idle can take about a minute while Render wakes the free service.

## Next upgrade ideas

- Persistent accounts and a real tracked rating (the room rating star is cosmetic today)
- Sandbag tracking
- Spectator-visible hand for a specific watched player, if ever wanted
- Room/table history and stats
