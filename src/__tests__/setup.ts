// Vitest global setup — mock browser globals needed by source code.
// Source code uses window.activeDocument instead of document for
// Obsidian popout-window compatibility.

// eslint-disable-next-line obsidianmd/no-global-this -- test setup needs globalThis to mock globals
const _g = globalThis as unknown as Record<string, unknown>;

const mockDocument = {
	documentElement: { lang: "en" },
};

_g.document = mockDocument;
if (!_g.window) _g.window = {};
(_g.window as Record<string, unknown>).activeDocument = mockDocument;
