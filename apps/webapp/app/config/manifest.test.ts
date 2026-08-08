/**
 * PWA manifest pinning test.
 *
 * The web-app manifest is a static file (`public/static/manifest.json`) rather
 * than a generated resource route — generating it would need a resource route
 * and a cache story for installed PWAs, for a value that changes roughly once
 * (TL-3).
 *
 * This test supplies the guarantee that generating it would have given for
 * free: change `config.appName` and this test fails until somebody opens the
 * manifest and updates it too (US-001 AC6).
 *
 * `short_name` is deliberately pinned to its OWN literal, not to
 * `config.appName`: phone home screens truncate the label at ~12 characters, so
 * "HCF Production Stock" would render "HCF Product…" — the exact surface US-001
 * exists to fix.
 *
 * @see {@link file://./shelf.config.ts}
 * @see {@link file://../../public/static/manifest.json}
 */
import { config } from "./shelf.config";
import manifest from "../../public/static/manifest.json";

describe("PWA manifest", () => {
  it("uses the configured app name", () => {
    expect(manifest.name).toBe(config.appName);
  });

  it("uses a short_name that fits an untruncated home-screen label", () => {
    expect(manifest.short_name).toBe("HCF Stock");
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  });

  it("launches on the HCF warm off-white, not white", () => {
    expect(manifest.background_color).toBe("#FFFBF8");
    expect(manifest.theme_color).toBe("#FFFBF8");
  });

  it("references no Shelf-named asset and no Shelf copy", () => {
    const serialised = JSON.stringify(manifest).toLowerCase();
    expect(serialised).not.toContain("shelf");
  });

  it("ships at least one icon, all of them HCF assets", () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.src).toMatch(/^\/static\/images\/hcf-/);
    }
  });
});
