# Shadow Survivors - Co-op Roguelite

A co-op roguelite game with meta-progression, multiple characters, and up to 4-player co-op.

## Architecture

- **Backend**: Node.js + Express + WebSocket (server-authoritative game simulation)
- **Database**: SQLite via better-sqlite3 (accounts, progression, unlocks, upgrades)
- **Frontend**: Single-page HTML/JS client served from `public/`
- **Reverse Proxy**: Caddy on port 4005 proxying to the Node.js backend on port 3002

## Domain

- **URL**: `roguelite.shadowdog.cat:4005`

## Requirements

- [Node.js](https://nodejs.org/) (v18+)
- [Caddy](https://caddyserver.com/) (v2+)
- npm dependencies (installed via `npm install`)

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Start the application:
   ```
   start.bat
   ```

3. Access the game at `http://roguelite.shadowdog.cat:4005`

## Scripts

| Script        | Description                                      |
|---------------|--------------------------------------------------|
| `start.bat`   | Starts both the Node.js server and Caddy proxy   |
| `stop.bat`    | Stops both the Node.js server and Caddy proxy    |
| `restart.bat` | Stops and restarts both services                 |

## Game Features

- **4 Characters**: Knight, Rogue, Archmage, Paladin (each with unique starting weapons and stat bonuses)
- **6 Weapons**: Magic Wand, Knife, Garlic, Holy Water, Fire Wand, Lightning Ring
- **8 Passive Upgrades**: Might, Speed, Max HP, Regen, Armor, Cooldown, Area, Magnet
- **Meta Progression**: Earn gold from runs to buy permanent stat upgrades and unlock characters
- **Co-op**: Up to 4 players per room with enemy scaling
- **Boss Fights**: Timed boss encounters at minutes 5, 10, 15, and 20
- **20-minute runs**: Survive waves of increasingly difficult enemies

## Ports

| Service       | Port |
|---------------|------|
| Node.js (internal) | 3002 |
| Caddy (public)     | 4005 |
