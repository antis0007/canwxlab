import { describe, expect, it } from "vitest";

import { searchCities, WORLD_CITIES } from "./cityCatalog";

describe("cityCatalog", () => {
  it("contains globally-distributed entries", () => {
    const countries = new Set(WORLD_CITIES.map((c) => c.country));
    expect(WORLD_CITIES.length).toBeGreaterThan(60);
    expect(countries.has("Canada")).toBe(true);
    expect(countries.has("Japan")).toBe(true);
    expect(countries.has("South Africa")).toBe(true);
    expect(countries.has("Brazil")).toBe(true);
  });

  it("ranks an exact name match above a partial match", () => {
    const matches = searchCities("Tokyo", 5);
    expect(matches[0]?.name).toBe("Tokyo");
  });

  it("returns popular cities first when query is blank", () => {
    const top = searchCities("", 5);
    expect(top.length).toBe(5);
    expect(top.every((c) => c.rank >= 3)).toBe(true);
  });

  it("matches by country", () => {
    const indian = searchCities("India", 6);
    expect(indian.some((c) => c.country === "India")).toBe(true);
  });

  it("returns nothing for a non-matching query", () => {
    expect(searchCities("zzzzzzz_no_such_city")).toEqual([]);
  });
});
