#!/usr/bin/env node
import { loadSettings } from "./config.js";
import { syncJira } from "./jira/sync.js";
import { syncConfluence } from "./confluence/sync.js";

const target = process.argv[2] || "all";
if (!["all", "jira", "confluence"].includes(target)) {
  console.error("Usage: node src/cli.js [all|jira|confluence]");
  process.exit(1);
}

const settings = loadSettings();

if (target === "all" || target === "jira") {
  const n = await syncJira(settings);
  console.log(`Jira: saved ${n} issues -> ${settings.outputDir}/jira/`);
}
if (target === "all" || target === "confluence") {
  const n = await syncConfluence(settings);
  console.log(
    `Confluence: saved ${n} pages -> ${settings.outputDir}/confluence/`
  );
}
