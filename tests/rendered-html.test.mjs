import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the retirement strategy lab shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Retirement Protection Lab<\/title>/i);
  assert.match(html, /Retirement Protection Lab/);
  assert.match(html, /Growth and downside protection do not move in lockstep/);
  assert.match(html, /5th-percentile wealth/);
  assert.match(html, /Model A/);
  assert.match(html, /Model B/);
  assert.match(html, /Historical blocks/);
  assert.match(html, /Parametric market paths/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships accessible scenario controls in the initial HTML", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /aria-label="Scenario controls"/);
  assert.match(html, /aria-label="Current age"/);
  assert.match(html, /aria-label="Retirement age"/);
  assert.match(html, /aria-label="Final years protected"/);
  assert.match(html, /aria-label="Model A · Parametric"/);
  assert.match(html, /aria-label="Model B · Historical blocks"/);
  assert.match(html, /Run updated scenario|Run analysis/);
  assert.match(html, /Educational stochastic model/);
});

test("server-renders accessible Strategy, Scenario, and Sequence Lab navigation", async () => {
  const response = await render();
  const html = await response.text();

  const tablist = html.match(/<div\b[^>]*aria-label="Retirement lab sections"[^>]*>/)?.[0];
  const strategyTab = html.match(/<button\b[^>]*id="strategy-lab-tab"[^>]*>/)?.[0];
  const studioTab = html.match(/<button\b[^>]*id="scenario-studio-tab"[^>]*>/)?.[0];
  const sequenceTab = html.match(/<button\b[^>]*id="sequence-lab-tab"[^>]*>/)?.[0];

  assert.ok(tablist, "the named section tablist should be server-rendered");
  assert.match(tablist, /role="tablist"/);

  assert.ok(strategyTab, "the Strategy Lab tab should be server-rendered");
  assert.match(strategyTab, /role="tab"/);
  assert.match(strategyTab, /aria-selected="true"/);
  assert.match(strategyTab, /aria-controls="strategy-lab-panel"/);
  assert.match(html, />Strategy Lab<\/button>/);

  assert.ok(studioTab, "the Scenario Studio tab should be server-rendered");
  assert.match(studioTab, /role="tab"/);
  assert.match(studioTab, /aria-selected="false"/);
  assert.match(studioTab, /aria-controls="scenario-studio-panel"/);
  assert.match(html, />Scenario Studio<\/button>/);

  assert.ok(sequenceTab, "the Sequence Lab tab should be server-rendered");
  assert.match(sequenceTab, /role="tab"/);
  assert.match(sequenceTab, /aria-selected="false"/);
  assert.match(sequenceTab, /aria-controls="sequence-lab-panel"/);
  assert.match(html, />Sequence Lab<\/button>/);
});
