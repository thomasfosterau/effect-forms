import { defineConfig } from "vite-plus";
import { packageTest } from "@thomasfosterau/test-config";

export default defineConfig({
  test: packageTest({
    thresholds: { statements: 80, branches: 78, functions: 80, lines: 80 },
  }),
});
