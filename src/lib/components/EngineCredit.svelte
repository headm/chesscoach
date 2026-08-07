<script lang="ts">
	import { ENGINE } from '$lib/engine/attribution';

	// Visible attribution for the GPLv3 engine doing the analysis. It runs on the
	// server, so this is courtesy rather than obligation — but a player should be
	// able to see what is grading their moves, and check its licence.
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
	</a>. Runs on our server; source linked for reference.
</p>
