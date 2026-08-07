<script lang="ts">
	import { ENGINE } from '$lib/engine/attribution';

	// Visible attribution for the bundled GPLv3 engine. The app serves Stockfish
	// to the browser, which is distribution — recipients are entitled to the
	// licence and a pointer to the corresponding source, and a link they can
	// actually see is the practical way to give them both.
</script>

<p class="text-[11px] leading-relaxed text-slate-500">
	Analysis by
	<a
		href={ENGINE.upstreamUrl}
		target="_blank"
		rel="noreferrer"
		class="underline decoration-slate-700 underline-offset-2 hover:text-slate-300"
	>
		Stockfish {ENGINE.engineVersion}
	</a>
	via
	<a
		href={ENGINE.sourceUrl}
		target="_blank"
		rel="noreferrer"
		class="underline decoration-slate-700 underline-offset-2 hover:text-slate-300"
	>
		Stockfish.js {ENGINE.npmVersion}
	</a>
	—
	<a
		href={ENGINE.licenseUrl}
		target="_blank"
		rel="noreferrer"
		class="underline decoration-slate-700 underline-offset-2 hover:text-slate-300"
	>
		{ENGINE.license}
	</a>. Source linked as required by the licence.
</p>
