import { IconLayer } from "@deck.gl/layers";
import type { SelectedEntity } from "../../types/entities";

// Cyberpunk hollow-diamond with stem — inline SVG data-URI, zero network fetch.
// 22×36 canvas: diamond occupies rows 1–21, stem rows 21–35.
// Glow achieved via SVG feDropShadow filter.
const DIAMOND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="36" viewBox="0 0 22 36">
  <defs>
    <filter id="g" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="0" stdDeviation="2.5" flood-color="%2300f5ff" flood-opacity="0.8"/>
    </filter>
  </defs>
  <polygon points="11,2 20,11 11,20 2,11"
    fill="rgba(0,245,255,0.12)" stroke="%2300f5ff" stroke-width="1.5"
    filter="url(%23g)"/>
  <line x1="11" y1="20" x2="11" y2="34"
    stroke="%2300f5ff" stroke-width="1.2" opacity="0.75"/>
</svg>`;

const DIAMOND_DATA_URI = `data:image/svg+xml,${DIAMOND_SVG.replace(/\n\s*/g, "").replace(/"/g, "'")}`;

const ICON_MAPPING = {
  pin: { x: 0, y: 0, width: 22, height: 36, anchorY: 36, mask: false },
};

interface PinDatum {
  position: [number, number];
}

export function createSelectionPinLayer(selection: SelectedEntity | null): IconLayer<PinDatum> | null {
  if (!selection) return null;
  return new IconLayer<PinDatum>({
    id: "selection-pin",
    data: [{ position: [selection.lon, selection.lat] }],
    iconAtlas: DIAMOND_DATA_URI,
    iconMapping: ICON_MAPPING,
    getIcon: () => "pin",
    getPosition: (d) => d.position,
    getSize: 36,
    sizeUnits: "pixels",
    sizeScale: 1,
    pickable: false,
  });
}
