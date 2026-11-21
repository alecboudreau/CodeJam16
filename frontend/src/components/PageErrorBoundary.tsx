import { Component, type ReactNode } from "react";
import { ErrorState } from "./PageFeedback";

interface BoundaryProps { children: ReactNode; resetKey: string }
interface BoundaryState { failed: boolean; resetKey: string }

export default class PageErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state = { failed: false, resetKey: this.props.resetKey };
  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState) {
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null;
  }
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <ErrorState title="This page could not be displayed" onRetry={() => this.setState({ failed: false })}>
      <p>Try again, or use the navigation to open another page.</p>
    </ErrorState>;
    return this.props.children;
  }
}
