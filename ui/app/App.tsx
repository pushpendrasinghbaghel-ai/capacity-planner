import { Page } from "@dynatrace/strato-components/layouts";
import React from "react";
import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FleetOverview } from "./pages/FleetOverview";
import { TopologyExplorer } from "./pages/TopologyExplorer";
import { ScenarioBuilder } from "./pages/ScenarioBuilder";
import { SimulationResults } from "./pages/SimulationResults";
import { CapacityPlans } from "./pages/CapacityPlans";
import { ForecastAccuracy } from "./pages/ForecastAccuracy";
import { ScenarioComparison } from "./pages/ScenarioComparison";
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
            <Route path="/plans" element={<CapacityPlans />} />
            <Route path="/accuracy" element={<ForecastAccuracy />} />
            <Route path="/topology" element={<TopologyExplorer />} />
            <Route path="/scenario" element={<ScenarioBuilder />} />
            <Route path="/results" element={<SimulationResults />} />
            <Route path="/compare" element={<ScenarioComparison />} />
          </Routes>
        </ErrorBoundary>
      </Page.Main>
    </Page>
    </FilterProvider>
  );
};
