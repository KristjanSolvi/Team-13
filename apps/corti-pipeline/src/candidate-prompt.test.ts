import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const gatewaySource = readFileSync(new URL("./corti-gateway.ts", import.meta.url), "utf8");

describe("follow-through candidate prompt", () => {
  it("recognises natural task language across nearby transcript segments", () => {
    expect(gatewaySource).toContain("explicit request, commitment, or future action");
    expect(gatewaySource).toContain("let's get you antibiotics");
    expect(gatewaySource).toContain("missing owner, handoff, deadline, or confirmation");
    expect(gatewaySource).toContain("nearby final transcript segments");
    expect(gatewaySource).toContain("one item per distinct action");
    expect(gatewaySource).toContain("monitor observations");
    expect(gatewaySource).toContain("IV furosemide 80mg once a day");
    expect(gatewaySource).toContain("daily weight monitoring");
    expect(gatewaySource).toContain("accurate fluid balance chart");
    expect(gatewaySource).toContain("order daily bloods");
  });

  it("uses FactsR as a hint without promoting it to evidence", () => {
    expect(gatewaySource).toContain("FactsR items are context hints only");
    expect(gatewaySource).toContain("sourceQuote must still be copied exactly");
  });
});
