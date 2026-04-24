# What Is This?

Deep Reload is Safari Web Extension for reloading web pages and page elements while bypassing cache.

The project is intended for cases where a normal browser refresh is not enough, especially during development, debugging, and verification of resource updates.
The extension operates directly in Safari and provides reload actions through the browser context menu and extension settings UI.

## Features

- Whole-page reload with cache bypass behavior.
- Element-level reload for the element under the cursor.
- Cleanup before page reload, including service worker and Cache API reset attempts where supported.
- Automatic reload fallback with a configurable interval.
- Configurable selected element visualization modes.
- Local settings storage in Safari extension storage.
- Toast notifications and reload status feedback.
- Popup and options UI for extension configuration.
