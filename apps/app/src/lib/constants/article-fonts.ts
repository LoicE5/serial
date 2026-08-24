export const ARTICLE_FONT_FAMILIES = ["sans-serif", "serif"] as const;
export type ArticleFontFamily = (typeof ARTICLE_FONT_FAMILIES)[number];

export const FONT_FAMILY_CSS: Record<ArticleFontFamily, string> = {
  "sans-serif": '"Atkinson Hyperlegible Next Variable", sans-serif',
  serif: '"Noto Serif Variable", serif',
};

export const CSS_TO_FONT_FAMILY: Record<string, ArticleFontFamily> = {
  '"Atkinson Hyperlegible Next Variable", sans-serif': "sans-serif",
  '"Noto Serif Variable", serif': "serif",
};
