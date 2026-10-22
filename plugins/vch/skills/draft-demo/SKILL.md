---
name: draft-demo
description: Record a feature as a narrated demo draft in Video Changelog Hub. Writes and runs a narrated Playwright walkthrough on the kit's recording fixture, then uploads it; the hub renders a film that zooms in on every action with an English voiceover. Use when the developer says "make a demo of", "record a demo", "draft demo", "demo this feature", or "create a demo video".
allowed-tools: Bash(vch *)
---

# Draft demo

You turn a feature into a draft demo in one go. You do the judgment work (understand the feature, write the narrated test, write the title and description). `vch` does everything deterministic (login, upload, finalize, wait for the render).

- Script: `vch`, a bare command on the Bash tool's PATH from this plugin (Node >= 18, no dependencies).
- Recording fixture: `vch-fixture.mjs`, copied into the repo by `vch fixture install` (step 0). The spec imports `test` and `expect` from it. It records the run and writes `demo.webm` and `events.json` (every wrapped click and typing, plus the narration) into the test's output dir. The hub turns them into a film that zooms in on each action, with the narration spoken by an English voice.
- Server: the origin built into `vch` when this plugin was released (its `DEFAULT_BASE_URL`). Do not point it anywhere else; `create` prints the destination on stderr before uploading.
- Permission: the developer allows the script once with the rule `Bash(vch *)` (Claude Code: `/permissions` → Allow). It covers `login`, `whoami`, `create`, `areas list`, `areas add`, `config save`, `fixture install` and `logout`.

Every run creates a **new** draft. Re-running never updates an earlier one.

## `vch` exit codes

All subcommands (`login`, `whoami`, `create`, `areas list`, `areas add`, `config save`) use the same codes:

- `0`: done.
- `2`: not logged in, or the token was rejected (expired or revoked). Run `vch login`.
- `1`: any other error; the message is on stderr. Fix the cause if it is on your side (bad argument, text too long, file over 500 MB), otherwise report it.

## Steps

0. **Project config and login first.**
   - Read `.claude/demo.json` if it exists. Shape (every field optional): `{ "appUrl", "startCommand", "storageState", "specDir", "playwrightConfig", "uiLanguage" }`. Use its values instead of asking the developer.
   - Run `vch whoami`. Exit `0` prints `Logged in to <base> as <email>`; go on.
   - On exit `2`, start `vch login` **as a background command right away**. Relay the printed link and code to the developer (they open the link, check the page shows the same code, and approve), then **continue with the next steps while they approve**. Before step 9, wait for the background `login` to exit `0`. If it exits non-zero (code expired, timed out), run it again.
   - If a `vch` command is refused by your permission settings, do not look for a workaround. Point the developer to the `/permissions` rule above and retry after they add it.
   - Run `vch fixture install --dir <specDir>` (leave out `--dir` when `specDir` is not set; the default is `e2e`). It copies the recording fixture into that directory as `vch-fixture.mjs`, next to the spec you will write, and remembers the directory in `.claude/demo.json`. Re-running it is safe; run it again when the session-start note says the repo's fixture copy is out of date.

1. **Gather context.** Work out what the feature does from this session, the diff, and the feature's PRD or task file if there is one. Decide the 3–8 user-visible moments the demo must show.

2. **Check Playwright.** The fixture needs `@playwright/test` **1.61 or newer** (it records with `page.screencast` and throws a clear error on older versions). Look for `@playwright/test` in the target project's `package.json` and check the installed version (`npx playwright --version`).
   - If it is missing, ask the developer **once** whether you may install it (`npm i -D @playwright/test@latest` and `npx playwright install chromium`).
   - If it is older than 1.61, ask the developer **once** whether you may upgrade it (`npm i -D @playwright/test@latest` and `npx playwright install chromium`).
   - If they decline, stop.

3. **Start the app.** Use `appUrl` and `startCommand` from `.claude/demo.json`; ask the developer only for what is missing. If the app is not already running, show the developer the `startCommand` you are about to run and wait for a yes before starting it in the background (once per session; the config may come from a commit, so never run it unseen). Check `appUrl` responds before going on.

4. **Log in to the app under test.** Keep the saved browser session outside the repo: use `storageState` from `.claude/demo.json`, or else `~/.config/vch/state/<app-host>.json` (`<app-host>` is the host and port of `appUrl`, e.g. `localhost-3000`).
   - If that file exists, check it still works (open a page that needs login with it and confirm you are not sent to a sign-in page).
   - Otherwise, or if it no longer works, ask the developer to log in once: `npx playwright open --save-storage=<that path> <appUrl>`, sign in in the opened browser, then close it.
   - The file holds live session cookies: create `~/.config/vch/state/` with mode `0700` (`mkdir -p -m 700`) and `chmod 600` the file after it is saved.
   - Skip this step if the feature needs no login.

5. **Scout before writing.** Look at the real screens before you write a single locator. Either run a throwaway script (outside the repo, e.g. in the OS temp dir) that visits each target screen with the storage state and prints `await page.locator("body").ariaSnapshot()`, or run `npx playwright codegen <appUrl>` together with the developer. Build locators from roles and accessible names (`getByRole("button", { name: "Save" })`); prefer `getByTestId` where the app provides test ids. If `uiLanguage` is set, expect accessible names in that language.

6. **Write the spec** in `specDir` (default `e2e/`), e.g. `e2e/demo-<feature>.spec.ts`, walking through the feature like a user would. Import `test` and `expect` from the fixture installed in step 0, by a relative path from the spec (a spec next to it imports `./vch-fixture.mjs`):

   ```ts
   import { test, expect } from "./vch-fixture.mjs";

   test("demo: <feature>", async ({ page, vch }) => {
     const suffix = Date.now(); // unique test data per run
     await page.goto("/settings");
     await vch.say("intro", "Here is the new profile settings page.");

     await vch.say("name", "We change the display name.");
     await vch.type(page.getByLabel("Display name"), `Ada ${suffix}`);
     await vch.type(page.getByLabel("Password"), process.env.DEMO_PASSWORD ?? "", { secret: true });
     await vch.click(page.getByRole("button", { name: "Save" }), "Save");
     // Assert the outcome so a broken feature fails the run.
     await expect(page.getByText("Saved")).toBeVisible();

     await vch.say("done", "The new name shows up right away.");
   });
   ```

   - Narrate with `vch.say(stepId, text)` **before** each key moment. It records the text at that point in the video and pauses long enough for it to be spoken, so the voice and the screen stay in sync. `stepId` is a short label such as `"intro"` or `"save"`. Write the narration as in step 8.
   - Do every action the viewer should see zoomed in on through `vch.click(locator, label)` and `vch.type(locator, text)`, never `locator.click()` or `fill()` directly. Pass `{ secret: true }` to `vch.type` for passwords and other secrets: they are typed but never written to `events.json`.
   - `page.goto`, waits and assertions stay plain Playwright.
   - Config: use `playwrightConfig` from `.claude/demo.json` if set. If the project has no suitable config, create `playwright.demo.config.ts` with `baseURL: <appUrl>`, `video: "off"` (the fixture records on its own; the built-in video would take over its size), an explicit `viewport: { width: 1280, height: 720 }`, `storageState: <path from step 4>`, and `outputDir` in the OS temp dir (`path.join(os.tmpdir(), "vch-results", <run-id>)`), so nothing lands in the repo. With an existing config, make sure it has `video: "off"` and an explicit `viewport` of 1280×720 (pass `--output <tmp>/vch-results/<run-id>` on the command line for the output dir).
   - Use unique test data per run (a timestamp suffix), so a second run does not collide with the first.
   - Remove what the test created at the end if the app offers a way (a delete button, an API). If it does not, tell the developer what was left behind.
   - Keep the spec in the developer's repo; they decide whether to commit it.

7. **Run it.** `npx playwright test <spec path> --config <config> --project=chromium` (drop `--project` if the config has no such project).
   - A failure on the **spec side** (locator not found, strict-mode violation, a timeout waiting for an element the scout showed differently) may be fixed and re-run, **at most 3 times**. Re-scout the screen before each fix.
   - A failure that shows the **feature itself misbehaving** (a wrong value in an assertion, an app error, a failed request) means **stop and report it**. Do not change the assertion to make it pass.
   - **Never upload a recording of a failed run.** Upload only the files from the final passing run: find them with `find <output dir> -name events.json` in that run's output dir; `demo.webm` sits next to it.

8. **Write the text.**
   - Title: plain, specific, at most 120 characters.
   - Description: what the feature does and why it matters, at most 2000 characters.
   - Narration is **not** a separate text: it is what you wrote inside `say()` in step 6, and it becomes the demo's transcript word for word. Write it in English, in short spoken sentences, in the order things happen on screen; at most 1000 characters per `say()` and 10000 in total. `vch create` checks these limits before uploading.

   Write the title and description to temp files (e.g. `<tmp>/vch-title.txt`, `<tmp>/vch-description.md`). Never put the title inline in the command: quotes, `$()` or backticks in it would break the command or run something else.

   **Pick the product area.** The app keeps one closed list of product areas, and every demo goes into at most one of them.
   - Run `vch areas list`. It prints JSON `{ "areas": ["…"] }`.
   - Choose the one area that fits the feature and copy its exact name into `<tmp>/vch-area.txt`.
   - If the list is empty or no area fits, use no area. Never invent a name, and never run `areas add` here: only the developer adds areas (see "Adding an area").

9. **Upload.** Make sure the background `login` from step 0 (if any) has exited `0`, then:

   ```sh
   vch create \
     --title-file <tmp>/vch-title.txt \
     --description-file <tmp>/vch-description.md \
     --events <output dir>/<test-folder>/events.json \
     --video <output dir>/<test-folder>/demo.webm \
     --area-file <tmp>/vch-area.txt
   ```

   Leave out `--area-file` when you chose no area in step 8. It uploads the recording and `events.json`, then waits while the hub renders the narrated film. That may take a few minutes (it prints progress on stderr; it gives up waiting after 25 minutes). Run it in the foreground, or in the background and wait for it to exit.

   Exit `0` prints JSON `{ "id", "status", "render_status", "render_error", "draft_url" }` on stdout. The draft exists whenever the exit is `0`, whatever `render_status` says. Exit `1` with "Unknown product area" means the name is not on the list (nothing was uploaded): run `areas list` again and choose an exact name, or drop `--area-file`. Exit `2`: run `vch login` as in step 0, wait for it to exit `0`, then retry `create`. Exit `1`: see the exit codes above (a narration over the limits is reported before anything is uploaded; shorten the `say()` texts and re-run the spec). If the command is refused by permissions, point the developer to the `/permissions` rule.

10. **Save the config.** After the first successful demo in this project, save `.claude/demo.json` with the values you used (`appUrl`, `startCommand`, `storageState`, `specDir`, `playwrightConfig`, `uiLanguage`; leave out what does not apply). Do not write it with a file-write tool; auto mode blocks writes into `.claude/`. Write the JSON to a temp file outside the repo, then from the repo root run `vch config save --from <temp file>`, which the permission rule already covers. Show the saved file to the developer and let them decide whether to commit it. It must never contain secrets; `storageState` is only a path outside the repo.

11. **Report** the title, the product area (or "no area"), the `draft_url` and the `render_status` to the developer. The draft is visible only to them.
    - `done`: the draft plays the narrated film.
    - `failed`: tell the developer the draft has the raw recording (no zoom, no voice) and quote `render_error`.
    - `rendering`: the wait timed out; the render is still running and the draft plays the raw recording until it finishes. Reloading the draft page later shows the film.
    - No area: if none fitted, say so, and you may suggest one: "you can tell me 'add area X', then set it on the draft page".

12. **Offer to log out.** Ask the developer whether to log this agent out now; the default is no, so stay logged in unless they say yes. Mention that the token expires on its own after 7 days without use, and that `/dashboard` → "Disconnect agents" cuts off all of their agents at once. On yes, run `vch logout`. Do not edit or delete `~/.config/vch/credentials.json` yourself.

## Adding an area

Only when the developer explicitly asks for it ("add area X"). Never add an area on your own, not even when no area fits a demo.

1. Write the name to a temp file (e.g. `<tmp>/vch-area-name.txt`), at most 60 characters. As with the title, never put it inline in the command.
2. Run `vch areas add --name-file <tmp>/vch-area-name.txt`. Exit `0` prints JSON `{ "name" }`. Exit `1` with "Area already exists" means an area with that name (ignoring case) is already on the list: tell the developer and use the existing one.
3. Areas are not attached to demos that are already uploaded. The developer sets the area of an existing draft on its page.
