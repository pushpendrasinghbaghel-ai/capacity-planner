import { Page } from "@dynatrace/strato-components/layouts";
import React from "react";
import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FleetOverview } from "./pages/FleetOverview";
import { TopologyExplorer } from "./pages/TopologyExplorer";
import { ScenarioBuilder } from "./pages/ScenarioBuilder";
import { SimulationResults } from "./pages/SimulationResults";
import { CapacityPlanner } from "./pages/CapacityPlanner";
import { FilterProvider } from "./context/FilterContext";

export const App = () => {
  return (
    <FilterProvider>
    <Page>
      <Page.Header>
        <Header />
      </Page.Header>
      <Page.Main>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<FleetOverview />} />
            <Route path="/topology" element={<TopologyExplorer />} />
            <Route path="/scenario" element={<ScenarioBuilder />} />
            <Route path="/results" element={<SimulationResults />} />
            <Route path="/forecast" element={<CapacityPlanner />} />
          </Routes>
        </ErrorBoundary>
      </Page.Main>
    </Page>
    </FilterProvider>
  );
};
