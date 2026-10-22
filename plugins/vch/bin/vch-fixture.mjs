// vch-fixture: Playwright fixture that records a demo for Video Changelog Hub.
// It records the page with page.screencast at the viewport size, anchors time to the first frame, and logs
// every wrapped action and narration segment into events.json v1 next to demo.webm in the test output dir
// (spec: render-worker/docs/events-v1.md). Plain ESM with JSDoc types, so it runs in any repo without a
// TypeScript loader. Needs @playwright/test >= 1.61 (page.screencast with frame timestamps).
//
// Usage in a spec:
//   import { test, expect } from "../.claude/skills/draft-demo/vch-fixture.mjs";
//   test("demo", async ({ page, vch }) => {
//     await vch.say("intro", "We open the settings page.");
//     await vch.click(page.getByRole("link", { name: "Settings" }), "Settings");
//     await vch.type(page.getByLabel("Password"), password, { secret: true });
//   });
//
// The config must set `video: "off"` (the built-in video would take precedence over the fixture's size)
// and an explicit `viewport`.

import { writeFile } from "node:fs/promises";
import { test as base } from "@playwright/test";

/** @typedef {import("@playwright/test").Locator} Locator */
/** @typedef {import("@playwright/test").Page} Page */

/** @typedef {{ x: number, y: number, width: number, height: number }} Box */

/**
 * @typedef {object} VchEvent
 * @property {string} id
 * @property {"click" | "type"} type
 * @property {number} t
 * @property {number} tEnd
 * @property {Box | null} box
 * @property {string} [label]
 * @property {string} [text]
 * @property {true} [secret]
 * @property {number} [navigatedAt] Clicks only: when the main frame next navigated after this click (seconds from t0).
 */

/** @typedef {{ stepId: string, t: number, text: string }} Segment */

/**
 * @typedef {object} TypeOptions
 * @property {number} [delay] Milliseconds between keystrokes.
 * @property {boolean} [secret] Password-like input: the text is typed but never written to events.json.
 */

/**
 * @typedef {object} Vch
 * @property {(locator: Locator, label?: string) => Promise<void>} click
 * @property {(locator: Locator, text: string, options?: TypeOptions) => Promise<void>} type
 * @property {(stepId: string, text: string) => Promise<void>} say Adds a narration segment at the current
 *   time and waits long enough for it to be spoken.
 */

/**
 * @typedef {object} VchOptions
 * @property {number} charsPerSec Expected speaking rate of the voiceover, used to size the pause after each say().
 */

const VIDEO_FILE = "demo.webm";
const EVENTS_FILE = "events.json";

/** @param {number} seconds */
const round = (seconds) => Math.round(seconds * 1000) / 1000;

/**
 * Box is taken after scrolling and before the action, because the action may scroll or reflow the page.
 * @param {Locator} locator
 * @returns {Promise<Box | null>}
 */
async function measure(locator) {
  await locator.scrollIntoViewIfNeeded();
  return locator.boundingBox();
}

/** @param {Page} page */
function requireScreencast(page) {
  // page.screencast arrived in Playwright 1.59; its frame timestamps are reliable from 1.61.
  if (typeof page.screencast?.start !== "function") {
    throw new Error(
      "vch-fixture needs page.screencast, which this Playwright is too old for. Upgrade: npm i -D @playwright/test@latest (>= 1.61).",
    );
  }
}

/** @type {import("@playwright/test").TestType<import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions & VchOptions & { vch: Vch }, import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions>} */
export const test = base.extend({
  charsPerSec: [12, { option: true }],

  /**
   * @param {{ page: Page, charsPerSec: number }} fixtures
   * @param {(vch: Vch) => Promise<void>} provide
   * @param {import("@playwright/test").TestInfo} testInfo
   */
  vch: async ({ page, charsPerSec }, provide, testInfo) => {
    requireScreencast(page);
    const viewport = page.viewportSize();
    if (!viewport) {
      throw new Error("vch-fixture needs an explicit viewport: set use.viewport (e.g. 1280x720) in the config.");
    }

    /** @type {VchEvent[]} */
    const events = [];
    /** @type {Segment[]} */
    const narration = [];
    const videoPath = testInfo.outputPath(VIDEO_FILE);
    /** @type {number | undefined} */
    let firstFrameMs;
    /** @type {{ ms: number, source: "onFrame" | "startCall" } | undefined} */
    let t0;

    const startCallMs = Date.now();
    await page.screencast.start({
      path: videoPath,
      size: viewport,
      onFrame: ({ timestamp }) => {
        firstFrameMs ??= timestamp;
      },
    });

    // t0 is fixed on first use: the first frame's timestamp if one arrived, else the time of the start() call.
    const now = () => {
      t0 ??=
        firstFrameMs === undefined ? { ms: startCallMs, source: "startCall" } : { ms: firstFrameMs, source: "onFrame" };
      return round((Date.now() - t0.ms) / 1000);
    };
    let counter = 0;
    const nextId = () => `e${String(++counter)}`;

    // A main-frame navigation is attached to the most recent click before it (the first one only), so the
    // renderer can zoom out before the new screen appears. The initial goto has no click and is ignored.
    // framenavigated fires when the navigation commits, i.e. at the final URL after any server redirect.
    /** @type {VchEvent | undefined} */
    let lastClick;
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame() || !lastClick || lastClick.navigatedAt !== undefined) return;
      lastClick.navigatedAt = Math.max(now(), lastClick.t);
    });

    /** @type {Vch} */
    const vch = {
      async click(locator, label) {
        const box = await measure(locator);
        // The event exists before the click resolves, because the navigation may commit while click() runs.
        /** @type {VchEvent} */
        const event = { id: nextId(), type: "click", t: now(), tEnd: 0, box };
        if (label !== undefined) event.label = label;
        lastClick = event;
        await locator.click();
        event.tEnd = now();
        events.push(event);
      },
      async type(locator, text, { delay = 60, secret = false } = {}) {
        const box = await measure(locator);
        const t = now();
        await locator.pressSequentially(text, { delay });
        events.push({ id: nextId(), type: "type", t, tEnd: now(), box, ...(secret ? { secret: true } : { text }) });
      },
      async say(stepId, text) {
        narration.push({ stepId, t: now(), text });
        await page.waitForTimeout(Math.ceil(text.length / charsPerSec) * 1000);
      },
    };

    await provide(vch);

    await page.screencast.stop();
    const eventsPath = testInfo.outputPath(EVENTS_FILE);
    const file = {
      version: 1,
      viewport,
      video: {
        path: VIDEO_FILE,
        width: viewport.width,
        height: viewport.height,
        t0Source: t0?.source ?? (firstFrameMs === undefined ? "startCall" : "onFrame"),
      },
      events,
      narration,
    };
    await writeFile(eventsPath, `${JSON.stringify(file, null, 2)}\n`);
    await testInfo.attach("vch-events", { path: eventsPath, contentType: "application/json" });
    await testInfo.attach("vch-video", { path: videoPath, contentType: "video/webm" });
  },
});

export { expect } from "@playwright/test";
