import { describe, expect, it } from "vitest";
import { joinedName } from "./joined-name";

describe("joinedName", () => {
  it("keeps the single name as it is", () => {
    expect(joinedName(["itens.csv"])).toBe("itens.csv");
  });

  it("lists every name when they fit", () => {
    expect(joinedName(["2022.txt", "2023.txt", "2024.txt"])).toBe("2022.txt, 2023.txt, 2024.txt");
  });

  it("shortens to the first name and the count when they do not fit", () => {
    expect(joinedName(["campos_2022.txt", "campos_2023.txt", "campos_2024.txt"], 30)).toBe("campos_2022.txt + 2 arquivos");
    expect(joinedName(["campos_2022.txt", "campos_2023.txt"], 27)).toBe("campos_2022.txt + 1 arquivo");
  });

  it("never passes the limit, even with a very long first name", () => {
    const out = joinedName(["a".repeat(300), "b.txt"]);
    expect(out).toHaveLength(255);
    expect(out.endsWith(" + 1 arquivo")).toBe(true);
  });
});
