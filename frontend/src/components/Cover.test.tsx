import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CoverSpec } from "@/contracts/models";
import { Cover } from "./Cover";

describe("Cover", () => {
  it("affiche une couverture de repli quand la réponse API est incomplète", () => {
    render(<Cover spec={{} as CoverSpec} title="Publication importée" />);

    expect(screen.getByText("KIOSY")).toBeInTheDocument();
    expect(document.querySelector('rect[fill="#F4EFE3"]')).toBeInTheDocument();
  });
});
