import React from "react";
import { NavLink } from "react-router-dom";
import { AppHeader, HelpMenu } from "@dynatrace/strato-components/layouts";

export const Header = () => {
  return (
    <AppHeader>
      <AppHeader.Navigation>
        <AppHeader.NavigationItem as={NavLink} to="/">
          Fleet Overview
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={NavLink} to="/plans">
          Capacity Plans
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={NavLink} to="/accuracy">
          Forecast Accuracy
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={NavLink} to="/topology">
          Topology
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={NavLink} to="/scenario">
          Scenario Builder
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={NavLink} to="/results">
          Simulation Results
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={NavLink} to="/compare">
          Compare
        </AppHeader.NavigationItem>
      </AppHeader.Navigation>
      <AppHeader.Menus>
        <HelpMenu
          entries={{
            whatsNew: "default",
            getStarted: {
              onSelect: () =>
                window.open("https://developer.dynatrace.com", "_blank"),
            },
            documentation: [
              {
                label: "Dynatrace Intelligence Analyzers",
                href: "https://docs.dynatrace.com/docs/platform-modules/davis-ai/davis-analyzers",
                onSelect: () => undefined,
              },
              {
                label: "Strato Design System",
                href: "https://strato.dynatrace.com",
                onSelect: () => undefined,
              },
            ],
            keyboardShortcuts: "default",
            about: "default",
          }}
        />
      </AppHeader.Menus>
    </AppHeader>
  );
};
