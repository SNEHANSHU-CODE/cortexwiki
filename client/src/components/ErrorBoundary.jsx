import React from "react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--ws-red)", fontFamily: "sans-serif" }}>
          <h2>Something went wrong loading this section.</h2>
          <p>{this.state.error?.message}</p>
          <button 
            type="button" 
            className="ws-btn ws-btn--primary" 
            onClick={() => window.location.reload()}
            style={{ marginRight: "0.5rem" }}
          >
            Reload Page
          </button>
          <button 
            type="button" 
            className="ws-btn ws-btn--ghost" 
            onClick={this.resetError}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
