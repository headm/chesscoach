import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		// Stockfish runs in the Node process, not the browser, so there is no
		// cross-origin isolation to arrange here — no COOP/COEP headers, no
		// SharedArrayBuffer.
		fs: { allow: ['..'] }
	}
});
