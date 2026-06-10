<p align="center">
  <img src="resources/trayIconTemplate@2x.png" alt="Dev Life" width="64" height="64">
</p>

<h1 align="center">Dev Life</h1>

<p align="center">
  <strong>Developer utilities desktop app for macOS</strong>
</p>

<p align="center">
  <a href="https://github.com/phamvanquyit/dev-life/releases"><img src="https://img.shields.io/github/v/release/phamvanquyit/dev-life?style=flat-square" alt="Release"></a>
  <a href="https://github.com/phamvanquyit/dev-life/blob/main/LICENSE"><img src="https://img.shields.io/github/license/phamvanquyit/dev-life?style=flat-square" alt="License"></a>
  <a href="https://github.com/phamvanquyit/dev-life/actions"><img src="https://img.shields.io/github/actions/workflow/status/phamvanquyit/dev-life/ci.yml?style=flat-square" alt="CI"></a>
</p>

---

## ✨ Features

- 🤖 AI-powered developer assistant with multi-model support
- 🎙️ Voice interaction with real-time speech detection
- 📊 Mermaid diagram rendering
- 🔧 MCP (Model Context Protocol) integration
- 💾 Local SQLite database for conversation persistence
- ⚡ Built with Electron + React + TypeScript for native performance

## 📋 Prerequisites

- **macOS** 12.0 or later
- **Node.js** >= 18
- **Bun** >= 1.0 (recommended) or npm

## 🚀 Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/phamvanquyit/dev-life.git
cd dev-life

# Install dependencies
bun install
```

### Environment Setup

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your API keys
```

### Development

```bash
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

### Preview Production Build

```bash
# Build and run the production version
./preview.sh
```

## 🏗️ Project Structure

```
dev-life/
├── src/
│   ├── main/          # Electron main process
│   ├── preload/       # Preload scripts (IPC bridge)
│   └── renderer/      # React frontend (renderer process)
│       └── src/
├── resources/         # App icons and static assets
├── scripts/           # Build & release scripts
├── electron.vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
├── biome.json
└── package.json
```

## 🛠️ Tech Stack

| Layer       | Technology                            |
|-------------|---------------------------------------|
| Framework   | Electron 35                           |
| Frontend    | React 19, React Router 7             |
| Styling     | Tailwind CSS 4, Ant Design 5         |
| State       | Zustand                              |
| AI / LLM    | LangChain, Vercel AI SDK, OpenAI     |
| Database    | better-sqlite3, Drizzle ORM          |
| Build       | electron-vite, Vite                  |
| Lint/Format | Biome 2                              |
| Language    | TypeScript 5                          |

## 📝 Scripts

| Command              | Description                          |
|----------------------|--------------------------------------|
| `bun dev`            | Start development server             |
| `bun run build`      | Build all processes                  |
| `bun run preview`    | Preview production build             |
| `bun run lint`       | Run linter                           |
| `bun run format`     | Format code                          |
| `bun run check`      | Lint + format (auto-fix)             |
| `bun run build:mac`  | Build macOS distributable (.dmg)     |
| `bun run build:unpack` | Build unpacked app for testing     |

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting a Pull Request.

## 📄 License

This project is licensed under the [MIT License](LICENSE).

## 🔒 Security

If you discover a security vulnerability, please follow our [Security Policy](SECURITY.md).

## 📜 Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
