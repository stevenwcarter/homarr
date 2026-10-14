import { describe, expect, it } from "vitest";

import { hexColorSchema, optionsBuilder } from "./options";

describe("hexColorSchema", () => {
  it("accepts six-digit hex colours", () => {
    expect(hexColorSchema.safeParse("#336699").success).toBe(true);
    expect(hexColorSchema.safeParse("#AbCdEf").success).toBe(true);
  });

  it("rejects everything else", () => {
    for (const value of ["336699", "#36", "red", "#33669", "#3366999", ""]) {
      expect(hexColorSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe("color option", () => {
  it("defaults to black with the hex validator", () => {
    const options = optionsBuilder.from((factory) => ({ tint: factory.color() }));
    expect(options.tint.type).toBe("color");
    expect(options.tint.defaultValue).toBe("#000000");
    expect(options.tint.validate).toBe(hexColorSchema);
  });

  it("accepts a default value", () => {
    const options = optionsBuilder.from((factory) => ({ tint: factory.color({ defaultValue: "#336699" }) }));
    expect(options.tint.defaultValue).toBe("#336699");
  });
});
