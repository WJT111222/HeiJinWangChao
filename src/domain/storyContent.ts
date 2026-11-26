/** Test presence only. Keep joiners, variation selectors and combining characters in the saved text. */
export function hasVisibleNarrative(text: string): boolean {
  return /[^\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/u.test(text);
}
