<div align="center">

# 🎮 Shadow Survivors

**A co-op roguelite with meta-progression, 8 characters, and 4-player multiplayer**

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)
![Multiplayer](https://img.shields.io/badge/Players-1--4-green?style=flat-square)

*A Survivor.io-inspired game with server-authoritative multiplayer*

[![Play Now](https://img.shields.io/badge/🎮_Play_Now-Live!-brightgreen?style=for-the-badge)](https://roguelite.shadowdog.cat)

[Play Locally](#-quick-start) · [Features](#-features) · [Deployment](#-deployment)

</div>

---

## 🚀 Quick Start

Get the game running in 30 seconds:

```bash
git clone https://github.com/shadowdoggie/shadow-survivors.git
cd shadow-survivors
npm install
npm start
```

👉 Open **http://localhost:3002** in your browser and start playing!

---

## ✨ Features

### 🎭 8 Playable Characters

| Character | Playstyle | Starting Weapon |
|-----------|-----------|-----------------|
| 🗡️ **Knight** | Balanced fighter | Magic Wand |
| 🗡️ **Rogue** | Fast & deadly | Knife |
| 🔮 **Archmage** | Glass cannon | Fire Wand |
| 🛡️ **Paladin** | Tanky healer | Garlic |
| ✨ **Priest** | Healing aura | Holy Water |
| 🌿 **Druid** | Support buffs | Garlic |
| 💀 **Necromancer** | Scaling damage | Lightning Ring |
| ⚔️ **Berserker** | Low HP = high damage | Axe |

### ⚔️ 9 Weapons + Evolutions

Each weapon can evolve into a powerful ultimate form:

| Base Weapon | Evolution | Requirement |
|-------------|-----------|-------------|
| Magic Wand | → Holy Wand | +Cooldown passive |
| Knife | → Thousand Edge | +Might passive |
| Garlic | → Soul Eater | +Max HP passive |
| Holy Water | → La Borra | +Magnet passive |
| Fire Wand | → Hellfire | +Area passive |
| Lightning Ring | → Thunder Loop | +Armor passive |
| Axe | → Death Spiral | +Might passive |
| Whip | → Bloody Tear | +Speed passive |
| Cross | → Heaven Sword | +Cooldown passive |

### 📈 Meta Progression

- 💰 Earn **gold** from every run
- 🔓 **Unlock new characters** permanently
- ⬆️ **Buy permanent stat upgrades** that persist across runs
- 🏆 **Achievements** to collect

### 👥 4-Player Co-op

- Real-time multiplayer via WebSocket
- Enemy scaling based on player count
- Shared screen experience

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                    BROWSER                          │
│              (HTML5 Canvas + JS)                    │
└─────────────────────┬───────────────────────────────┘
                      │ WebSocket
┌─────────────────────▼───────────────────────────────┐
│               NODE.JS SERVER                        │
│         Express + ws + sql.js                       │
│         (Server-authoritative)                      │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│              SQLite (sql.js)                        │
│      Accounts • Progression • Unlocks               │
└─────────────────────────────────────────────────────┘
```

**Tech Stack:**
| Layer | Technology |
|-------|------------|
| Server | Node.js + Express |
| Realtime | WebSocket (ws) |
| Database | SQLite via sql.js |
| Auth | bcryptjs + UUID tokens |
| Proxy (prod) | Caddy with auto-HTTPS |

---

## 🖥️ Running the Game

### Development (Local)

```bash
npm install
npm start
```

Game runs at **http://localhost:3002**

### Production (with HTTPS)

<details>
<summary>📋 Click to expand production setup</summary>

1. **Install Caddy** (automatic HTTPS)
   ```bash
   # Ubuntu/Debian
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update && sudo apt install caddy
   ```

2. **Configure your domain**
   - Point your domain's A record to your server IP
   - Edit `Caddyfile` and replace `roguelite.shadowdog.cat` with your domain
   - Update the email for Let's Encrypt

3. **Start the services**
   ```bash
   # Windows
   start.bat
   
   # Linux
   npm start &
   caddy run --config Caddyfile
   ```

4. **Open firewall ports**
   ```bash
   sudo ufw allow 80
   sudo ufw allow 443
   ```

</details>

---

## ⚙️ Configuration

### Ports

| Service | Port | Access |
|---------|------|--------|
| Node.js | 3002 | Internal only |
| Caddy HTTP | 80 | Public (redirects to HTTPS) |
| Caddy HTTPS | 443 | Public |

### Change Node.js Port

Edit `server.js` line 14:
```javascript
const PORT = 3002;  // Change to your preferred port
```

If using Caddy, also update the `reverse_proxy` line in `Caddyfile`.

---

## 📜 Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start Node.js server |
| `start.bat` | Start Node.js + Caddy (Windows) |
| `stop.bat` | Stop all services (Windows) |
| `restart.bat` | Restart all services (Windows) |

---

## 🎯 Gameplay Tips

1. **Stick together** in co-op - support characters excel near allies
2. **Save gold** for character unlocks before upgrading stats
3. **Level weapons to 7** then get the matching passive for evolution
4. **Priest + Druid** combo is incredibly strong for sustained fights
5. **Necromancer** scales infinitely - survive long enough and you'll one-shot bosses

---

## 🤝 Contributing

Contributions welcome! Feel free to:
- 🐛 Report bugs
- 💡 Suggest features
- 🔧 Submit pull requests

---

## 📄 License

[MIT](LICENSE) - Use it, modify it, share it!

---

<div align="center">

**Made with ❤️ for roguelite fans**

[⬆ Back to Top](#-shadow-survivors)

</div>
