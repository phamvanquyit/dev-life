<p align="center">
  <img src="resources/logo.svg" alt="Dev Life" width="128" height="128">
</p>

<h1 align="center">Dev Life</h1>

<p align="center">
  <strong>Developer utilities desktop app for macOS</strong>
</p>

<p align="center">
  <a href="https://github.com/phamvanquyit/dev-life/releases"><img src="https://img.shields.io/github/v/release/phamvanquyit/dev-life?style=flat-square" alt="Release"></a>
  <a href="https://github.com/phamvanquyit/dev-life/blob/main/LICENSE"><img src="https://img.shields.io/github/license/phamvanquyit/dev-life?style=flat-square" alt="License"></a>
</p>

---

## ✨ Features

- 🧩 **Mini App Platform** — Create, install, and manage mini apps with frontend (React/JSX), backend (Node.js), and panel support
- 🔧 **MCP Server** — Built-in Model Context Protocol server so AI editors (Claude Desktop, Antigravity) can manage mini apps
- 🤖 **AI Agent** — Integrated AI coding assistant with multi-provider support (OpenAI, Anthropic, Google) for building mini apps
- 🖥️ **Menu Bar App** — System tray with quick access panel for everyday developer utilities
- 🔄 **In-App Auto-Update** — Download, install, and restart updates directly from within the app
- 💾 **Local SQLite** — Persistent storage for mini app data, configurations, and LLM providers
- ⚡ **Built with Electron + React + TypeScript** for native macOS performance

## 📥 Install

### One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/phamvanquyit/dev-life/main/scripts/install.sh | bash
```

### Manual download

1. Download the latest `.dmg` from [Releases](https://github.com/phamvanquyit/dev-life/releases/latest)
2. Open the `.dmg` and drag **Dev Life** to `/Applications`
3. Remove the quarantine flag (app is unsigned):
   ```bash
   xattr -cr /Applications/Dev\ Life.app
   ```

> **Note:** The app is not code-signed. macOS Gatekeeper will block it on first launch unless you remove the quarantine attribute with the command above.

## 🚀 Development

### Prerequisites

- **macOS** 12.0 or later
- **Node.js** >= 18
- **Bun** >= 1.0

### Setup

```bash
# Clone the repository
git clone https://github.com/phamvanquyit/dev-life.git
cd dev-life

# Install dependencies
bun install

# Start the app in development mode
bun dev
```

### Build

```bash
# Build for production (macOS)
bun run build:mac

# Build unpacked version for testing
bun run build:unpack
```

## 🏗️ Project Structure

```
dev-life/
├── src/
│   ├── main/          # Electron main process
│   ├── preload/       # Preload scripts (IPC bridge)
│   └── renderer/      # React frontend (renderer process)
├── resources/         # App icons and static assets
├── scripts/           # Build & release scripts
├── electron.vite.config.ts
└── package.json
```

## 🛠️ Tech Stack

| Layer       | Technology                        |
|-------------|-----------------------------------|
| Framework   | Electron 35                       |
| Frontend    | React 19, React Router 7         |
| Styling     | Tailwind CSS 4, Ant Design 5     |
| State       | Zustand                          |
| AI / LLM    | LangChain, Vercel AI SDK, OpenAI |
| Database    | better-sqlite3, Drizzle ORM      |
| Build       | electron-vite, Vite              |
| Lint/Format | Biome 2                          |
| Language    | TypeScript 5                     |

## 📝 Scripts

| Command                | Description                      |
|------------------------|----------------------------------|
| `bun dev`              | Start development server         |
| `bun run build`        | Build all processes              |
| `bun run build:mac`    | Build macOS distributable (.dmg) |
| `bun run build:unpack` | Build unpacked app for testing   |
| `bun run lint`         | Run linter                       |
| `bun run format`       | Format code                      |
| `bun run check`        | Lint + format (auto-fix)         |

## 🤝 Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a Pull Request.

## 📄 License

This project is licensed under the [MIT License](LICENSE).
