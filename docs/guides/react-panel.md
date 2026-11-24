# React panel

This guide explains how to embed the Moments control panel in a React application during development, or build your own controls.

## Embed it

The panel needs React 18.3 or 19. The Node runner does not need React at all.

```tsx
import { MomentsPanel } from '@vanta-crest/moments/react';
import '@vanta-crest/moments/styles.css';

export function DevelopmentControls() {
  return <MomentsPanel />;
}
```

The panel sits in normal document flow. Give it its own area beside or below your application, so it never covers a control the journey uses. It starts collapsed as a small **Show Moments** button; pass `defaultCollapsed={false}` to start open, or `standalone` to render it open with no collapse control. Escape collapses it, and Alt + Shift + M opens it.

Outside a Moments browser it says that no session is connected, and your application works as usual.

## Keep it out of production

The panel is a development control, not a production feature. Render it only in development builds, for example:

```tsx
{process.env.NODE_ENV !== 'production' && <DevelopmentControls />}
```

Use whatever flag your bundler provides. Even if the panel ships, it can only reach a run from the page Moments opened itself: the bridge exists only in that page's main frame, at the configured origin. Other pages, frames and origins cannot read or command a run. This is a boundary for development tools, not authorization.

If the application must never contain the panel, use the [Director](sign-in-and-director.md) instead.

## Keep versions together

The panel and the runner must be the same Moments version. If they differ, the panel says "Moments versions do not match" and offers no controls. Rebuild the application after upgrading.

## Build your own controls

`useMomentsSession()` from `@vanta-crest/moments/react` gives you what the panel uses:

| Member | Meaning |
| --- | --- |
| `connection` | `connecting`, `connected` (with `view`), `unavailable`, `disconnected` or `incompatible` |
| `sending` | A command is in flight |
| `message` | A message to show the user, if any |
| `submit(intent)` | Sends `{ command, runRef }`, plus the `opening` it showed for an open command |

The hook polls the runner, discards stale answers, and never replays a command after a lost connection. The view and commands are described in [Reference](../reference.md#session-and-commands).

`/react` and `/protocol` are safe to import in the browser. The package root is for Node.
