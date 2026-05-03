// Centralized design token mappings for Capacity Planner
// All color references MUST use these tokens or Strato CSS variables.
// Never use hardcoded hex colors in component code.

// eslint-disable-next-line no-restricted-imports
import { Colors } from "@dynatrace/strato-design-tokens";

/** Status colors — use for health indicators, badges, alerts */
export const StatusColors = {
  good: Colors.Charts.Status.Good.Default,
  warning: Colors.Charts.Status.Warning.Default,
  critical: Colors.Charts.Status.Critical.Default,
  neutral: Colors.Charts.Status.Neutral.Default,
} as const;

/** Categorical chart colors */
export const ChartColors = {
  color01: Colors.Charts.Categorical.Color01.Default,
  color02: Colors.Charts.Categorical.Color02.Default,
  color03: Colors.Charts.Categorical.Color03.Default,
  color04: Colors.Charts.Categorical.Color04.Default,
  color05: Colors.Charts.Categorical.Color05.Default,
  color06: Colors.Charts.Categorical.Color06.Default,
} as const;

/** Semantic CSS variable references — theme-aware, work in both dark & light mode */
export const CssTokens = {
  // Text
  textPrimary: "var(--dt-colors-text-primary-default)",
  textSecondary: "var(--dt-colors-text-neutral-default)",
  textAccent: "var(--dt-colors-text-accent-default)",

  // Feedback
  feedbackSuccess: "var(--dt-colors-feedback-success-default)",
  feedbackWarning: "var(--dt-colors-feedback-warning-default)",
  feedbackCritical: "var(--dt-colors-feedback-critical-default)",
  feedbackInfo: "var(--dt-colors-feedback-info-default)",

  // Surfaces
  surfacePrimary: "var(--dt-colors-surface-primary-default)",
  surfaceSecondary: "var(--dt-colors-surface-default)",

  // Borders
  borderPrimary: "var(--dt-colors-border-primary-default)",
  borderNeutral: "var(--dt-colors-border-neutral-default)",

  // Background
  backgroundPrimary: "var(--dt-colors-background-primary-default)",
  backgroundSurface: "var(--dt-colors-background-surface-default)",
} as const;

/** Metric entity color mapping */
export const MetricColors = {
  cpu: ChartColors.color01,
  memory: ChartColors.color02,
  disk: ChartColors.color03,
  forecast: ChartColors.color04,
} as const;
