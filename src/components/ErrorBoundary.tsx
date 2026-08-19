import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. A render crash (e.g. a malformed WS task patch)
 * must never take down the whole app — it is isolated here and surfaced with
 * a recover button instead of a blank white screen.
 */
export default class ErrorBoundary extends Component<Props, State> {
  // The repo has no @types/react — `Component` resolves as `any`, so the
  // inherited members must be declared explicitly (type-only, runtime is
  // React's real implementation).
  declare props: Props;
  declare setState: (partial: Partial<State>) => void;

  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('App crashed:', error, info);
    this.props.onError?.(error);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '2rem',
            background: '#0a0e17',
            color: '#e2e8f0',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '2.5rem' }}>⚠️</div>
          <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Something went wrong</h1>
          <p style={{ margin: 0, color: '#94a3b8', maxWidth: '520px', wordBreak: 'break-word' }}>
            {this.state.error.message || String(this.state.error)}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={this.reset}
              style={{
                padding: '0.6rem 1.25rem',
                borderRadius: '0.5rem',
                border: 'none',
                background: '#4f46e5',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '0.6rem 1.25rem',
                borderRadius: '0.5rem',
                border: '1px solid #334155',
                background: 'transparent',
                color: '#e2e8f0',
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}