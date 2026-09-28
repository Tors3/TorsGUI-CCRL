import { render, screen } from "@testing-library/react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { describe, expect, it } from "vitest";
import type { TournamentSummary } from "../bindings/TournamentSummary";
import { TournamentActions } from "./TournamentActions";

const summary = (state: string, alive: boolean, imported = false): TournamentSummary =>
  ({ record: { id: "t", name: "T", state, imported, config: {} }, progress: {}, runner_alive: alive, seed: "S", score_line: null }) as unknown as TournamentSummary;

const renderIt = (t: TournamentSummary) =>
  render(
    <Tooltip.Provider>
      <TournamentActions t={t} />
    </Tooltip.Provider>,
  );

describe("TournamentActions", () => {
  it("running: pause and stop, no start", () => {
    renderIt(summary("running", true));
    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
    expect(screen.queryByTestId("btn-start")).toBeNull();
  });
  it("paused: resume and queue", () => {
    renderIt(summary("paused", false));
    expect(screen.getByTestId("btn-start")).toHaveTextContent("Resume");
    expect(screen.getByText("Queue")).toBeInTheDocument();
  });
  it("running without a live runner can be resumed", () => {
    renderIt(summary("running", false));
    expect(screen.getByTestId("btn-start")).toHaveTextContent("Resume");
  });
  it("imported tournaments are read-only", () => {
    renderIt(summary("incomplete", false, true));
    expect(screen.queryByTestId("btn-start")).toBeNull();
    expect(screen.queryByText("Queue")).toBeNull();
  });
});
