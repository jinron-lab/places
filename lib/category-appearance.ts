const CATEGORY_COLORS = ["#315b46", "#a7644b", "#7a668f", "#50758f", "#9a782f", "#6f7650"];

export function getDefaultCategoryColor(seed: string) {
  const hash = Array.from(seed).reduce((value, character) => value + character.charCodeAt(0), 0);
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
}
