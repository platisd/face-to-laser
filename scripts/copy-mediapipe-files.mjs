import { copyFileSync, mkdirSync, rmSync } from "node:fs";

const source = "node_modules/@mediapipe/tasks-vision/wasm";
const target = "public/mediapipe";
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const name of ["vision_wasm_module_internal.js", "vision_wasm_module_internal.wasm"]) {
  copyFileSync(`${source}/${name}`, `${target}/${name}`);
}
