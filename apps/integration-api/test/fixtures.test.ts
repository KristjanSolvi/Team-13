import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { candidateSchema } from "../src/contracts.js";
import { projectWardCompanionOverview } from "../src/ward-companion.js";

const fixtures = new URL("../fixtures/", import.meta.url);

describe("published integration fixtures", () => {
  it("keeps the canonical candidate aligned with the request schema", async () => {
    const value = JSON.parse(
      await readFile(new URL("candidate-karen.json", fixtures), "utf8"),
    ) as unknown;

    expect(candidateSchema.parse(value)).toMatchObject({
      patientId: "synthetic-karen",
      status: "candidate",
    });
  });

  it("keeps the overview synthetic and uses the safe thread vocabulary", async () => {
    const value = JSON.parse(
      await readFile(new URL("patient-overview-karen.json", fixtures), "utf8"),
    ) as {
      patientId: string;
      threads: Array<{ state: string }>;
      tasks: Array<{ state: string }>;
    };

    expect(value.patientId).toBe("synthetic-karen");
    expect(value.threads.map((thread) => thread.state)).toEqual([
      "awaiting_review",
    ]);
    expect(value.tasks.map((task) => task.state)).toEqual(["draft"]);
  });

  it("publishes resumable SSE fixture sequences", async () => {
    const value = await readFile(new URL("events-karen.sse", fixtures), "utf8");

    expect(value).toContain("id: 41");
    expect(value).toContain("id: 42");
    expect(value).toContain("event: thread.state_changed");
  });

  it("derives the Ward Companion fixture from the authoritative overview", async () => {
    const overview = JSON.parse(
      await readFile(new URL("patient-overview-karen.json", fixtures), "utf8"),
    ) as {
      patientId: string;
      threads: unknown[];
      tasks: unknown[];
      observedAt: string;
    };
    const companion = JSON.parse(
      await readFile(
        new URL("ward-companion-overview-karen.json", fixtures),
        "utf8",
      ),
    ) as unknown;

    expect(projectWardCompanionOverview(overview)).toEqual(companion);
  });
});
