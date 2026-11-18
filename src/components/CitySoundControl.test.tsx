import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CitySoundControl } from "./CitySoundControl";
import type { CitySound } from "../sound/useCitySound";

const sound = (p: Partial<CitySound>): CitySound => ({ on: false, volume: 0.6, supported: true, toggle: () => {}, setVolume: () => {}, lastEvent: null, ...p });

describe("CitySoundControl", () => {
  it("shows the muted speaker and 'City sound off' when sound is off, with no slider", () => {
    const html = renderToStaticMarkup(<CitySoundControl sound={sound({})} reduced={false} />);
    expect(html).toContain('aria-label="City sound"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("City sound off");
    expect(html).not.toContain('type="range"');
  });
  it("shows the speaker, 'City sound on' and a labelled volume slider when sound is on", () => {
    const html = renderToStaticMarkup(<CitySoundControl sound={sound({ on: true, volume: 0.35 })} reduced={false} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("City sound on");
    expect(html).toContain('aria-label="City sound volume"');
    expect(html).toContain('value="35"');
    expect(html).toContain('aria-valuetext="35%"');
  });
  it("says so and disables the button where the browser has no Web Audio", () => {
    const html = renderToStaticMarkup(<CitySoundControl sound={sound({ supported: false })} reduced={false} />);
    expect(html).toContain("isn&#x27;t available");
    expect(html).toContain("disabled");
  });
});
