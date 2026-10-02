import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/services/api";
import { renderWithProviders } from "@/test/render";
import CheckoutPage from "./CheckoutPage";
import { ApiError } from "@/contracts/errors";

describe("CheckoutPage", () => {
  it("n'envoie qu'une seule création de commande malgré un double clic", async () => {
    await api.auth.login({ email: "hery@demo.kiosy.invalid", password: "demo" });
    const spy = vi.spyOn(api.commerce, "createOrder");
    renderWithProviders(<CheckoutPage />, { route: "/commande?offre=off_e_e09a", path: "/commande" });
    const confirm = await screen.findByRole("button", { name: /Confirmer la commande/ });
    await userEvent.click(screen.getByLabelText(/J'ai lu les/));
    await userEvent.dblClick(confirm);
    await waitFor(() => expect(screen.getByText("Autre page")).toBeInTheDocument());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("exige l'acceptation des conditions, jamais présélectionnée", async () => {
    await api.auth.login({ email: "hery@demo.kiosy.invalid", password: "demo" });
    const spy = vi.spyOn(api.commerce, "createOrder");
    renderWithProviders(<CheckoutPage />, { route: "/commande?offre=off_e_e09a", path: "/commande" });
    expect(await screen.findByLabelText(/J'ai lu les/)).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: /Confirmer la commande/ }));
    expect(await screen.findByText(/Confirmez avoir pris connaissance/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("avertit qu'un contenu est déjà possédé et ne propose pas de confirmation", async () => {
    await api.auth.login({ email: "hery@demo.kiosy.invalid", password: "demo" });
    renderWithProviders(<CheckoutPage />, { route: "/commande?offre=off_e_e06a", path: "/commande" });
    expect(await screen.findByText("Vous disposez déjà de cet accès")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirmer la commande/ })).toBeNull();
  });

  it("invalide l'acceptation après un conflit 409 et n'envoie pas une seconde commande sans réacceptation", async () => {
    await api.auth.login({ email: "hery@demo.kiosy.invalid", password: "demo" });
    const initial = await api.commerce.quote({ offer_id: "off_e_e09a" });
    const changed = { ...initial, offer: { ...initial.offer, version: initial.offer.version + 1, conditions_version: "démo-0.2", price: { ...initial.offer.price, amount: initial.offer.price.amount + 1000 } }, total: { ...initial.total, amount: initial.total.amount + 1000 }, lines: initial.lines.map((line) => ({ ...line, amount: { ...line.amount, amount: line.amount.amount + 1000 } })) };
    vi.spyOn(api.commerce, "quote").mockResolvedValueOnce(initial).mockResolvedValue(changed);
    const create = vi.spyOn(api.commerce, "createOrder").mockRejectedValueOnce(new ApiError(409, { code: "OFFER_CHANGED", message: "Offre modifiée" }));
    renderWithProviders(<CheckoutPage />, { route: "/commande?offre=off_e_e09a", path: "/commande" });
    const checkbox = await screen.findByLabelText(/J'ai lu les/);
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole("button", { name: /Confirmer la commande/ }));
    expect(await screen.findByText("L'offre a changé")).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: /Confirmer la commande/ }));
    expect(await screen.findByText(/Confirmez avoir pris connaissance/)).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
