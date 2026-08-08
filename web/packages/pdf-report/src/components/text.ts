/* eslint-disable no-magic-numbers -- codepoint boundaries are the definition; naming each adds nothing */
// The bundled PDF fonts carry no emoji glyphs, so an emoji renders as a tofu
// box. Ranges are listed separately, rather than as one character class, to keep
// the scan linear and avoid combining-mark ambiguity.
const EMOJI_RANGES: [number, number][] = [
  [0x1f000, 0x1faff], // pictographs, emoticons, transport, symbols
  [0x2600, 0x27bf], // miscellaneous symbols and dingbats
  [0xfe0f, 0xfe0f], // the variation selector that renders one as emoji
];

const isEmojiCodePoint = (codePoint: number): boolean =>
  EMOJI_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);

/**
 * Drops glyphs the PDF fonts cannot draw.
 *
 * Applied wherever a caller-supplied or code-produced string is rendered: both
 * report branding and the values a template's code step emits are outside this
 * package's control, and a tofu box is a worse failure than a missing emoji.
 */
export const displayable = (value: string): string =>
  Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint === undefined || !isEmojiCodePoint(codePoint);
    })
    .join('')
    .trim();
