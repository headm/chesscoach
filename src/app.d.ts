// See https://svelte.dev/docs/kit/types#app

declare global {
	namespace App {
		/**
		 * What the host hands each request.
		 *
		 * Only `waitUntil` is declared, because it is the only part we use: it
		 * keeps a serverless invocation alive past the response so work that the
		 * player should not wait for — the cache write — still finishes. It is
		 * absent under `vite dev` and under any long-lived Node process, where
		 * nothing freezes and a promise left running completes on its own.
		 */
		interface Platform {
			context?: {
				waitUntil(promise: Promise<unknown>): void;
			};
		}
	}
}

export {};
