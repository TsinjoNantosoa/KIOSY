import { readCatalogQuery, writeCatalogQuery } from "./catalogQuery";

describe("filtres du catalogue dans l'URL", () => {
  it("lit et réécrit les filtres de manière stable", () => {
    const query = readCatalogQuery(new URLSearchParams("q=export&univers=business&format=text&prix=paid&tri=title&page=2"));
    expect(query).toEqual({ q: "export", universe: "business", format: "text", price: "paid", sort: "title", page: 2, language: undefined });
    expect(writeCatalogQuery(query).toString()).toBe("q=export&univers=business&format=text&prix=paid&tri=title&page=2");
  });

  it("ignore les valeurs inconnues ou hors bornes", () => {
    const query = readCatalogQuery(new URLSearchParams("univers=agriculture&page=-4&tri=hack"));
    expect(query.universe).toBeUndefined();
    expect(query.sort).toBeUndefined();
    expect(query.page).toBe(1);
    expect(writeCatalogQuery(query).toString()).toBe("");
  });
});
