/**
 * Simplified SequenceMatcher for fuzzy string matching.
 * Based on Python's difflib.SequenceMatcher, adapted for TypeScript.
 * Used for finding similar code regions in edit tool error recovery.
 */

export class SequenceMatcher<T = string> {
	private a: T[];
	private b: T[];

	constructor(a: T[] = [], b: T[] = []) {
		this.a = a;
		this.b = b;
	}

	/**
	 * Return the similarity ratio as a float in [0, 1].
	 * 1.0 means identical, 0.0 means completely different.
	 */
	ratio(): number {
		if (this.a.length === 0 && this.b.length === 0) {
			return 1.0;
		}
		const matches = this.getMatchingBlocks();
		let sum = 0;
		for (const [, , size] of matches) {
			sum += size;
		}
		return (2.0 * sum) / (this.a.length + this.b.length);
	}

	/**
	 * Return list of triples describing matching subsequences.
	 * Each triple is [i, j, n] meaning a[i:i+n] == b[j:j+n].
	 */
	getMatchingBlocks(): Array<[number, number, number]> {
		const a = this.a;
		const b = this.b;
		const n = a.length;
		const m = b.length;

		// Build index of b for O(1) lookups
		const bIndex = new Map<T, number[]>();
		for (let i = 0; i < m; i++) {
			const key = b[i];
			const list = bIndex.get(key);
			if (list === undefined) {
				bIndex.set(key, [i]);
			} else {
				list.push(i);
			}
		}

		// Use dynamic programming to find matching blocks
		// This is a simplified version that finds the longest common subsequence
		const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

		for (let i = 1; i <= n; i++) {
			for (let j = 1; j <= m; j++) {
				if (a[i - 1] === b[j - 1]) {
					dp[i][j] = dp[i - 1][j - 1] + 1;
				} else {
					dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
				}
			}
		}

		// Backtrack to find matching blocks
		const matches: Array<[number, number, number]> = [];
		let i = n;
		let j = m;

		while (i > 0 && j > 0) {
			if (a[i - 1] === b[j - 1]) {
				// Found a match, backtrack
				const matchStart: [number, number, number] = [0, 0, 0];
				let length = 0;
				while (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
					i--;
					j--;
					length++;
				}
				matchStart[0] = i;
				matchStart[1] = j;
				matchStart[2] = length;
				matches.unshift(matchStart);
			} else if (dp[i - 1][j] > dp[i][j - 1]) {
				i--;
			} else {
				j--;
			}
		}

		// Merge adjacent or overlapping blocks
		const merged: Array<[number, number, number]> = [];
		for (const match of matches) {
			if (merged.length === 0) {
				merged.push(match);
				continue;
			}
			const last = merged[merged.length - 1];
			// Check if blocks are adjacent (end of one is start of next in both sequences)
			if (last[0] + last[2] === match[0] && last[1] + last[2] === match[1]) {
				last[2] = match[0] + match[2] - last[0];
			} else {
				merged.push(match);
			}
		}

		// Sort by position in a
		merged.sort((x, y) => x[0] - y[0]);

		// Add trailing sentinel
		merged.push([n, m, 0]);

		return merged;
	}

	/**
	 * Quick ratio estimate (upper bound on ratio()).
	 * Faster than ratio() for large inputs.
	 */
	quickRatio(): number {
		const lenA = this.a.length;
		const lenB = this.b.length;
		return Math.min(lenA, lenB) / Math.max(lenA, lenB, 1);
	}

	/**
	 * Real-time ratio computation (lower bound on ratio()).
	 */
	realQuickRatio(): number {
		return this.quickRatio();
	}
}

/**
 * Convenience function to compare two arrays and get similarity ratio.
 */
export function compareArrays<T>(a: T[], b: T[]): number {
	return new SequenceMatcher(a, b).ratio();
}

/**
 * Compare two strings character by character and return similarity ratio.
 */
export function compareStrings(a: string, b: string): number {
	return new SequenceMatcher(a.split(""), b.split("")).ratio();
}

/**
 * Compare two arrays of strings line by line.
 * For comparing code blocks.
 */
export function compareLines(a: string[], b: string[]): number {
	return new SequenceMatcher(a, b).ratio();
}
