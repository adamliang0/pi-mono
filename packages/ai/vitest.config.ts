import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30_000,
		// Integration tests hit real APIs and ~/.pi/agent/auth.json (OAuth refresh + save).
		// Parallel files caused overlapping network/auth I/O and looked like a "stall" under turbo.
		fileParallelism: false,
		maxWorkers: 1,
	},
});