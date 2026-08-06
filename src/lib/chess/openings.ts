/**
 * A deliberately small opening book — enough to name the position in the coach
 * panel and give the model one more grounded fact. Not a substitute for a real
 * ECO database; it just covers what club players actually reach.
 */

const BOOK: Record<string, string> = {
	e4: "King's Pawn Opening",
	'e4 e5': 'Open Game',
	'e4 e5 Nf3': "King's Knight Opening",
	'e4 e5 Nf3 Nc6': 'Open Game',
	'e4 e5 Nf3 Nc6 Bb5': 'Ruy Lopez',
	'e4 e5 Nf3 Nc6 Bc4': 'Italian Game',
	'e4 e5 Nf3 Nc6 Bc4 Bc5': 'Italian Game, Giuoco Piano',
	'e4 e5 Nf3 Nc6 Bc4 Nf6': 'Italian Game, Two Knights Defence',
	'e4 e5 Nf3 Nc6 d4': 'Scotch Game',
	'e4 e5 Nf3 Nf6': 'Petrov Defence',
	'e4 e5 Nc3': 'Vienna Game',
	'e4 e5 f4': "King's Gambit",
	'e4 c5': 'Sicilian Defence',
	'e4 c5 Nf3': 'Sicilian Defence',
	'e4 c5 Nf3 d6': 'Sicilian Defence, Najdorf-ish setup',
	'e4 c5 Nf3 Nc6': 'Sicilian Defence, Old Sicilian',
	'e4 c5 Nf3 e6': 'Sicilian Defence, French Variation',
	'e4 c5 c3': 'Sicilian Defence, Alapin Variation',
	'e4 e6': 'French Defence',
	'e4 e6 d4 d5': 'French Defence',
	'e4 c6': 'Caro-Kann Defence',
	'e4 c6 d4 d5': 'Caro-Kann Defence',
	'e4 d5': 'Scandinavian Defence',
	'e4 Nf6': 'Alekhine Defence',
	'e4 d6': 'Pirc Defence',
	'e4 g6': 'Modern Defence',
	d4: "Queen's Pawn Opening",
	'd4 d5': "Closed Game",
	'd4 d5 c4': "Queen's Gambit",
	'd4 d5 c4 e6': "Queen's Gambit Declined",
	'd4 d5 c4 dxc4': "Queen's Gambit Accepted",
	'd4 d5 c4 c6': 'Slav Defence',
	'd4 Nf6': 'Indian Defence',
	'd4 Nf6 c4': 'Indian Defence',
	'd4 Nf6 c4 g6': "King's Indian / Grünfeld complex",
	'd4 Nf6 c4 e6': 'Indian Defence, Nimzo/Queen\'s Indian complex',
	'd4 Nf6 c4 e6 Nc3 Bb4': 'Nimzo-Indian Defence',
	'd4 Nf6 c4 c5': 'Benoni Defence',
	'd4 f5': 'Dutch Defence',
	Nf3: 'Réti Opening',
	c4: 'English Opening',
	'c4 e5': 'English Opening, Reversed Sicilian'
};

/** Longest-prefix match over the SAN move list. */
export function openingName(sanHistory: string[]): string | null {
	for (let len = Math.min(sanHistory.length, 8); len >= 1; len--) {
		const key = sanHistory.slice(0, len).join(' ');
		if (BOOK[key]) return BOOK[key];
	}
	return null;
}
