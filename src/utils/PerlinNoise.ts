/**
 * Perlin Noise implementation for terrain generation
 * Based on Ken Perlin's improved noise algorithm
 */
export class PerlinNoise {
    private permutation: number[];
    private p: number[];

    constructor(seed: number = 0) {
        // Initialize permutation table
        this.permutation = [];
        for (let i = 0; i < 256; i++) {
            this.permutation[i] = i;
        }

        // Shuffle based on seed
        this.shuffle(this.permutation, seed);

        // Duplicate permutation to avoid overflow
        this.p = new Array(512);
        for (let i = 0; i < 512; i++) {
            this.p[i] = this.permutation[i % 256];
        }
    }

    private shuffle(array: number[], seed: number): void {
        // Simple seeded shuffle
        let random = this.seededRandom(seed);
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    private seededRandom(seed: number): () => number {
        return function() {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
    }

    private fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    private lerp(t: number, a: number, b: number): number {
        return a + t * (b - a);
    }

    private grad(hash: number, x: number, y: number): number {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    /**
     * Generate 2D Perlin noise value at given coordinates
     * @param x X coordinate
     * @param y Y coordinate
     * @returns Noise value between -1 and 1
     */
    public noise(x: number, y: number): number {
        // Find unit square that contains point
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;

        // Find relative x, y of point in square
        x -= Math.floor(x);
        y -= Math.floor(y);

        // Compute fade curves
        const u = this.fade(x);
        const v = this.fade(y);

        // Hash coordinates of 4 square corners
        const a = this.p[X] + Y;
        const aa = this.p[a];
        const ab = this.p[a + 1];
        const b = this.p[X + 1] + Y;
        const ba = this.p[b];
        const bb = this.p[b + 1];

        // Blend results from 4 corners
        return this.lerp(
            v,
            this.lerp(u, this.grad(this.p[aa], x, y), this.grad(this.p[ba], x - 1, y)),
            this.lerp(u, this.grad(this.p[ab], x, y - 1), this.grad(this.p[bb], x - 1, y - 1))
        );
    }

    /**
     * Generate octaved Perlin noise (fractal Brownian motion)
     * @param x X coordinate
     * @param y Y coordinate
     * @param octaves Number of octaves
     * @param persistence Amplitude multiplier per octave (0-1)
     * @param lacunarity Frequency multiplier per octave
     * @returns Noise value between -1 and 1
     */
    public octaveNoise(
        x: number,
        y: number,
        octaves: number = 4,
        persistence: number = 0.5,
        lacunarity: number = 2.0
    ): number {
        let total = 0;
        let frequency = 1;
        let amplitude = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            total += this.noise(x * frequency, y * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }

        return total / maxValue;
    }
}
