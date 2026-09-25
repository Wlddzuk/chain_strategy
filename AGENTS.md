# Repository Guidelines

## Project Structure & Module Organization
Chain Trader uses the Next.js 16 App Router. Feature routes live in `src/app` (e.g., `src/app/dashboard/page.tsx` drives data fetch + layout). UI primitives and panels live in `src/components`, reusable logic in `src/lib/api` (Hyperliquid clients) and `src/lib/trading` (types + helpers), and global state in `src/store/trading-store.ts`. Static assets belong in `public`; shared styles sit in `src/app/globals.css`.

## Build, Test, and Development Commands
- `npm install` — install deps; never edit `node_modules`.
- `npm run dev` — hot-reload server on `http://localhost:3000` with live polling.
- `npm run build` — production build plus type-check; run before opening PRs.
- `npm run start` — serve the `.next` output for smoke testing.
- `npm run lint` — Next + ESLint rules; keep the tree clean before pushing.

## Coding Style & Naming Conventions
All source lives in TypeScript with 4-space indentation. Prefer const function components with hooks, order imports as React → third-party → `@/` aliases → relative, and export components/stores in PascalCase while files stay kebab-case (`signal-card.tsx`). Group Tailwind utilities by intent, use CSS variables from `globals.css`, and extract repeated class clusters into components. Run `npm run lint` after noticeable edits.

## Testing Guidelines
Automated tests are not yet committed, so add them alongside each feature. Use React Testing Library with Vitest or Jest, colocate specs near the code (`src/components/__tests__/chart.spec.tsx`), and stub Hyperliquid calls through the helpers in `src/lib/api` to keep runs deterministic. Target meaningful coverage and describe any gaps in the PR; wire up `npm run test` to your chosen runner once added.

## Commit & Pull Request Guidelines
History uses concise, imperative messages (`Add hyperliquid polling hooks`), so follow that format and keep each commit scoped to one concern. Reference tickets such as `CHAIN-42` in the body when applicable. Pull requests need a summary, screenshots or clips for UI tweaks, a verification checklist (`npm run lint`, manual dashboard scan), and a note about configuration changes or migrations.

## Security & Configuration Tips
API calls currently hit the public Hyperliquid base URL from `src/lib/api`. Never hardcode credentials or wallet addresses; store them in `.env.local` and only expose values with a `NEXT_PUBLIC_` prefix when the browser needs them. Remove stray console logging and ensure polling intervals stay within Hyperliquid rate limits before shipping.
