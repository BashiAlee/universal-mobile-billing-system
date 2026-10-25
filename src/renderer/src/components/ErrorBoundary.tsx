import { Component, type ReactNode } from 'react'

/** Shows a message instead of a blank window if a screen fails to draw. Switching tabs resets it. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="page" role="alert">
        <h1>Something went wrong on this screen</h1>
        <p className="muted">
          Your data is safe. Try another tab, or close and reopen the program. If it keeps
          happening, tell the developer this message:
        </p>
        <pre>{this.state.error.message}</pre>
        <button onClick={() => window.location.reload()}>Reload the screen</button>
      </div>
    )
  }
}
