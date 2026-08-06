import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		// The single-threaded Stockfish build does not need SharedArrayBuffer, so no
		// COOP/COEP headers are required here. If you later swap in the multi-threaded
		// build, add:
		//   headers: {
		//     'Cross-Origin-Opener-Policy': 'same-origin',
		//     'Cross-Origin-Embedder-Policy': 'require-corp'
		//   }
		fs: { allow: ['..'] }
	}
});
