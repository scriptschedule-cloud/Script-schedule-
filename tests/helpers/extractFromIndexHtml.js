// Pulls specific named function definitions directly out of the real
// index.html source and evaluates them in an isolated context, so the
// tests in tests/scheduling.test.js exercise the actual shipped code —
// not a hand-maintained copy that could silently drift from it. index.html
// is deliberately a single self-contained file (see ARCHITECTURE.md), so
// this avoids needing to split it into modules just to make a handful of
// pure helper functions testable.
//
// Only works for simple top-level `function name(...) { ... }` blocks with
// no dependency on `state`/DOM/other app globals — exactly the class of
// function this is meant for (courseEndDate, isPastCourse, etc).

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function extractFunctionSource(html, name) {
  const startMarker = `function ${name}(`;
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error(`extractFromIndexHtml: could not find "${startMarker}" in index.html`);

  const braceOpen = html.indexOf("{", start);
  if (braceOpen === -1) throw new Error(`extractFromIndexHtml: no opening brace found for ${name}`);

  let depth = 0;
  let i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error(`extractFromIndexHtml: unbalanced braces extracting ${name}`);

  return html.slice(start, i + 1);
}

// Returns an object of { name: fn } for every requested function name,
// evaluated exactly as written in index.html.
function extractFunctions(names) {
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
  const source = names.map(name => extractFunctionSource(html, name)).join("\n\n");
  const exportsSource = `${source}\n\n({ ${names.join(", ")} })`;
  return vm.runInNewContext(exportsSource, {}, { filename: "index.html (extracted)" });
}

module.exports = { extractFunctions };
