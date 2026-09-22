// A shared 24px pitch gives both timeline matrices 21px cells and 3px gaps.
// Resolution depends on available width, never on the artist-count selector.
export function timelineMatrixLayout(
  availableWidth: number,
  labelWidth: number,
  sourceCount: number,
  maxColumns = 64,
) {
  const pitch = 24;
  const columns = Math.max(
    1,
    Math.min(
      sourceCount,
      maxColumns,
      Math.floor((availableWidth - labelWidth) / pitch),
    ),
  );
  return { columns, pitch };
}
