/// Cover-art squircle thumbnails for the image themes, bundled by Vite (works
/// in both the web + desktop builds). Keyed by `./thumbs/<slug>.jpg`. The
/// classic `default-dark` has no cover art → `themeThumb` returns undefined and
/// callers render a CSS colour tile instead. Shared by the first-launch
/// ThemePickerModal and the Settings ThemePane.
const THUMBS = import.meta.glob<string>("./thumbs/*.jpg", {
  eager: true,
  import: "default",
});

export function themeThumb(slug: string): string | undefined {
  return THUMBS[`./thumbs/${slug}.jpg`];
}
