import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SafeMarkdown } from "./SafeMarkdown";

describe("SafeMarkdown", () => {
  it("n'interprète jamais le HTML et neutralise les liens dangereux", () => {
    const { container } = render(
      <MemoryRouter>
        <SafeMarkdown source={'<img src=x onerror="alert(1)"> **gras** [piège](javascript:alert(1)) [interne](/compte) [ext](https://exemple.org)'} />
      </MemoryRouter>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(screen.getByText("gras").tagName).toBe("STRONG");
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(screen.queryByRole("link", { name: "piège" })).toBeNull();
    expect(container.textContent).toContain("piège");
    expect(screen.getByRole("link", { name: "interne" })).toHaveAttribute("href", "/compte");
    const external = screen.getByRole("link", { name: /ext/ });
    expect(external).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });
});
