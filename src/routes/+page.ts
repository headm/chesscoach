import { redirect } from '@sveltejs/kit';

/**
 * The app opens into a game, not into a form.
 *
 * Landing on a rating slider asks the visitor to make a decision before they
 * have seen anything the decision affects. 1200 is the default the slider
 * itself carried, so this is the same first game they would have got by
 * pressing Start — minus the press. The setup screen still exists at `/new`
 * for choosing a rating and a colour deliberately.
 */
export const load = () => {
	redirect(307, '/game?elo=1200&color=w');
};
