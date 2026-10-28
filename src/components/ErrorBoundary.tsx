import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Keeps one view's crash from blanking the whole window. The likeliest cause on the website is
 * a lazily loaded part of the map that a newer deploy replaced, which a reload fixes.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[atlas] view crashed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="empty" role="alert">
        <p>This view stopped working: {error.message || String(error)}</p>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          Try again
        </button>{" "}
        <button className="btn primary" onClick={() => location.reload()}>
          Reload Atlas
        </button>
      </div>
    );
  }
}
