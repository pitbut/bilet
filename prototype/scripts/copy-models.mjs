// Копирует GLB-модели из assets/models в public/models перед запуском и сборкой.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../assets/models");
const dst = resolve(here, "../public/models");
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log("models copied →", dst);
