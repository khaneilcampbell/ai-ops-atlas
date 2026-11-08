import { Component, type ErrorInfo, type ReactNode } from "react";

/** Plain-words message for a map that failed to draw. Exported for tests. */
export function mapFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (/webgl|context/i.test(text)) return "This device's graphics couldn't start the 3D map.";
  return "Part of the 3D map stopped drawing.";
}

/**
 * Keeps a crash inside the 3D map (a building that throws, or WebGL failing to start) from
 * taking the whole Projects view with it: the toolbar, nameplates and side panel stay, and the
 * canvas shows a short note with Try again (a fresh canvas) instead of a blank or a crash page.
 */
export class MapGuard extends Component<{ children: ReactNode; onRetry: () => void }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[atlas] 3D map stopped drawing", error, info.componentStack);
  }

  render() {
    if (this.state.error == null) return this.props.children;
    return (
      <div className="empty map3d-failed" role="alert">
        <p>{mapFailureMessage(this.state.error)} The flat map still works: use the 3D button in the toolbar to switch.</p>
        <button
          className="btn"
          onClick={() => {
            this.setState({ error: null });
            this.props.onRetry();
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
