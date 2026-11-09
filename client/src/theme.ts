import { themeQuartz } from 'ag-grid-community';

// One DropLab theme for every AG Grid on the page. Built from Quartz with the design tokens from styles.css (U-1),
// so the grids use the same blue, ink, header and radius as the rest of the page.
export const droplabTheme = themeQuartz.withParams({
  accentColor: 'var(--c-primary)',
  foregroundColor: 'var(--c-ink)',
  headerBackgroundColor: 'var(--c-header)',
  headerTextColor: 'var(--c-ink)',
  rowHoverColor: 'var(--c-hover)',
  borderRadius: 6,
  wrapperBorderRadius: 10,
  fontFamily: 'var(--font-sans)',
});
