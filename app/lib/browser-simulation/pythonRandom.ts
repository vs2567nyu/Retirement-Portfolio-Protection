/**
 * CPython-compatible MT19937 stream for integer seeds.
 *
 * Python seeds MT19937 through init_by_array, builds each random() value from
 * 53 random bits, and implements randrange with rejection sampling. Matching
 * those details lets browser runs preserve the project's seeded fixtures.
 */
export class PythonRandom {
  readonly #state = new Uint32Array(624);
  #index = 624;
  #gaussNext: number | null = null;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) {
      throw new TypeError("seed must be a safe integer");
    }
    this.#seed(seed);
  }

  #initGenrand(seed: number) {
    this.#state[0] = seed >>> 0;
    for (let index = 1; index < 624; index += 1) {
      const previous = this.#state[index - 1];
      this.#state[index] = (
        Math.imul(previous ^ (previous >>> 30), 1_812_433_253) + index
      ) >>> 0;
    }
    this.#index = 624;
  }

  #seed(seed: number) {
    let absolute = seed < 0 ? -seed : seed;
    const key: number[] = [];
    do {
      key.push((absolute % 4_294_967_296) >>> 0);
      absolute = Math.floor(absolute / 4_294_967_296);
    } while (absolute > 0);

    this.#initGenrand(19_650_218);
    let stateIndex = 1;
    let keyIndex = 0;
    let iterations = Math.max(624, key.length);
    for (; iterations > 0; iterations -= 1) {
      const previous = this.#state[stateIndex - 1];
      const mixed = Math.imul(previous ^ (previous >>> 30), 1_664_525);
      this.#state[stateIndex] = (
        (this.#state[stateIndex] ^ mixed) + key[keyIndex] + keyIndex
      ) >>> 0;
      stateIndex += 1;
      keyIndex += 1;
      if (stateIndex >= 624) {
        this.#state[0] = this.#state[623];
        stateIndex = 1;
      }
      if (keyIndex >= key.length) keyIndex = 0;
    }
    for (iterations = 623; iterations > 0; iterations -= 1) {
      const previous = this.#state[stateIndex - 1];
      const mixed = Math.imul(previous ^ (previous >>> 30), 1_566_083_941);
      this.#state[stateIndex] = ((this.#state[stateIndex] ^ mixed) - stateIndex) >>> 0;
      stateIndex += 1;
      if (stateIndex >= 624) {
        this.#state[0] = this.#state[623];
        stateIndex = 1;
      }
    }
    this.#state[0] = 0x8000_0000;
    this.#index = 624;
    this.#gaussNext = null;
  }

  #twist() {
    for (let index = 0; index < 624; index += 1) {
      const upper = this.#state[index] & 0x8000_0000;
      const lower = this.#state[(index + 1) % 624] & 0x7fff_ffff;
      const joined = (upper | lower) >>> 0;
      this.#state[index] = (
        this.#state[(index + 397) % 624]
        ^ (joined >>> 1)
        ^ ((joined & 1) === 0 ? 0 : 0x9908_b0df)
      ) >>> 0;
    }
    this.#index = 0;
  }

  uint32() {
    if (this.#index >= 624) this.#twist();
    let value = this.#state[this.#index];
    this.#index += 1;
    value ^= value >>> 11;
    value ^= (value << 7) & 0x9d2c_5680;
    value ^= (value << 15) & 0xefc6_0000;
    value ^= value >>> 18;
    return value >>> 0;
  }

  random() {
    const high = this.uint32() >>> 5;
    const low = this.uint32() >>> 6;
    return (high * 67_108_864 + low) / 9_007_199_254_740_992;
  }

  getRandBits(bits: number) {
    if (!Number.isInteger(bits) || bits < 1 || bits > 32) {
      throw new RangeError("bits must be an integer from 1 through 32");
    }
    return this.uint32() >>> (32 - bits);
  }

  randBelow(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 0xffff_ffff) {
      throw new RangeError("limit must be a positive 32-bit integer");
    }
    const bits = 32 - Math.clz32(limit);
    let value = this.getRandBits(bits);
    while (value >= limit) value = this.getRandBits(bits);
    return value;
  }

  gauss() {
    const cached = this.#gaussNext;
    this.#gaussNext = null;
    if (cached !== null) return cached;

    const angle = this.random() * 2 * Math.PI;
    const radius = Math.sqrt(-2 * Math.log(1 - this.random()));
    this.#gaussNext = Math.sin(angle) * radius;
    return Math.cos(angle) * radius;
  }
}
