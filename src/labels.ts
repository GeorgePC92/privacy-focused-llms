export const LABELS = [
    "animal", "architecture", "art", "beach", "bicycle", "car",
    "concert", "food", "garden", "group", "kids", "mountain",
    "night", "people", "pets", "sports", "travel",
] as const;

export type Label = (typeof LABELS)[number];
export const NUM_LABELS = LABELS.length;