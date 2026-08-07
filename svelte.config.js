import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: {
		// adapter-node emits a standalone server, which Vercel cannot run — it
		// looks for serverless functions and finds no output directory.
		adapter: adapter({
			// The coach endpoint is a short, network-bound call to the Claude API.
			// The Node runtime keeps `@anthropic-ai/sdk` on a supported platform;
			// the edge runtime would be a poor fit for it.
			runtime: 'nodejs22.x'
		})
	}
};
