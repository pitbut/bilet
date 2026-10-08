// Собирает dist/oligarh.html — одну страницу со встроенными стилями, скриптом и всеми 3D-моделями (base64).
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const files = readdirSync(resolve(dist, "assets"));
const js = readFileSync(resolve(dist, "assets", files.find((f) => f.endsWith(".js"))), "utf8");
const css = readFileSync(resolve(dist, "assets", files.find((f) => f.endsWith(".css"))), "utf8");
if (js.includes("</script")) throw new Error("скрипт содержит </script>");
const models = {};
const walk = (dir, rel = "") => {
  for (const f of readdirSync(dir)) {
    const p = resolve(dir, f);
    if (statSync(p).isDirectory()) walk(p, rel + f + "/");
    else if (f.endsWith(".glb")) models[rel + f.replace(/\.glb$/, "")] = readFileSync(p).toString("base64");
  }
};
walk(resolve(dist, "models"));
const html = `<title>Олигарх</title>
<meta name="theme-color" content="#1d2a33">
<style>${css}</style>
<div id="app"></div>
<script>window.OLIGARH_MODELS=${JSON.stringify(models)};</script>
<script type="module">${js}</script>
`;
writeFileSync(resolve(dist, "oligarh.html"), html);
console.log("dist/oligarh.html", (html.length / 1024).toFixed(0), "КБ");
