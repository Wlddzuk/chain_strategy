import { fileURLToPath, URL } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        // Agent worktrees under .claude/ hold stale copies of the app; never test them.
        exclude: [...configDefaults.exclude, '.claude/**', 'brag-output*/**'],
    },
});
