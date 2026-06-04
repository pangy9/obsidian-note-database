// Vitest global setup — mock browser globals needed by source code.
// Source code uses window.activeDocument instead of document for
// Obsidian popout-window compatibility.

const mockDocument = {
	documentElement: { lang: "en" },
};

(globalThis as any).document = mockDocument;
if (!(globalThis as any).window) (globalThis as any).window = {};
(globalThis.window as any).activeDocument = mockDocument;
