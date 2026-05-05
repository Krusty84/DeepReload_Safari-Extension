# What Is This?

Deep Reload is Safari Web Extension for reloading web pages and page elements while bypassing cache.

The project is intended for cases where a normal browser refresh is not enough, especially during development, debugging, and verification of resource updates.
The extension operates directly in Safari and provides reload actions through the browser context menu and extension settings UI.

<img width="607" height="347" alt="image" src="https://github.com/user-attachments/assets/8fd6b2f8-0e1e-4b91-8e37-51116aae2a35" />
<br><br>
<img width="322" height="656" alt="image" src="https://github.com/user-attachments/assets/2bb800e4-1d13-404f-9705-e3c6d2e6670f" />
<br><br>
<img width="836" height="600" alt="image" src="https://github.com/user-attachments/assets/9606b46e-7126-45c7-81c8-fd5cb4de2dd8" />

## Features

- Whole-page reload with cache bypass behavior.
- Element-level reload for the element under the cursor.
- Cleanup before page reload, including service worker and Cache API reset attempts where supported.
- Automatic reload fallback with a configurable interval.
- Configurable selected element visualization modes.
- Local settings storage in Safari extension storage.
- Toast notifications and reload status feedback.
- Popup and options UI for extension configuration.
