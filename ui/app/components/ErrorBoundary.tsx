import React, { Component, type ReactNode } from "react";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { CssTokens } from "../utils/design-tokens";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Surface>
          <Flex
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            padding={64}
            gap={16}
          >
            <Heading level={2}>Something went wrong</Heading>
            <Text style={{ color: CssTokens.textSecondary, maxWidth: 600, textAlign: "center" }}>
              An unexpected error occurred. This may be a temporary issue.
              Try refreshing or click the button below to recover.
            </Text>
            {this.state.error && (
              <Text
                textStyle="small"
                style={{
                  fontFamily: "var(--dt-typography-code-base-default-font-family, monospace)",
                  color: CssTokens.feedbackCritical,
                  maxWidth: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {this.state.error.message}
              </Text>
            )}
            <Button variant="emphasized" onClick={this.handleReset}>
              Try Again
            </Button>
          </Flex>
        </Surface>
      );
    }

    return this.props.children;
  }
}
