/**
 * Rhythm data — genre / pattern / beat table transcribed verbatim from the
 * RC-505mkII Parameter Guide, "Rhythm Pattern List" (pages 44–45), plus the
 * 16 drum kits listed under LOOP/RHYTHM/KIT (page 7).
 */

export interface RhythmPattern {
  name: string;
  beat: string;
}

export interface RhythmGenre {
  name: string;
  patterns: RhythmPattern[];
}

const p = (name: string, beat = '4/4'): RhythmPattern => ({ name, beat });

export const RHYTHM_GENRES: RhythmGenre[] = [
  {
    name: 'ACOUSTIC',
    patterns: [
      p('SIDE STICK'),
      p('BOSSA'),
      p('BRUSH1'),
      p('BRUSH2'),
      p('CONGA 8BEAT'),
      p('CONGA 16BEAT'),
      p('CONGA 4BEAT'),
      p('CONGA SWING'),
      p('CONGA BOSSA'),
      p('CAJON1'),
      p('CAJON2'),
    ],
  },
  {
    name: 'BALLAD',
    patterns: [
      p('SHUFFLE2', '3/4'),
      p('SIDE STICK1'),
      p('SIDE STICK2'),
      p('SIDE STICK3'),
      p('SIDE STICK4'),
      p('SHUFFLE1'),
      p('8BEAT'),
      p('16BEAT1'),
      p('16BEAT2'),
      p('SWING'),
      p('6/8 BEAT', '6/8'),
    ],
  },
  {
    name: 'BLUES',
    patterns: [p('3BEAT', '3/4'), p('12BARS'), p('SHUFFLE1'), p('SHUFFLE2'), p('SWING'), p('6/8 BEAT', '6/8')],
  },
  {
    name: 'JAZZ',
    patterns: [
      p('JAZZ BLUES'),
      p('FAST 4BEAT'),
      p('HARD BOP'),
      p('BRUSH BOP'),
      p('BRUSH SWING'),
      p('FAST SWNG'),
      p('MED SWING'),
      p('SLOW LEGATO'),
      p('JAZZ SAMBA'),
      p('6/8 BEAT', '6/8'),
    ],
  },
  {
    name: 'FUSION',
    patterns: [
      p('16BEAT1'),
      p('16BEAT2'),
      p('16BEAT3'),
      p('16BEAT4'),
      p('16BEAT5'),
      p('16BEAT6'),
      p('16BEAT7'),
      p('SWING'),
      p('7/8 BEAT', '7/8'),
    ],
  },
  {
    name: 'R&B',
    patterns: [
      p('SWING1'),
      p('SWING2'),
      p('SWING3'),
      p('SIDE STICK1'),
      p('SIDE STICK2'),
      p('SIDE STICK3'),
      p('SHUFFLE1'),
      p('SHUFFLE2'),
      p('8BEAT1'),
      p('16BEAT'),
      p('7/8 BEAT', '7/8'),
    ],
  },
  {
    name: 'SOUL',
    patterns: [
      p('SWING1'),
      p('SWING2'),
      p('SWING3'),
      p('SWING4'),
      p('16BEAT1'),
      p('16BEAT2'),
      p('16BEAT3'),
      p('SIDESTK1'),
      p('SIDESTK2'),
      p('MOTOWN'),
      p('PERCUS'),
    ],
  },
  {
    name: 'FUNK',
    patterns: [
      p('8BEAT1'),
      p('8BEAT2'),
      p('8BEAT3'),
      p('8BEAT4'),
      p('16BEAT1'),
      p('16BEAT2'),
      p('16BEAT3'),
      p('16BEAT4'),
      p('SWING1'),
      p('SWING2'),
      p('SWING3'),
    ],
  },
  {
    name: 'POP',
    patterns: [
      p('8BEAT1'),
      p('8BEAT2'),
      p('16BEAT1'),
      p('16BEAT2'),
      p('PERCUS1'),
      p('SHUFFLE1'),
      p('SHUFFLE2'),
      p('SIDE STICK1'),
      p('SIDE STICK2'),
      p('SWING1'),
      p('SWING2'),
      p('PERCUS2', '6/8'),
    ],
  },
  {
    name: 'SOFT ROCK',
    patterns: [
      p('16BEAT1'),
      p('16BEAT2'),
      p('16BEAT3'),
      p('16BEAT4'),
      p('8BEAT'),
      p('SWING1'),
      p('SWING2'),
      p('SWING3'),
      p('SWING4'),
      p('SIDE STICK1'),
      p('SIDE STICK2'),
      p('PERCUS1'),
      p('PERCUS2'),
    ],
  },
  {
    name: 'ROCK',
    patterns: [
      p('8BEAT1'),
      p('8BEAT2'),
      p('8BEAT3'),
      p('8BEAT4'),
      p('8BEAT5'),
      p('8BEAT6'),
      p('16BEAT1'),
      p('16BEAT2'),
      p('16BEAT3'),
      p('16BEAT4'),
      p('SHUFFLE1'),
      p('SHUFFLE2'),
      p('SWING1'),
      p('SWING2'),
      p('SWING3'),
      p('SWING4'),
    ],
  },
  {
    name: 'ALT ROCK',
    patterns: [
      p('RIDEBEAT'),
      p('8BEAT1'),
      p('8BEAT2'),
      p('8BEAT3'),
      p('8BEAT4'),
      p('16BEAT1'),
      p('16BEAT2'),
      p('16BEAT3'),
      p('16BEAT4'),
      p('SWING'),
      p('5/4 BEAT', '5/4'),
    ],
  },
  {
    name: 'PUNK',
    patterns: [
      p('8BEAT1'),
      p('8BEAT2'),
      p('8BEAT3'),
      p('8BEAT4'),
      p('8BEAT5'),
      p('8BEAT6'),
      p('16BEAT1'),
      p('16BEAT2'),
      p('16BEAT3'),
      p('SIDE STICK'),
      p('8BEAT6'),
    ],
  },
  {
    name: 'HEAVY ROCK',
    patterns: [
      p('8BEAT1'),
      p('8BEAT2'),
      p('8BEAT3'),
      p('16BEAT1'),
      p('16BEAT2'),
      p('16BEAT3'),
      p('SHUFFLE1'),
      p('SHUFFLE2'),
      p('SWING1'),
      p('SWING2'),
      p('SWING3'),
    ],
  },
  {
    name: 'METAL',
    patterns: [
      p('8BEAT1'),
      p('8BEAT2'),
      p('8BEAT3'),
      p('8BEAT4'),
      p('8BEAT5'),
      p('8BEAT6'),
      p('2XBD1'),
      p('2XBD2'),
      p('2XBD3'),
      p('2XBD4'),
      p('2XBD5'),
    ],
  },
  {
    name: 'TRAD',
    patterns: [
      p('TRAIN2', '2/4'),
      p('ROCKN ROLL'),
      p('TRAIN1'),
      p('COUNTRY1'),
      p('COUNTRY2'),
      p('COUNTRY3'),
      p('FOXTROT'),
      p('TRAD1'),
      p('TRAD2'),
    ],
  },
  {
    name: 'WORLD',
    patterns: [
      p('BOSSA1'),
      p('BOSSA2'),
      p('SAMBA1'),
      p('SAMBA2'),
      p('BOOGALOO'),
      p('MERENGUE'),
      p('REGGAE'),
      p('LATIN ROCK1'),
      p('LATIN ROCK2'),
      p('LATIN PERC'),
      p('SURDO'),
      p('LATIN1'),
      p('LATIN2'),
    ],
  },
  {
    name: 'BALLRM',
    patterns: [
      p('CUMBIA', '2/4'),
      p('WALTZ1', '3/4'),
      p('WALTZ2', '3/4'),
      p('CHACHA'),
      p('BEGUINE'),
      p('RHUMBA'),
      p('TANGO1'),
      p('TANGO2'),
      p('JIVE'),
      p('CHARLSTON'),
    ],
  },
  {
    name: 'ELCTRO',
    patterns: [
      p('ELCTRO01'),
      p('ELCTRO02'),
      p('ELCTRO03'),
      p('ELCTRO04'),
      p('ELCTRO05'),
      p('ELCTRO06'),
      p('ELCTRO07'),
      p('ELCTRO08'),
      p('5/4 BEAT', '5/4'),
    ],
  },
  {
    name: 'GUIDE',
    patterns: [
      p('2/4 TRIPLE', '2/4'),
      p('3/4', '3/4'),
      p('3/4 TRIPLE', '3/4'),
      p('4/4'),
      p('4/4 TRIPLE'),
      p('BD 8BEAT'),
      p('BD 16BEAT'),
      p('BD SHUFFLE'),
      p('HH 8BEAT'),
      p('HH 16BEAT'),
      p('HH SWING1'),
      p('HH SWING2'),
      p('8BEAT1'),
      p('8BEAT2'),
      p('8BEAT3'),
      p('8BEAT4'),
      p('5/4', '5/4'),
      p('5/4 TRIPLE', '5/4'),
      p('6/4', '6/4'),
      p('6/4 TRIPLE', '6/4'),
      p('7/4', '7/4'),
      p('7/4 TRIPLE', '7/4'),
      p('5/8', '5/8'),
      p('6/8', '6/8'),
      p('7/8', '7/8'),
      p('8/8', '8/8'),
      p('9/8', '9/8'),
      p('10/8', '10/8'),
      p('11/8', '11/8'),
      p('12/8', '12/8'),
      p('13/8', '13/8'),
      p('14/8', '14/8'),
      p('15/8', '15/8'),
    ],
  },
  { name: 'USER', patterns: [p('SIMPLE BEAT')] },
];

export const RHYTHM_KITS = [
  'STUDIO',
  'LIVE',
  'LIGHT',
  'HEAVY',
  'ROCK',
  'METAL',
  'JAZZ',
  'BRUSH',
  'CAJON',
  'DRUM&BASS',
  'R&B',
  'DANCE',
  'TECHNO',
  'DANCE BEATS',
  'HIPHOP',
  '808+909',
] as const;

export type RhythmKit = (typeof RHYTHM_KITS)[number];

/** BEAT values selectable in LOOP/RHYTHM: 2/4–7/4 and 5/8–15/8. */
export const BEAT_VALUES = [
  '2/4',
  '3/4',
  '4/4',
  '5/4',
  '6/4',
  '7/4',
  '5/8',
  '6/8',
  '7/8',
  '8/8',
  '9/8',
  '10/8',
  '11/8',
  '12/8',
  '13/8',
  '14/8',
  '15/8',
] as const;

export const GENRE_NAMES = RHYTHM_GENRES.map((g) => g.name);

export function genre(name: string): RhythmGenre {
  return RHYTHM_GENRES.find((g) => g.name === name) ?? RHYTHM_GENRES[0];
}

export function patternsOf(genreName: string): RhythmPattern[] {
  return genre(genreName).patterns;
}

export function patternBeat(genreName: string, patternName: string): string {
  return patternsOf(genreName).find((x) => x.name === patternName)?.beat ?? '4/4';
}

export function parseBeat(beat: string): { num: number; den: number } {
  const [n, d] = beat.split('/').map(Number);
  return { num: n || 4, den: d || 4 };
}

/** Total pattern count, for the "200 types or greater" spec line. */
export const TOTAL_PATTERNS = RHYTHM_GENRES.reduce((n, g) => n + g.patterns.length, 0);
