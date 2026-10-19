/**
 * Outdoor provider — Bright Sky primary, Open-Meteo fallback, stub.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchOutdoorTemperature,
  resetOutdoorCache,
} from "./outdoor.js";

describe("outdoor provider", () => {
  it("uses stub without network", async () => {
    resetOutdoorCache();
    const reading = await fetchOutdoorTemperature({
      provider: "stub",
      fallback: null,
      lat: 51.6167,
      lon: 7.5281,
      stubTempC: 7.5,
      forceStub: true,
    });
    assert.equal(reading.source, "stub");
    assert.equal(reading.tempC, 7.5);
  });

  it("falls back to openmeteo when brightsky fails", async () => {
    resetOutdoorCache();
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("brightsky")) {
        return new Response("down", { status: 503 });
      }
      if (url.includes("open-meteo")) {
        return Response.json({
          current: { temperature_2m: 3.2, time: "2026-01-10T12:00" },
        });
      }
      return new Response("no", { status: 404 });
    };
    const reading = await fetchOutdoorTemperature({
      provider: "brightsky",
      fallback: "openmeteo",
      lat: 51.6167,
      lon: 7.5281,
      stubTempC: 8,
      fetchImpl,
    });
    assert.equal(reading.source, "openmeteo");
    assert.equal(reading.tempC, 3.2);
  });

  it("parses brightsky current_weather", async () => {
    resetOutdoorCache();
    const fetchImpl: typeof fetch = async () =>
      Response.json({
        weather: { temperature: 1.4, timestamp: "2026-01-10T11:00:00+00:00" },
      });
    const reading = await fetchOutdoorTemperature({
      provider: "brightsky",
      fallback: null,
      lat: 51.6167,
      lon: 7.5281,
      stubTempC: 8,
      fetchImpl,
    });
    assert.equal(reading.source, "brightsky");
    assert.equal(reading.tempC, 1.4);
  });
});
