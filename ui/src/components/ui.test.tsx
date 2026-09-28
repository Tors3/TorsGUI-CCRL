import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar, Result, StateChip, Wdl, WdlBar } from "./ui";

describe("ui primitives", () => {
  it("W/D/L with the minus sign", () => {
    render(<Wdl w={32} d={831} l={7} />);
    expect(screen.getByText("+32")).toBeInTheDocument();
    expect(screen.getByText("=831")).toBeInTheDocument();
    expect(screen.getByText("−7")).toBeInTheDocument();
  });
  it("W/D/L bar proportions", () => {
    const { container } = render(<WdlBar w={1} d={2} l={1} />);
    const spans = container.querySelectorAll(".bar > span");
    expect((spans[0] as HTMLElement).style.width).toBe("25%");
    expect((spans[1] as HTMLElement).style.width).toBe("50%");
  });
  it("state chip flags a running tournament without runner", () => {
    render(<StateChip state="running" alive={false} />);
    expect(screen.getByTestId("state-chip")).toHaveTextContent("running · no runner");
  });
  it("progress bar exposes its value", () => {
    render(<ProgressBar value={298} max={380} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "298");
  });
  it("draw result shown as ½-½", () => {
    render(<Result r="1/2-1/2" />);
    expect(screen.getByText("½-½")).toBeInTheDocument();
  });
});
