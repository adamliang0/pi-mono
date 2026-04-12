import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.js";
import { getShellConfig } from "../src/utils/shell.js";

function mockSettingsManager(shellPath: string | undefined): SettingsManager {
	return {
		getShellPath: () => shellPath,
	} as SettingsManager;
}

describe("getShellConfig cache invalidation", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		vi.restoreAllMocks();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refreshes the cached shell config when shellPath changes", () => {
		const dir = mkdtempSync(join(tmpdir(), "coding-agent-shell-config-"));
		tempDirs.push(dir);
		const shellA = join(dir, "shell-a");
		const shellB = join(dir, "shell-b");
		writeFileSync(shellA, "");
		writeFileSync(shellB, "");

		const createSpy = vi.spyOn(SettingsManager, "create");
		createSpy.mockReturnValueOnce(mockSettingsManager(shellA));

		expect(getShellConfig()).toEqual({ shell: shellA, args: ["-c"] });

		createSpy.mockReturnValueOnce(mockSettingsManager(shellB));

		expect(getShellConfig()).toEqual({ shell: shellB, args: ["-c"] });
	});

	it("refreshes the cached shell config when the configured shellPath disappears", () => {
		const dir = mkdtempSync(join(tmpdir(), "coding-agent-shell-config-"));
		tempDirs.push(dir);
		const shellPath = join(dir, "shell");
		writeFileSync(shellPath, "");

		const createSpy = vi.spyOn(SettingsManager, "create");
		createSpy.mockReturnValueOnce(mockSettingsManager(shellPath));

		expect(getShellConfig()).toEqual({ shell: shellPath, args: ["-c"] });

		unlinkSync(shellPath);
		createSpy.mockReturnValueOnce(mockSettingsManager(shellPath));

		expect(() => getShellConfig()).toThrow(/Custom shell path not found/);
	});
});
