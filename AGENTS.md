# Repository Guidelines

## Project Structure & Module Organization

This is a Pixi-managed Node.js monorepo for self-hosted Mineflayer bots.

- `apps/server/src/cli.js` is the CLI entry point.
- `apps/server/src/core/` owns bot lifecycle, reconnects, commands, and multi-bot state.
- `apps/server/src/web/` exposes the control API and serves the built UI.
- `apps/web/` contains the React + TypeScript + Vite dashboard.
- `config/*.example.json` is safe to commit; `config/*.local.json` contains private runtime settings.
- `data/auth/` stores Microsoft authentication cache and must remain untracked.

Keep bot behavior in `core/`; do not add Mineflayer logic to HTTP routes or React components.

## Build, Test, and Development Commands

Use Pixi for every project command. Do not call the system `node` or `npm` directly.

- `pixi run install` installs npm dependencies with Pixi's Node.js/npm.
- `pixi run bot Yukikaze` starts one bot in CLI mode.
- `pixi run bots` starts all enabled bots.
- `pixi run server` starts the optional production API/UI.
- `pixi run dev` starts the API and Vite development server.
- `pixi run check` checks server syntax and example configuration.
- `pixi run build` type-checks and builds the React UI.

## Coding Style & Naming Conventions

Server code uses CommonJS, single quotes, semicolons, and two-space indentation. React code uses strict TypeScript and functional components. Use `camelCase` for functions and variables, `PascalCase` for React components, and stable human-readable bot IDs such as `Yukikaze`.

## Testing Guidelines

No full automated suite exists yet. Before submitting, run `pixi run check` and `pixi run build`. Smoke-test the API without auto-starting bots, then manually test affected Minecraft behavior on a non-production server. Future tests should live in `apps/server/test/` or beside UI code as `*.test.tsx`.

## Commit & Pull Request Guidelines

Use concise imperative commits, for example `Add viewer status to dashboard`. Pull requests should describe behavior changes, list validation commands, identify affected Minecraft versions, and include screenshots for UI changes. Keep configuration migrations separate from feature changes.

## Security & Configuration

Never commit real account emails, server addresses, player allowlists, tokens, or auth caches. Review `.gitignore` before publishing. Keep the Web server bound to `127.0.0.1` unless it is protected by authenticated TLS reverse proxying or a VPN. Leave `web.allowRawCommands` disabled for exposed deployments.
