import { Component, type ReactNode } from "react";

/** Keeps one broken screen from blanking the whole app; resets when the route changes. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel p-4 flex flex-col gap-2" role="alert">
        <b>This screen hit an error</b>
        <pre className="mono text-[12px] whitespace-pre-wrap" style={{ color: "var(--loss)" }}>
          {String(this.state.error.stack ?? this.state.error)}
        </pre>
        <div>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}
