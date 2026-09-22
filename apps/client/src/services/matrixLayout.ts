// A shared 24px pitch gives all heatmaps 21px cells and 3px gaps.
// Resolution depends on available width, never on the artist-count selector.
export const HEATMAP_PITCH = 24;
export const HEATMAP_LABEL_WIDTH = 58;

export function timelineMatrixLayout(
  availableWidth: number,
  labelWidth: number,
  sourceCount: number,
  maxColumns = 64,
) {
  const pitch = HEATMAP_PITCH;
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
