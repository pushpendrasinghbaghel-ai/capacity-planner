# AI Coding Agent Instructions

## Product Vision — Capacity Planner v2

### What This App IS (not a dashboard)
This is a **capacity planning tool** — it produces **persistent artifacts** (capacity plans, forecast snapshots, cost projections) that stakeholders use for budget decisions. Every feature must answer: "What decision does this enable?"

### Five Pillars (ALL must be real, no mocks, no stubs)
1. **Forecast Accuracy Tracking** — Save predictions to Document Store. On revisit, compare predicted vs actual. Track Forecast Accuracy Rate KPI. Builds trust in the tool over time.
2. **Capacity Plan Documents** — Generate structured plans (fleet summary, per-host forecasts, bottlenecks, recommendations, cost impact). Save to Document Store. Shareable. What a VP takes to a budget meeting.
3. **Cost Estimation** — Tag hosts with monthly cost via App State. Show cost in fleet table. Project cost impact of scaling recommendations. Without cost, it's engineering; with cost, it's business planning.
4. **Scenario Comparison** — Save simulation results to Document Store. Compare 2+ scenarios side by side. Delta: "Scenario B delays exhaustion by 147 days, costs $12K less."
5. **Threshold Alerts** — Configure alert thresholds per host/metric via App State. Flag hosts breaching forecast thresholds in Fleet Overview. Proactive, not reactive.

### Architecture Invariants
- **Document Store** for all persistent artifacts (forecast snapshots, capacity plans, saved simulations)
- **App State** for user configuration (cost tags, alert thresholds)
- **Davis GenericForecastAnalyzer** for ALL predictions — no manual formulas
- **Smartscape graph** as computational substrate — topology-aware cascade is the moat
- **Strato Design System** for ALL UI — no custom HTML elements, no hardcoded colors
- **Real DQL queries** against Grail — no mock data generators

### Branding / Naming
- **User-facing label**: Always use **"Dynatrace Intelligence"** (never "Davis" or "Davis AI") in all UI text, tooltips, labels, messages, and recommendations.
- **Code internals**: SDK imports (`@dynatrace-sdk/client-davis-analyzers`), API field names (`dt.davis.forecast:*`), and internal variable names (`davisTimeframe`) stay as-is — they are API contracts.

### Navigation Structure
| Route | Page | Purpose |
|-------|------|---------|
| `/` | Fleet Overview | Host health dashboard + cost + alert flags |
| `/plans` | Capacity Plans | Generate, list, view saved capacity plans |
| `/accuracy` | Forecast Accuracy | Prediction vs actual tracking + KPIs |
| `/topology` | Topology Explorer | Interactive Smartscape graph |
| `/scenario` | Scenario Builder | Define what-if simulations |
| `/results` | Simulation Results | Cascade analysis + bottlenecks |
| `/compare` | Scenario Comparison | Side-by-side simulation comparison |

### Data Model (Document Store)
- `capacity-forecast-snapshot` — Saved predictions (hostId, metric, predicted, timestamp, horizon)
- `capacity-plan` — Generated capacity plans (fleet summary, forecasts, recommendations, costs)
- `capacity-simulation` — Saved simulation results for comparison

### Data Model (App State)
- `cost-model:{hostId}` — Monthly cost in USD for a host
- `alert-config:{hostId}` — Threshold config per host/metric

## DQL - Dynatrace Query Language

Before writing any DQL query, the agent must always use the knowledge base (`dql_search` tool) to search for relevant DQL documentation, syntax, and examples, whenever the tool is available.

## UI Components - Strato

Before using any Strato UI component, the agent must always use the knowledge base tools to search for relevant component documentation and usage examples, whenever the tools are available:
- Use the `strato_search` tool to search for available Strato components by name or keyword.
- Use the `strato_get_component` tool to retrieve detailed documentation, props, and code examples for a specific component.
- Use the `strato_get_usecase_details` tool to get code for specific component use cases and patterns.

## Project Overview
This repository contains a **Dynatrace App** built with the Dynatrace App Toolkit "dt-app", running on **Dynatrace AppEngine**. Use the **App Toolkit** during development and CI (`dt-app dev`, `dt-app build`, `dt-app deploy`, `dt-app publish`).

## Core Concepts
### Dynatrace Apps  
- UI is **TypeScript/React** using **Strato Design System** components for consistent Dynatrace UX.  
- Backend logic runs inside the **Dynatrace JavaScript runtime**. Let the app execute backend code, primarily to call external URLs (e.g., third‑party APIs) that shouldn’t be invoked directly from the browser.
- Apps can use **Intents** for cross-app communication
- Apps can provide **Actions** and **Widgets** to extend Dynatrace. 

### Grail
- **Grail** stores observability data (logs, metrics, events, traces, business events).
- **DQL** is used to query Grail.

### DQL (Dynatrace Query Language)
DQL is a **pipeline-style query language** for Grail: you start with a data source (e.g., `fetch logs` or `timeseries` for metrics), then add pipe‑separated commands like `filter`, `summarize`, `sort`, and `makeTimeseries` to transform and aggregate results. Typical patterns include counting events, building time series, and grouping by dimensions (e.g., host or status).

### Platform Services
A set of services are available to Dynatrace Apps to read and write data. Every service provides a typescript **client sdk** to interact with it. Common services include:
- **Grail Query Service**: Query Dynatrace Grail data using DQL. Prefer using the `useDql` React hook from `@dynatrace-sdk/react-hooks` in UI code, but the low‑level client `@dynatrace-sdk/client-query` is also available.
- **Document Service**: Store and retrieve json files. Used e.g. for dashboards, can be shared with other users. Use `@dynatrace-sdk/client-document` to interact with it.
- **(User) App State Service**: Store and retrieve user‑specific or app‑specific key/value data. Used for caching or user preferences. Use `@dynatrace-sdk/client-state` to interact with it.

## Strato Design System
The **Strato Design System** is Dynatrace's official design system and component library. It provides React components, design tokens (colors, borders, shadows), and icons to build consistent UIs that align with Dynatrace's look and feel.

### Dynatrace App Page Structure (MUST follow)
Reference: https://developer.dynatrace.com/design/patterns/app-structure/

Every Dynatrace app page MUST follow this standard structure to be consistent with the platform:

1. **AppHeader** — Top-level navigation (already global in App.tsx)
2. **TitleBar** — Page title + count/subtitle + suffix actions (TimeframeSelector, Refresh)
   - `TitleBar.Title`: Page name (e.g., "Hosts") + optional count
   - `TitleBar.Subtitle`: Additional context
   - `TitleBar.Suffix`: TimeframeSelector, Refresh button, other actions
3. **Filter row** — One of:
   - **FilterField** ("Type to filter") — for large datasets, power users, 5+ filter categories
   - **FilterBar** with FilterBar.Item — for simple datasets, ≤5 categories, visible filters
   - Layout order: `[SegmentSelector]` → `[FilterField or FilterBar]` → `[TimeframeSelector]` → `[Action buttons]`
4. **Tabs** — Tab/Tab for multi-view pages (e.g., Health / Utilization)
5. **Main content** — DataTable, charts, etc.

Reference: https://developer.dynatrace.com/design/patterns/filtering/

**NEVER** use custom `<button>`, `<select>`, or hand-rolled filter UIs. Always use Strato components.

### DQL Data Type Pitfalls
- `arraySize()` returns a **long** which DQL serializes as a **string** (e.g., `"169"` not `169`)
- Always use `Number(value) || 0` when reading DQL long/count fields, NOT `typeof value === "number"`
- `arrayAvg()` returns a **double** which IS a JavaScript number
- `interval` in timeseries results is also a **string** (nanoseconds as string)

Available packages:
- `@dynatrace/strato-components` — Stable react components. Components here include: Button, ProgressBar, ProgressCircle, Skeleton, SkeletonText, AppRoot, Container, Divider, Flex, Grid, Surface, Heading, Link, List, Paragraph, Strikethrough, Strong, Text, TextEllipsis
- `@dynatrace/strato-components-preview` — Most components are here, including Charts (TimeseriesChart, HistogramChart, HoneycombChart, SingleValue, PieChart, ...), Content (Accordion, Chip, HealthIndicator, MessageContainer, ...), Editors (CodeEditor, DQLEditor), Filters (FilterBar, FilterField, SegmentSelector, TimeframeSelector), Forms (Checkbox, Radio, Select, Switch, TextInput, ...), Layouts (AppHeader, HelpMenu, InputGroup, Page, TitleBar), Navigation (AppLink, Breadcrumbs, Menu, Tabs), Overlays (Modal, Overlay, Sheet, Tooltip), Tables (DataTable, SimpleTable)
- `@dynatrace/strato-design-tokens` — design tokens (colors, spacing, typography) for consistent styling.
- `@dynatrace/strato-geo` — map visualization primitives.
- `@dynatrace/strato-icons` — Strato icon library.

### Working with Table components
When using table components from Strato, prefer `DataTable` from `@dynatrace/strato-components-preview/tables` for advanced features like sorting, filtering, pagination, and selection. Use `SimpleTable` for basic tabular data without interactivity, mostly used for Markdown rendering.

Table API:
- Tables require the `data` and `columns` props
- Column definitions must include `id`, `header`, and `accessor` (string path or function)

### Importing Strato Components
When importing Strato components, follow these guidelines to ensure optimal bundle size and performance:
1. **Never** import from `@dynatrace/strato-components` or `@dynatrace/strato-components-preview` package root
2. **Always** import from the specific category subdirectory (e.g., `/layouts`, `/typography`, `/tables`)
3. **Wrong**: `import { Flex, Heading } from "@dynatrace/strato-components";`
4. **Correct**: 
   ```typescript
   import { Flex } from "@dynatrace/strato-components/layouts";
   import { Heading } from "@dynatrace/strato-components/typography";
   ```

**TypeScript Definitions**: All Strato packages have TypeScript definitions located directly in the package root under each component folder. For example:
- `node_modules/@dynatrace/strato-components-preview/forms/select/Select.d.ts` - Main Select component
- `node_modules/@dynatrace/strato-components-preview/forms/select/SelectOption.d.ts` - Select.Option component
- Pattern: `node_modules/@dynatrace/strato-components[-preview]/<category>/<component>/<Component>.d.ts`

**Important**: Always check the `.d.ts` files directly in `node_modules/@dynatrace/strato-components[-preview]/` to understand component APIs. Do NOT look for a separate `types/` subdirectory.

## Client SDKs
Dynatrace provides TypeScript client SDKs to interact with platform services. Each service has its own package, for example: `@dynatrace-sdk/client-query`, `@dynatrace-sdk/client-document`, `@dynatrace-sdk/client-state`. Those packages are autogenerated from the service OpenAPI specs and have the following characteristics:
- Exported clients to call service endpoints, eg. `queryClient` or `documentClient`.
- Example: 
```typescript 
const result = await queryClient.queryExecute({ body: { query: 'fetch logs | count' }});
```

**Important**: Prefer using the higher‑level React hooks from `@dynatrace-sdk/react-hooks` in UI code, as they encapsulate state management, polling, and error handling.

## Other SDKs
- React hooks — `@dynatrace-sdk/react-hooks`: React hooks for DQL (useDql), documents, app state, settings and other platform services.  Prefer using these in UI code. Request and response types match the low‑level client SDKs. Example:
  ```typescript 
  const { data, error, isLoading } = useDocument({ id: documentId });
  ```
-- Common React Hooks:
--- `useDql(query: string)` - Execute DQL queries
--- `useDocument({ id: string })` - Fetch a single document
--- `useListDocuments(params)` - List all documents (requires `document:documents:read` scope)
--- `useAppState({ key: string })` and `useUserAppState({ key: string })` - Read app (user) state
--- `useSetAppState()` and `useSetUserAppState()` - Write app (user) state. Returns an execute function.
--- `useAppFunction({ name: string, data: any })` - Call backend functions
-- All update/set/POST hooks return an execute function that you can call to perform the action.
- Units & formatting — `@dynatrace-sdk/units`: Convert values to human‑readable strings (e.g., bytes → KiB/MB) and ensure consistent unit formatting across UI and functions.
- App Environment — `@dynatrace-sdk/app-environment`: Read app/environment context (IDs, URLs, current user) directly in the app
- User Preferences — `@dynatrace-sdk/user-preferences`: Retrieve the logged‑in user’s theme, language, regional format, and timezone to adapt UI/formatting. Can not be used to store custom user settings. Use the App State service for that. 

## Development Workflow

### Commands (via `dt-app` CLI)
- **Dev Server**: `npm run start` - runs with hot reload, auto-opens browser
- **Build**: `npm run build` - outputs to `dist/` folder
- **Deploy**: `npm run deploy` - deploys to environment in `app.config.json`

### Configuration
- **App Metadata**: `app.config.json` defines app name, ID, version, and required scopes
- **Environment URL**: Set `environmentUrl` in `app.config.json` to target Dynatrace environment
- **Scopes**: Add required permissions to `app.config.json` `scopes` array (e.g., `storage:logs:read`, `document:documents:read`, `document:documents:write`, `state:app-states:read`, `state:app-states:write`)

## Key Dependencies
- `@dynatrace/strato-components` and `-preview`: UI component library
- `@dynatrace/strato-design-tokens`: Design tokens (colors, borders, shadows)
- `@dynatrace-sdk/react-hooks`: Hooks for Dynatrace APIs (`useDql`, etc.)
- `@dynatrace-sdk/client-*`: Query API clients, every service has its own client package

## Strato Component Anti-Patterns (MUST avoid)

### AppHeader Navigation
- **Use `NavLink`** from `react-router-dom` for `AppHeader.NavigationItem` (provides auto-active highlighting). **NEVER** use plain `Link`.
- **Do NOT add `<AppHeader.Logo />`** explicitly — it is rendered automatically (OOTB). Only override if you need a custom name/icon/routing.
- **Do NOT put icons** inside `AppHeader.NavigationItem` — item labels are text-only.

### Page Titles — Always Use TitleBar
- Every page MUST use `<TitleBar>` from `@dynatrace/strato-components-preview/layouts` as the page header.
- **NEVER** use `<Heading level={1}>` or `<Heading level={2}>` as a page title.
- Use `TitleBar.Title` for the page name, `TitleBar.Subtitle` for context, `TitleBar.Suffix` for actions (e.g., `TimeframeSelector`, Refresh button).

### DataTable — Stable Import + Required Toolbar
- **Import from `@dynatrace/strato-components/tables`** (stable). **NEVER** from `@dynatrace/strato-components-preview/tables`.
- Data-heavy tables MUST have `<DataTable.Toolbar>` containing:
  - `<DataTable.LineWrap />`
  - `<DataTable.ColumnOrderSettings />`
  - `<DataTable.DownloadData />`
- Always set `columnOrdering={true}`, `sortable`, and `resizable` props.
- Use the built-in `loading={isLoading}` prop — **NEVER** render a custom `<Skeleton>` wrapper.

### Empty States — Always Use EmptyState
- **NEVER** build custom empty-state UIs with `Surface` + `Flex` + `Text`.
- Use `<EmptyState>` from `@dynatrace/strato-components/content` with:
  - `EmptyState.Title` — what's empty
  - `EmptyState.Details` — why / what to do
  - `EmptyState.Actions` — optional CTA button(s)

### Progress Visualization — Always Use ProgressBar
- **NEVER** render custom `<div>` progress bars with inline `width` styles.
- Use `<ProgressBar>` from `@dynatrace/strato-components/content` with `value`, `max`, `color` (`"primary"` | `"success"` | `"warning"` | `"critical"`), and `density` (`"condensed"` | `"default"`).
- Use `<ProgressBar.Label>` for the percentage text.

### No Duplicate UX for the Same Action
- If a page has a `Select` dropdown for filtering (e.g., host selection), **do NOT also** add a `FilterBar` that does the same thing. Pick one control per action.

### Remove Unused Template Files
- After scaffolding a project, delete unused template components (e.g., `Card.tsx`) that are not imported anywhere. They add confusion.

### Colors — Always Use Design Tokens
- **NEVER** use hardcoded hex colors (e.g., `#dc3545`, `#28a745`, `#555`, `#888`). Always use `CssTokens.*` from `utils/design-tokens.ts` or Strato design token CSS variables.
- **NEVER** use Bootstrap/Material hex values for severity colors. Map to `CssTokens.feedbackCritical`, `feedbackWarning`, `feedbackSuccess`, `feedbackInfo`.
- **NEVER** use CSS color alpha hacks like `${color}22`. Use Strato background tokens with border for contrast instead.

### Typography — Use textStyle Prop, Not Inline Styles
- **NEVER** set `fontSize` or `fontWeight` directly on `<Text>` via inline styles. Use the `textStyle` prop instead:
  - `textStyle="small"` = 12px / weight 400
  - `textStyle="small-emphasized"` = 12px / weight 500
  - `textStyle="base"` = 14px / weight 400
  - `textStyle="base-emphasized"` = 14px / weight 500
- For section headings (16px / weight 600), use `<Heading level={5}>` — **NEVER** `<Text style={{ fontSize: 16, fontWeight: 600 }}>`.
- For monospace/code text, use `fontFamily: "var(--dt-typography-code-base-default-font-family, monospace)"` — **NEVER** hardcode `fontFamily: "monospace"`.

### Icons — Use Strato Icons, Not Unicode
- **NEVER** use Unicode symbols (`✓`, `⚠`, `→`) for status indicators. Use Strato icon components:
  - `✓` → `<CheckmarkIcon />` or `<SuccessIcon />`
  - `⚠` → `<WarningIcon />`
  - `✕` → `<CriticalIcon />`
- Import from `@dynatrace/strato-icons`.

### HTML Elements — Use Strato Components
- **NEVER** use raw HTML `<button>`, `<select>`, `<input>` elements. Always use Strato equivalents:
  - `<button>` → `<Button>` from `@dynatrace/strato-components/buttons`
  - `<select>` → `<Select>` from `@dynatrace/strato-components/forms`
  - `<input>` → `<TextInput>` from `@dynatrace/strato-components-preview/forms`

### Theme-Aware Fallbacks
- **NEVER** use dark-theme-only fallback values in CSS variables like `var(--dt-colors-text-primary-default, #fff)`. Use `CssTokens.*` which resolve correctly for both light and dark themes.

### Dependencies — No Unused Packages
- Remove unused npm dependencies (e.g., `react-intl` if not imported anywhere). They increase bundle size and create confusion.

## Common Tasks
- **Add Route**: Update `Routes` in [ui/app/App.tsx](ui/app/App.tsx) and add nav item to [ui/app/components/Header.tsx](ui/app/components/Header.tsx)
- **Query Data**: Use `useDql` hook with DQL query string (Dynatrace Query Language)
- **Style Components**: Import from `@dynatrace/strato-design-tokens/{colors,borders,box-shadows}` for design tokens
