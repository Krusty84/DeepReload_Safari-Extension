# Deep Reload Extension Architecture

## Overview

`DeepReload Extension/` contains the browser extension payload for Deep Reload.

The extension is split into three execution contexts:

1. Background context: owns menus, tab-level actions, and cross-tab coordination.
2. Content-script context: runs inside pages, tracks the selected element, performs element/page cleanup, and renders in-page overlays.
3. Settings UI context: renders the popup/options page and persists user settings.

The code is intentionally split into small files by responsibility, but the runtime is still tightly coupled by browser-extension boundaries and script loading order.

## Entry Points

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
- Draws the element highlight overlay.
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
- storage keys
- read/save helpers

This file is shared in two different ways:

- imported by ES modules in background/settings code
- loaded as a plain script before content scripts, exposing helpers through `globalThis.__deepreload_settings_schema__`

This dual-use shape exists because the content scripts are not modules.

## File Responsibilities

### `manifest.json`

- Declares the extension name/description via locale keys.
- Wires background, action popup, options page, and content scripts.
- Defines permissions: `contextMenus`, `tabs`, `scripting`, `storage`.
- Grants host access on all URLs.

### `background-core.js`

- Background runtime singleton and cleanup pattern.
- Menu IDs and protocol constants.
- Background-safe settings access and normalization.

### `background-menus.js`

- Builds context menus based on settings.
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

Important: this file defines globals consumed by the later content files. Because the content scripts are plain scripts, top-level declarations and script order matter.

### `content-highlight.js`

- Resolves the selected DOM target, including across shadow DOM boundaries.
- Builds a locator for the selected element.
- Draws and updates the highlight overlay.
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
- Persists changes immediately.
- Reacts to storage updates.

### `settings.js`

- Boots the settings page.
- Loads settings, renders controls, installs listeners, and handles disposal.

## Core Data Flows

### Whole-Page Reload

1. User selects `Whole Page` from the context menu.
2. `background-menus.js` routes to `handleWholePageReload`.
3. `background-actions.js` sends `prepareWholePageReload` into the tab.
4. `content-reload.js` unregisters service workers, clears Cache API stores, and prepares a report.
5. Background navigates the tab using a cache-busted URL or reload fallback.
6. The next content-script run consumes the pending report and shows a toast.

### Element Reload

1. User right-clicks an element.
2. `content-highlight.js` records the selected element and renders highlight UI.
3. User selects `Element Under Cursor` from the menu.
4. `background-menus.js` routes to `handleElementUnderCursorReload`.
5. `content-reload.js` reloads the nearest refreshable target and shows a result toast.

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

## State and Persistence

### `browser.storage.local`

Long-lived extension settings:

- page reload enabled
- element reload enabled
- automatic reload enabled
- automatic reload interval
- highlight enabled
- toast notifications enabled
- toast duration
- highlight color

### `sessionStorage` in the page

Short-lived per-tab/page coordination:

- pending whole-page report
- automatic reload state
- automatic page blink marker

This storage is intentionally page-scoped rather than extension-global.

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

## Assets

- `images/`
  Toolbar and store icons.
- `_locales/en/messages.json`
  Locale strings for manifest metadata.

## Recommended Editing Rules

- If you add a setting, update `settings-schema.js` first.
- If you add a content feature, decide whether it belongs in base runtime, highlight, notifications, automatic mode, or reload behavior.
- If you touch content globals, verify all later content files still have access to the names they use.
- If you change whole-page reload flow, test both cache-busted navigation and fallback reload.
- If you change storage listeners, verify menus and popup stay in sync.
