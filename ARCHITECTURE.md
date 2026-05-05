# Deep Reload Architecture

## Overview

Deep Reload is a macOS Safari Web Extension project. It has two user-facing parts:

1. The macOS container app in `DeepReload/`.
2. The WebExtension payload in `DeepReload Extension/Resources/`.

The container app exists primarily to satisfy Safari extension distribution requirements and guide users through enabling the extension in Safari Settings. The WebExtension payload owns the actual reload behavior inside Safari.

The extension is split into three execution contexts:

1. Background context: owns menus, tab-level actions, and cross-tab coordination.
2. Content-script context: runs inside pages, tracks the selected element, performs element/page cleanup, and renders in-page overlays.
3. Settings UI context: renders the popup/options page and persists user settings.

The code is intentionally split into small files by responsibility, but the runtime is still tightly coupled by browser-extension boundaries and script loading order.

## Repository Structure

- `DeepReload/`
  macOS container app target. Hosts the SwiftUI onboarding wizard and opens Safari's extension settings.
- `DeepReload/Resources/`
  Container-app resources used by onboarding pages.
- `DeepReload Extension/`
  Safari extension target wrapper and Safari web extension handler.
- `DeepReload Extension/Resources/`
  Browser extension payload: manifest, background scripts, content scripts, settings UI, locales, and icons.
- `docs/`
  Static privacy policy page.

## Entry Points

- `DeepReloadApp.swift`
  Main macOS app entry point. Installs `AppDelegate`, hides the empty Settings menu item, and shows the onboarding window on launch/reopen.

- `OnboardingWindowController.swift`
  Creates the centered, resizable macOS container window and hosts the SwiftUI onboarding view.

- `ContentView.swift`
  SwiftUI onboarding wizard. Pages are defined by `OnboardingPage.defaultPages`.

- `ExtensionGuideActionController.swift`
  Handles onboarding actions, including opening Safari extension settings through `SFSafariApplication.showPreferencesForExtension`.

- `manifest.json`
  Declares the extension, permissions, content script order, background entry, popup, and options page.

- `background.js`
  Main background bootstrap. Registers listeners, handles automatic reload requests, and applies context-menu state.

- `settings.html`
  Popup/options page shell. Loads `settings-schema.js` first, then the `settings.js` module.

- Content scripts from `manifest.json`
  Loaded in this order:
  1. `settings-schema.js`
  2. `content.js`
  3. `content-highlight.js`
  4. `content-notifications.js`
  5. `content-automatic.js`
  6. `content-reload.js`

## High-Level Runtime Model

### Container App

The container app is intentionally separate from extension business logic.

- Shows a SwiftUI onboarding wizard at launch.
- Uses bundled PNGs to explain setup and usage.
- Keeps onboarding content data-driven through `OnboardingPage.defaultPages`.
- Opens Safari's extension settings using SafariServices.
- Does not perform page reloads or inspect Safari page content.

Relevant files:

- `DeepReloadApp.swift`
- `OnboardingWindowController.swift`
- `ContentView.swift`
- `ExtensionGuideActionController.swift`

### Background

The background layer is the browser-facing coordinator.

- Builds and refreshes context menus based on stored settings.
- Responds to menu clicks.
- For whole-page reloads, asks the tab to do in-page cleanup first, then reloads the tab with a cache-busting query param when possible.
- For automatic reload, receives a message from the content script and triggers a tab-level reload from the background context.

Relevant files:

- `background.js`
- `background-core.js`
- `background-menus.js`
- `background-actions.js`

### Content Scripts

The content layer owns all page-local behavior.

- Tracks the element under the last context-menu click.
- Renders selected-element visuals according to the configured mode.
- Performs element-level reload by cache-busting resource URLs on media and inline-style-backed assets.
- Performs pre-navigation cleanup for whole-page reload by unregistering service workers and clearing Cache API stores.
- Renders toasts, debug reports, and the automatic reload banner.
- Persists short-lived state in `sessionStorage` so the next page load can show follow-up UI.

Relevant files:

- `content.js`
- `content-highlight.js`
- `content-notifications.js`
- `content-automatic.js`
- `content-reload.js`

### Settings UI

The settings layer edits persistent extension configuration stored in `browser.storage.local`.

- Reads normalized settings on load.
- Renders toggles and numeric/color inputs.
- Groups whole-page controls separately from element-under-cursor controls.
- Disables element visualization controls when element reload is disabled.
- Uses compact CSS spacing so Safari's toolbar popup can show all settings within its popup height constraints.
- Saves partial changes immediately.
- Reacts to storage changes so popup/options state stays in sync.

Relevant files:

- `settings.html`
- `settings.css`
- `settings.js`
- `settings-core.js`
- `settings-form.js`

## Shared Settings Contract

`settings-schema.js` is the single source of truth for settings.

It defines:

- default values
- validation/clamping
- normalization
- legacy setting migration
- storage keys
- read/save helpers

This file is shared in two different ways:

- imported by ES modules in background/settings code
- loaded as a plain script before content scripts, exposing helpers through `globalThis.__deepreload_settings_schema__`

This dual-use shape exists because the content scripts are not modules.

Current long-lived settings:

- `enableDeepReloadPage`
- `enableDeepReloadElement`
- `enableAutoReloadFallback`
- `autoReloadIntervalSec`
- `elementSelectionStyle`
- `enableToastNotification`
- `toastDurationSec`
- `highlightColor`

`elementSelectionStyle` supports five modes:

- `none`: no selected-element visual.
- `blink`: blink on right-click selection and again when `Element Under Cursor` starts.
- `half-blink`: no right-click blink; blink only after `Element Under Cursor` starts.
- `persistent`: persistent highlight appears on right-click selection.
- `half-persistent`: no right-click highlight; persistent highlight appears during the element reload flow and is cleared when the flow completes.

The old boolean `enableElementHighlight` is still read as a legacy key and migrated to `none` or `persistent`.

## File Responsibilities

### `manifest.json`

- Declares the extension name, short name, author, and description via locale keys.
- Wires background, action popup, options page, and content scripts.
- Defines permissions: `contextMenus`, `tabs`, `scripting`, `storage`.
- Grants host access on all URLs.

Safari's Extensions settings UI composes some labels from multiple metadata sources. The extension list name comes from the WebExtension manifest `name`. The detail panel version comes from manifest `version`. The "from ..." label is controlled by Safari and is tied to the containing app identity, not the WebExtension `author` field.

### `background-core.js`

- Background runtime singleton and cleanup pattern.
- Menu IDs and protocol constants.
- Background-safe settings access and normalization.

### `background-menus.js`

- Builds context menus based on settings.
- Hides `Element Under Cursor` when element reload is disabled.
- Serializes menu rebuilds through `contextMenuUpdatePromise`.
- Routes menu clicks to reload actions.
- Re-applies menus when relevant settings change.

### `background-actions.js`

- Implements tab-level actions.
- Whole-page reload path:
  1. tell content script to prepare the page
  2. try `location.replace()` with a cache-busted URL
  3. fall back to `tabs.update()`
  4. fall back again to `tabs.reload({ bypassCache: true })`

### `background.js`

- Registers background listeners.
- Handles `triggerAutoWholePageReload` from content scripts.
- Disposes listeners on hot-reload style re-entry using a runtime key on `globalThis`.

### `content.js`

- Base content runtime shell.
- Owns shared mutable state used by the later content files.
- Manages lifecycle, listener registration, timer cleanup, and settings hydration.
- Defines selection-visual mode helpers used by later content files.

Important: this file defines globals consumed by the later content files. Because the content scripts are plain scripts, top-level declarations and script order matter.

### `content-highlight.js`

- Resolves the selected DOM target, including across shadow DOM boundaries.
- Builds a locator for the selected element.
- Retains selected-element state even when the active visual mode shows no selection-time UI.
- Draws and updates persistent highlight overlays.
- Draws blink overlays for blink-based selection modes.
- Clears or preserves highlight based on input events and automatic reload mode.

### `content-notifications.js`

- Renders the "Reloading" indicator.
- Renders the debug/toast panel.
- Persists pending whole-page reports in `sessionStorage` so a report can appear after navigation.

### `content-automatic.js`

- Tracks automatic whole-page reload state per tab/page.
- Renders countdown banner.
- Persists automatic reload state and blink markers in `sessionStorage`.
- Sends `triggerAutoWholePageReload` to the background when the timer fires.

### `content-reload.js`

- Handles extension messages from the background.
- Implements whole-page pre-reload cleanup.
- Implements element-level resource reload.
- Renders command-time selected-element visuals before the update when the active mode requires it.
- Rewrites URLs in:
  - `src`
  - `srcset`
  - `poster`
  - `object.data`
  - `embed.src`
  - SVG `href`
  - selected inline style URL properties

### `settings-core.js`

- Settings runtime singleton and DOM/extension listener helpers.
- Local `currentSettings` cache for the UI.
- Bridges the UI to `settings-schema.js`.

### `settings-form.js`

- Finds form controls.
- Renders UI from `currentSettings`.
- Applies UI dependencies:
  - automatic interval is disabled unless automatic reload is enabled
  - selected-element visualization is disabled unless element reload is enabled
  - highlight color is disabled when element reload is disabled or visualization is `none`
- Persists changes immediately.
- Reacts to storage updates.

### `settings.js`

- Boots the settings page.
- Loads settings, renders controls, installs listeners, and handles disposal.

### `DeepReloadApp.swift`

- App entry point for the macOS container app.
- Owns the app delegate bridge.
- Removes the default app Settings command because the real settings live in the extension popup/options page.

### `OnboardingWindowController.swift`

- Creates the main `NSWindow`.
- Centers the window at launch.
- Sets the title, minimum size, maximum size, and standard macOS window behavior.

### `ContentView.swift`

- Defines `OnboardingPage`, the data model for onboarding pages.
- Renders a wizard with a large image, headline, detail text, progress indicator, and Back/Forward/Get Started navigation.
- Loads PNGs from either flat bundle resources or the nested `Resources/` folder. The nested fallback exists because Xcode may copy `DeepReload/Resources` as a folder when files are dragged into the synchronized project structure.

### `ExtensionGuideActionController.swift`

- Opens Safari extension settings for `com.krusty84.DeepReload.Extension`.
- Publishes lightweight status feedback for the onboarding UI.
- Closes the window when needed.

## Core Data Flows

### Whole-Page Reload

1. User selects `Whole Page` from the context menu.
2. `background-menus.js` routes to `handleWholePageReload`.
3. `background-actions.js` sends `prepareWholePageReload` into the tab.
4. `content-reload.js` unregisters service workers, clears Cache API stores, and prepares a report.
5. Background navigates the tab using a cache-busted URL or reload fallback.
6. The next content-script run consumes the pending report and shows a toast.

### Element Reload

The `Element Under Cursor` menu item exists only when `enableDeepReloadElement` is enabled.

1. User right-clicks an element.
2. `content-highlight.js` records the selected element.
3. If the selected mode is `blink`, `content-highlight.js` blinks the selected element.
4. If the selected mode is `persistent`, `content-highlight.js` renders a persistent overlay.
5. User selects `Element Under Cursor` from the menu.
6. `background-menus.js` routes to `handleElementUnderCursorReload`.
7. `content-reload.js` resolves the nearest refreshable target.
8. If the selected mode is `blink` or `half-blink`, `content-reload.js` blinks the originally selected element before updating.
9. If the selected mode is `half-persistent`, `content-reload.js` shows a persistent overlay during the update flow.
10. `content-reload.js` reloads the target and shows a result toast.
11. Cleanup clears transient selected-element references and any command-time overlay.

### Automatic Whole-Page Reload

1. User starts automatic reload from the menu.
2. Background sends `toggleAutomaticReload` to the tab.
3. `content-automatic.js` stores mode/interval and starts a countdown.
4. When the timer fires, content sends `triggerAutoWholePageReload` to background.
5. Background performs the same whole-page reload flow, with reporting suppressed for the pre-navigation phase.
6. The new page instance restores automatic state and shows a page blink marker if applicable.

### Settings Update

1. User changes a control in the popup/options page.
2. `settings-form.js` persists the partial change.
3. `settings-schema.js` normalizes and writes the full settings object.
4. Background/content/settings listeners react to `browser.storage.onChanged`.
5. Menus and runtime UI update without needing a browser restart.

### Container Onboarding

1. User launches the macOS container app.
2. `DeepReloadApp.swift` creates or reuses `OnboardingWindowController`.
3. `ContentView.swift` renders the current onboarding page from `OnboardingPage.defaultPages`.
4. User navigates with Back/Forward controls.
5. On the final page, `Get Started` calls `openSafariSettings()`.
6. `ExtensionGuideActionController.swift` asks Safari to show the settings screen for the extension.

## State and Persistence

### `browser.storage.local`

Long-lived extension settings:

- page reload enabled
- element reload enabled
- automatic reload enabled
- automatic reload interval
- selected-element visualization mode
- toast notifications enabled
- toast duration
- highlight color

### `sessionStorage` in the page

Short-lived per-tab/page coordination:

- pending whole-page report
- automatic reload state
- automatic page blink marker

This storage is intentionally page-scoped rather than extension-global.

### Container app state

The onboarding page index is local SwiftUI state in `ContentView`. It is not persisted. The onboarding window is shown whenever the container app launches or reopens with no visible windows.

## Lifecycle and Cleanup Pattern

All three runtimes use a similar pattern:

- store a runtime object under a well-known `globalThis` key
- if a previous runtime exists, call its `cleanup()`
- register listeners through wrapper helpers
- remove listeners and clear timers on disposal

This makes repeated injection/reload safer during development and navigation.

## Architectural Constraints

### 1. Content script order is a hard dependency

`content-highlight.js`, `content-notifications.js`, `content-automatic.js`, and `content-reload.js` depend on state and helper declarations created earlier by `content.js`.

Do not:

- reorder the content scripts in `manifest.json`
- convert only one of the content files to modules
- replace shared top-level declarations in `content.js` with bindings that are not visible to later scripts

### 2. Background and content have different responsibilities

- Background can reload/navigate tabs and own menus.
- Content can inspect and mutate the DOM, page resources, service workers, and Cache API state.

Keep cleanup logic in content and tab-level navigation logic in background.

### 3. Settings must stay centralized

Any new setting should be added to `settings-schema.js` first, then surfaced in background/content/settings consumers as needed.

### 4. Selection state and selection visuals are separate

`content-highlight.js` must keep the selected element available for command execution even when `elementSelectionStyle` is `none` or a half-mode.

Do not clear `currentHighlightedElement` just because no selection-time visual is shown.

### 5. Command-time visuals target the selected element

Element reload may update a larger ancestor than the clicked node. Command-time blink/highlight should target the originally selected element when it is still connected, not the larger resolved reload ancestor.

### 6. Safari extension settings labels are partly Safari-controlled

The extension manifest can set `name`, `short_name`, `author`, `version`, and `description`, but Safari decides how to compose some strings in Safari Settings. In particular, the "from ..." text in the extension detail panel comes from the containing app identity rather than the manifest `author`.

### 7. Container resources may be nested in the bundle

The Xcode project uses file-system-synchronized groups. Dragging files into `DeepReload/Resources` can result in the app bundle containing `Contents/Resources/Resources/...`. The onboarding image loader intentionally checks both flat and nested resource locations.

## Assets

- `DeepReload Extension/Resources/images/`
  Toolbar and store icons.
- `DeepReload Extension/Resources/_locales/en/messages.json`
  Locale strings for manifest metadata.
- `DeepReload/Resources/*.png`
  Onboarding wizard images used by the macOS container app.

## Recommended Editing Rules

- If you add a container onboarding page, add its PNG under `DeepReload/Resources/` and then add an `OnboardingPage` entry in `ContentView.swift`.
- If you add a setting, update `settings-schema.js` first.
- If you add or rename an `elementSelectionStyle` mode, update `settings-schema.js`, `settings.html`, `content.js`, `content-highlight.js`, and `content-reload.js` together.
- If you add a content feature, decide whether it belongs in base runtime, highlight, notifications, automatic mode, or reload behavior.
- If you touch content globals, verify all later content files still have access to the names they use.
- If you change element visualization behavior, test all five modes: `none`, `blink`, `half-blink`, `persistent`, and `half-persistent`.
- If you change whole-page reload flow, test both cache-busted navigation and fallback reload.
- If you change storage listeners, verify menus and popup stay in sync.
- If you change extension display metadata, verify both Safari Settings and the context menu because Safari does not use every manifest field in every UI surface.
