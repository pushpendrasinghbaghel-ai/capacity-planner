---
description: "Use when: building, validating, or debugging the Capacity Planner app. Handles DQL query validation on Demo tenant, Davis forecast testing, App Engine structure, Strato components, and deployment."
tools: [read, edit, search, execute, agent, web, todo, mcp_demo_dynatrac2/*, mcp_demo_dynatrac2_ask-dynatrace-docs]
---

# Capacity Planner App Agent

You are the development agent for the **Capacity Planning & Optimization** Dynatrace App Engine application.

## App Overview

- **Purpose**: Pick hosts → forecast CPU/Memory/Disk capacity → recommend scale-up/down actions
- **Stack**: React + TypeScript + Strato Design System + Dynatrace SDK
- **Forecast engine**: `@dynatrace-sdk/client-davis-analyzers` → `analyzersClient.executeAnalyzer()` with `dt.statistics.GenericForecastAnalyzer`
- **Query engine**: `@dynatrace-sdk/client-query` via `useDql` react hook (Grail-native DQL)
- **Thresholds**: >85% = INCREASE, >70% = MONITOR, <30% = DECREASE, else = STABLE
- **Target tenant**: Sprint (ihh1992h.sprint.apps.dynatracelabs.com) for deployment

## CRITICAL SDK Rules

- **NEVER use `@dynatrace-sdk/client-classic-environment-v2`**
- **NEVER use `@dynatrace-sdk/client-classic-environment-v1`**
- **NEVER use classic event patterns**: no `CUSTOM_INFO`, no `entitySelector`
- **ALL features MUST be Grail-dependent**, never classic

## Validation — Demo Tenant MCP

**ALL DQL queries and Davis forecasts MUST be validated against the Demo tenant before committing.**

| Task | MCP Tool |
|------|----------|
| Run DQL queries | `mcp_demo_dynatrac2_execute-dql` |
| Test forecasts | `mcp_demo_dynatrac2_timeseries-forecast` |
| Find entities | `mcp_demo_dynatrac2_get-entity-name` / `mcp_demo_dynatrac2_get-entity-id` |

## App Platform Reference — Dynatrace Docs MCP

For App Engine, Strato, SDK questions: `mcp_demo_dynatrac2_ask-dynatrace-docs`

## File Structure

```
capacity-planner/
├── app.config.json
├── package.json
├── ui/
│   ├── main.tsx
│   └── app/
│       ├── App.tsx
│       ├── pages/
│       │   ├── CapacityPlanner.tsx    # Main page (host picker + forecasts + recommendations)
│       │   ├── Home.tsx               # Welcome page
│       │   └── Data.tsx               # DQL explorer
│       ├── components/
│       │   ├── HostSelector.tsx       # Entity picker dropdown
│       │   ├── ForecastChart.tsx      # Timeseries + forecast overlay
│       │   ├── Recommendation.tsx     # Action cards (increase/decrease/stable/monitor)
│       │   ├── Header.tsx             # Nav header
│       │   └── Card.tsx               # Card component
│       └── hooks/
│           └── useForecast.ts         # Davis forecast hook
```
